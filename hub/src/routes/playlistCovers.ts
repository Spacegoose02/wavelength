import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { decodeImage } from '../artwork.ts';
import { audit } from '../audit.ts';
import { clientIp, HttpError, signedIn, type Auth } from '../http.ts';

/**
 * Playlist covers (docs/HUB.md "Playlist covers"): a picture someone picked for a playlist, shown on every
 * device in place of the app's mosaic or the server's own cover. The image is uploaded by the app (it has
 * already cropped it square and made it small) and kept in <data>/artwork, served by the same /api/art/:file
 * route as album art. Navidrome and Plex aren't changed, so other apps on those servers keep their cover.
 *
 * Keys:
 * - `wavelength:<id>`: one of the person's own Wavelength playlists. Only they see and change it.
 * - `household:<id>`: a household playlist. Whoever made it, or an admin.
 * - `navidrome:<id>`, `plex:<id>`: a playlist on the music server. Any grown-up; someone else's picture only
 *   an admin can replace or remove.
 */

interface Row { key: string; file: string; set_by: number | null; updated_at: number }
const toCover = (r: Row) => ({ key: r.key, url: `/api/art/${r.file}`, updatedAt: r.updated_at });

const KEY = /^(wavelength|household|navidrome|plex):[\w.:-]{1,120}$/;

export function playlistCoverRoutes(app: FastifyInstance, { db, config }: Ctx) {
  const dir = join(config.dataDir, 'artwork');
  const find = (key: string) => db.prepare('SELECT * FROM playlist_covers WHERE key = ?').get(key) as Row | undefined;

  /** Throws unless this person may change the cover on `key`. */
  function mayChange(auth: Auth, key: string, existing?: Row) {
    const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    const admin = auth.permissions.includes('users.manage');
    if (kind === 'wavelength') {
      const owner = db.prepare('SELECT user_id FROM user_playlists WHERE id = ? AND user_id != ?').get(id, auth.user.id);
      if (owner || (existing && existing.set_by !== auth.user.id)) throw new HttpError(403, "That's someone else's playlist");
      return;
    }
    if (auth.user.role === 'kid') throw new HttpError(403, 'Ask a grown-up to change this cover');
    if (kind === 'household') {
      const p = db.prepare('SELECT owner_id FROM household_playlists WHERE id = ?').get(Number(id)) as { owner_id: number | null } | undefined;
      if (!p) throw new HttpError(404, 'No such playlist');
      if (p.owner_id !== auth.user.id && !admin) throw new HttpError(403, 'Only whoever made it (or an admin) can change its cover');
      return;
    }
    if (existing && existing.set_by !== auth.user.id && !admin) throw new HttpError(403, 'Someone else picked this cover; ask them or an admin to change it');
  }

  const keyOf = (v: unknown) => {
    const key = typeof v === 'string' ? v.trim() : '';
    if (!KEY.test(key)) throw new HttpError(400, 'Send which playlist (key)');
    return key;
  };

  /** Every cover this person can see: their own Wavelength playlists' and everything shared. */
  app.get('/api/playlist-covers', async (req) => {
    const { user } = signedIn(req);
    const rows = db.prepare("SELECT * FROM playlist_covers WHERE key NOT LIKE 'wavelength:%' OR set_by = ? ORDER BY updated_at DESC").all(user.id) as unknown as Row[];
    return { covers: rows.map(toCover) };
  });

  /** `{ key, image }`: image is base64 (a `data:` URL is fine). The same key again replaces the picture. */
  app.put('/api/playlist-covers', { bodyLimit: 22 * 1024 * 1024 }, async (req) => {
    const auth = signedIn(req);
    const b = req.body as Record<string, unknown> | null;
    const key = keyOf(b?.key);
    const old = find(key);
    mayChange(auth, key, old);
    if (typeof b?.image !== 'string') throw new HttpError(400, 'Send an image');
    const { bytes, type } = decodeImage(b.image);

    mkdirSync(dir, { recursive: true });
    const file = `${randomBytes(16).toString('hex')}.${type}`;
    writeFileSync(join(dir, file), bytes);
    db.prepare(`INSERT INTO playlist_covers (key, file, set_by, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (key) DO UPDATE SET file = excluded.file, set_by = excluded.set_by, updated_at = excluded.updated_at`)
      .run(key, file, auth.user.id, Date.now());
    if (old) rmSync(join(dir, old.file), { force: true });
    if (!key.startsWith('wavelength:')) audit(db, { actorId: auth.user.id, action: 'playlistCover.set', target: key, detail: { bytes: bytes.length }, ip: clientIp(req) });
    return { cover: toCover(find(key)!) };
  });

  /** Back to the mosaic, or the server's own cover. */
  app.delete<{ Params: { key: string } }>('/api/playlist-covers/:key', async (req) => {
    const auth = signedIn(req);
    const key = keyOf(req.params.key);
    const old = find(key);
    if (!old) return { ok: true };
    mayChange(auth, key, old);
    db.prepare('DELETE FROM playlist_covers WHERE key = ?').run(key);
    rmSync(join(dir, old.file), { force: true });
    if (!key.startsWith('wavelength:')) audit(db, { actorId: auth.user.id, action: 'playlistCover.reset', target: key, ip: clientIp(req) });
    return { ok: true };
  });
}
