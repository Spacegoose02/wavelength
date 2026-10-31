import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { tx } from '../db.ts';
import { recordPlay, rewind, rewindPeriods } from '../rewind.ts';
import { HttpError, signedIn } from '../http.ts';

/**
 * Each person's own Wavelength playlists and play history (docs/USERS-AND-ADMIN.md Phase 1). Playlists sync
 * whole, last change wins per playlist; a deleted one stays as a tombstone so every device drops it.
 * Only the owner ever reads or writes them.
 */

const MAX_TRACKS = 5000;
const MAX_PLAYLIST_BYTES = 4 * 1024 * 1024;
const KEEP_HISTORY = 1000;

interface Row { id: string; name: string; tracks: string; created_at: number; updated_at: number; deleted: number }

const out = (r: Row) => ({ id: r.id, name: r.name, tracks: JSON.parse(r.tracks) as unknown[], createdAt: r.created_at, updatedAt: r.updated_at, deleted: !!r.deleted });
const time = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1e14 ? Math.floor(v) : null);

export function mineRoutes(app: FastifyInstance, { db, scrobbler }: Ctx) {
  const list = (userId: number) =>
    (db.prepare('SELECT id, name, tracks, created_at, updated_at, deleted FROM user_playlists WHERE user_id = ? ORDER BY created_at').all(userId) as unknown as Row[]).map(out);

  app.get('/api/me/playlists', async (req) => ({ playlists: list(signedIn(req).user.id) }));

  /**
   * `{ playlists: [{ id, name, tracks, createdAt, updatedAt, deleted? }] }`. Each one replaces the Hub's copy
   * when it's newer; answers with every playlist, so the device can take what other devices changed.
   */
  app.put('/api/me/playlists', { bodyLimit: 16 * 1024 * 1024 }, async (req) => {
    const { user } = signedIn(req);
    const items = (req.body as { playlists?: unknown } | null)?.playlists;
    if (!Array.isArray(items) || items.length > 500) throw new HttpError(400, 'Send up to 500 playlists');
    const rows = items.map((p: Record<string, unknown>) => {
      const id = typeof p?.id === 'string' ? p.id.slice(0, 80) : '';
      const updatedAt = time(p?.updatedAt);
      if (!id || !updatedAt) throw new HttpError(400, 'Each playlist needs an id and updatedAt');
      const deleted = p.deleted === true;
      const tracks = deleted ? [] : p.tracks;
      if (!Array.isArray(tracks) || tracks.length > MAX_TRACKS) throw new HttpError(400, `A playlist holds up to ${MAX_TRACKS} songs`);
      const json = JSON.stringify(tracks);
      if (json.length > MAX_PLAYLIST_BYTES) throw new HttpError(400, 'That playlist is too big to save');
      const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 200) : 'Playlist';
      return { id, name, json, createdAt: time(p.createdAt) ?? updatedAt, updatedAt, deleted: deleted ? 1 : 0 };
    });
    tx(db, () => {
      const put = db.prepare(`INSERT INTO user_playlists (user_id, id, name, tracks, created_at, updated_at, deleted) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (user_id, id) DO UPDATE SET name = excluded.name, tracks = excluded.tracks, updated_at = excluded.updated_at, deleted = excluded.deleted
        WHERE excluded.updated_at > user_playlists.updated_at`);
      for (const r of rows) put.run(user.id, r.id, r.name, r.json, r.createdAt, r.updatedAt, r.deleted);
    });
    return { playlists: list(user.id) };
  });

  app.get<{ Querystring: { limit?: string } }>('/api/me/history', async (req) => {
    const { user } = signedIn(req);
    const limit = Math.min(Math.max(Number(req.query.limit) || 300, 1), KEEP_HISTORY);
    const rows = db.prepare('SELECT played_at, track FROM play_history WHERE user_id = ? ORDER BY played_at DESC LIMIT ?').all(user.id, limit) as { played_at: number; track: string }[];
    return { history: rows.map((r) => ({ playedAt: r.played_at, track: JSON.parse(r.track) as unknown })) };
  });

  /** `{ plays: [{ playedAt, track }] }`, up to 300; plays already on the Hub are skipped. */
  app.post('/api/me/history', async (req) => {
    const { user } = signedIn(req);
    const plays = (req.body as { plays?: unknown } | null)?.plays;
    if (!Array.isArray(plays) || plays.length > 300) throw new HttpError(400, 'Send up to 300 plays');
    tx(db, () => {
      const add = db.prepare('INSERT OR IGNORE INTO play_history (user_id, played_at, track) VALUES (?, ?, ?)');
      for (const p of plays as Record<string, unknown>[]) {
        const at = time(p?.playedAt);
        const json = p?.track && typeof p.track === 'object' ? JSON.stringify(p.track) : '';
        if (!at || !json || json.length > 16 * 1024) continue;
        add.run(user.id, at, json);
        const play = recordPlay(db, user.id, at, p.track as Record<string, unknown>, json);
        if (play) scrobbler.enqueue(user.id, at, play);
      }
      db.prepare(`DELETE FROM play_history WHERE user_id = ? AND played_at < COALESCE(
        (SELECT played_at FROM play_history WHERE user_id = ? ORDER BY played_at DESC LIMIT 1 OFFSET ?), 0)`).run(user.id, user.id, KEEP_HISTORY - 1);
    });
    return { ok: true };
  });

  // ---- Rewind (rewind.ts): `tz` is the device's getTimezoneOffset(), so days and hours are its own ----
  const tzOf = (v?: string) => Math.min(Math.max(Math.round(Number(v) || 0), -14 * 60), 14 * 60);

  app.get<{ Querystring: { tz?: string } }>('/api/me/rewind/periods', async (req) => {
    const { user } = signedIn(req);
    return { periods: rewindPeriods(db, user.id, tzOf(req.query.tz)) };
  });

  app.get<{ Querystring: { year?: string; month?: string; tz?: string } }>('/api/me/rewind', async (req) => {
    const { user } = signedIn(req);
    const year = Number(req.query.year), month = req.query.month ? Number(req.query.month) : null;
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new HttpError(400, 'year must be like 2026');
    if (month !== null && (!Number.isInteger(month) || month < 1 || month > 12)) throw new HttpError(400, 'month must be 1 to 12');
    return rewind(db, user.id, year, month, tzOf(req.query.tz));
  });
}
