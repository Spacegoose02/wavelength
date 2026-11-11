import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import { clientIp, HttpError, need, signedIn, str } from '../http.ts';

/**
 * Artist details that have nowhere to live in the music files (docs/HUB.md, "Edit artist"): a biography an admin
 * wrote, shown on the artist page instead of Wikipedia's, and how that artist's albums are ordered there. Everyone
 * signed in reads them; admins with `library.edit` set them from the app's Edit artist dialog.
 */

export const ALBUM_SORTS = ['', 'newest', 'oldest', 'title'] as const;
export type AlbumSort = (typeof ALBUM_SORTS)[number];

interface Row { name: string; bio: string; album_sort: AlbumSort; updated_at: number }

export function artistMetaRoutes(app: FastifyInstance, { db }: Ctx) {
  const get = (name: string) => db.prepare('SELECT name, bio, album_sort, updated_at FROM artist_meta WHERE name = ?').get(name) as Row | undefined;
  const out = (name: string, r?: Row) => ({ name: r?.name ?? name, bio: r?.bio ?? '', albumSort: r?.album_sort ?? '', updatedAt: r?.updated_at ?? null });

  app.get<{ Querystring: { name?: string } }>('/api/artist-meta', async (req) => {
    signedIn(req);
    const name = (req.query.name ?? '').trim().slice(0, 200);
    if (!name) throw new HttpError(400, 'name is needed');
    return out(name, get(name));
  });

  /** `{ name, bio?, albumSort? }`: only what's sent changes. An artist with nothing left set is forgotten. */
  app.put('/api/admin/artist-meta', async (req) => {
    const { user } = need(req, 'library.edit');
    const body = req.body as Record<string, unknown> | null;
    const name = str(body, 'name', 200);
    if (!name) throw new HttpError(400, 'name is needed');
    const was = get(name);
    const bio = body?.bio === undefined ? (was?.bio ?? '') : typeof body.bio === 'string' ? body.bio.trim().slice(0, 20_000) : null;
    if (bio === null) throw new HttpError(400, 'bio must be text');
    const sort = body?.albumSort === undefined ? (was?.album_sort ?? '') : body.albumSort;
    if (!(ALBUM_SORTS as readonly unknown[]).includes(sort)) throw new HttpError(400, `albumSort must be one of: ${ALBUM_SORTS.filter(Boolean).join(', ')}, or empty`);
    if (!bio && !sort) db.prepare('DELETE FROM artist_meta WHERE name = ?').run(name);
    else {
      db.prepare(`INSERT INTO artist_meta (name, bio, album_sort, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (name) DO UPDATE SET bio = excluded.bio, album_sort = excluded.album_sort, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
        .run(name, bio, sort as string, user.id, Date.now());
    }
    audit(db, { actorId: user.id, action: 'artist.edited', target: name, detail: { bio: !!bio, albumSort: sort }, ip: clientIp(req) });
    return out(name, get(name));
  });
}
