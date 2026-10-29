import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import { tx } from '../db.ts';
import { clientIp, HttpError, need, signedIn } from '../http.ts';

/**
 * Explicit / clean ratings for the library (docs/USERS-AND-ADMIN.md §6.5). An admin's app looks each album
 * up on Deezer and sends what it found; every device uses it to badge music and to filter kid profiles.
 * Nothing is written to the music files.
 */

interface Row { kind: string; artist: string; album: string; title: string; rating: string; clean_link: string | null; checked_at: number }
const RATINGS = ['explicit', 'clean', 'unknown'];
const LINK = /^https:\/\/(www\.)?deezer\.com\/\S+$/i;
const s = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function ratingRoutes(app: FastifyInstance, { db }: Ctx) {
  app.get('/api/ratings', async (req) => {
    signedIn(req);
    const rows = db.prepare('SELECT kind, artist, album, title, rating, clean_link, checked_at FROM ratings').all() as unknown as Row[];
    return { ratings: rows.map((r) => ({ kind: r.kind, artist: r.artist, album: r.album, title: r.title, rating: r.rating, cleanLink: r.clean_link, checkedAt: r.checked_at })) };
  });

  /**
   * `{ albums: [{ artist, album, rating, cleanLink?, explicitTracks?: string[] }] }`, up to 200 at a time.
   * An album sent again replaces what was there (its explicit songs included).
   */
  app.post('/api/admin/ratings', async (req) => {
    need(req, 'library.edit');
    const list = (req.body as { albums?: unknown } | null)?.albums;
    if (!Array.isArray(list) || list.length > 200) throw new HttpError(400, 'Send up to 200 albums');
    const now = Date.now();
    const albums = list.map((a: Record<string, unknown>) => {
      const artist = s(a?.artist), album = s(a?.album), rating = s(a?.rating, 10);
      if (!artist || !album || !RATINGS.includes(rating)) throw new HttpError(400, 'Each album needs artist, album and rating (explicit, clean or unknown)');
      const link = s(a.cleanLink, 300);
      const tracks = Array.isArray(a.explicitTracks) ? a.explicitTracks.map((t) => s(t)).filter(Boolean).slice(0, 300) : [];
      return { artist, album, rating, cleanLink: LINK.test(link) ? link : null, tracks };
    });
    const upsert = db.prepare(`INSERT INTO ratings (kind, artist, album, title, rating, clean_link, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (kind, artist COLLATE NOCASE, album COLLATE NOCASE, title COLLATE NOCASE)
      DO UPDATE SET rating = excluded.rating, clean_link = excluded.clean_link, checked_at = excluded.checked_at`);
    const clearTracks = db.prepare("DELETE FROM ratings WHERE kind = 'track' AND artist = ? COLLATE NOCASE AND album = ? COLLATE NOCASE");
    tx(db, () => {
      for (const a of albums) {
        upsert.run('album', a.artist, a.album, '', a.rating, a.cleanLink, now);
        clearTracks.run(a.artist, a.album);
        for (const t of a.tracks) upsert.run('track', a.artist, a.album, t, 'explicit', null, now);
      }
    });
    return { saved: albums.length };
  });

  /** Forget every rating, to check the library again from scratch. */
  app.delete('/api/admin/ratings', async (req) => {
    const { user } = need(req, 'library.edit');
    db.prepare('DELETE FROM ratings').run();
    audit(db, { actorId: user.id, action: 'ratings.cleared', ip: clientIp(req) });
    return { ok: true };
  });
}
