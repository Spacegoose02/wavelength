import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import { clientIp, HttpError, signedIn, str, type Auth } from '../http.ts';
import { everyone, notify } from '../notify.ts';

/**
 * Household playlists: one list the whole house adds to ("Saturday cleaning", "Road trip"). Everyone but kids
 * can see them, play them and add or reorder songs; renaming and deleting is for whoever made it and admins,
 * and a song can be taken off by whoever added it, the owner or an admin. Songs are kept like shares are
 * (title, artist, album, duration, cover), so each person's app finds them in their own library.
 */

const MAX_SONGS = 2000;
const MAX_ADD = 500;

interface PlaylistRow { id: number; name: string; owner_id: number | null; owner_name: string | null; created_at: number; updated_at: number; songs: number; cover: string | null }
interface TrackRow { id: number; track: string; added_by: number | null; added_name: string | null; added_at: number }

const toPlaylist = (r: PlaylistRow) => ({
  id: r.id, name: r.name, songs: r.songs, cover: r.cover, createdAt: r.created_at, updatedAt: r.updated_at,
  owner: r.owner_id === null ? null : { id: r.owner_id, displayName: r.owner_name ?? '' },
});

/** A song as the app sends it, cut down to what finding it again needs. */
function cleanTrack(t: unknown) {
  const o = (t ?? {}) as Record<string, unknown>;
  const title = str(o, 'title', 300);
  if (!title) return null;
  const duration = Number(o.duration);
  return {
    title,
    artist: str(o, 'artist', 300),
    ...(str(o, 'album', 300) && { album: str(o, 'album', 300) }),
    ...(Number.isFinite(duration) && duration > 0 && { duration: Math.round(duration) }),
    ...(str(o, 'coverUrl', 1000) && { coverUrl: str(o, 'coverUrl', 1000) }),
  };
}

export function householdRoutes(app: FastifyInstance, { db }: Ctx) {
  const SELECT = `SELECT p.*, u.display_name AS owner_name,
      (SELECT COUNT(*) FROM household_tracks t WHERE t.playlist_id = p.id) AS songs,
      (SELECT json_extract(t.track, '$.coverUrl') FROM household_tracks t WHERE t.playlist_id = p.id ORDER BY t.pos LIMIT 1) AS cover
    FROM household_playlists p LEFT JOIN users u ON u.id = p.owner_id`;

  /** Signed in and not a kid. */
  const grownUp = (req: FastifyRequest): Auth => {
    const auth = signedIn(req);
    if (auth.user.role === 'kid') throw new HttpError(403, 'Household playlists are for grown-up profiles');
    return auth;
  };
  const get = (id: unknown) => {
    const r = db.prepare(`${SELECT} WHERE p.id = ?`).get(Number(id)) as PlaylistRow | undefined;
    if (!r) throw new HttpError(404, 'No such playlist');
    return r;
  };
  const mayManage = (auth: Auth, p: PlaylistRow) => p.owner_id === auth.user.id || auth.permissions.includes('users.manage');
  const touch = (id: number) => db.prepare('UPDATE household_playlists SET updated_at = ? WHERE id = ?').run(Date.now(), id);

  app.get('/api/household/playlists', async (req) => {
    grownUp(req);
    const rows = db.prepare(`${SELECT} ORDER BY p.updated_at DESC`).all() as unknown as PlaylistRow[];
    return { playlists: rows.map(toPlaylist) };
  });

  /** `{ name, tracks? }` */
  app.post('/api/household/playlists', async (req) => {
    const { user } = grownUp(req);
    const name = str(req.body, 'name', 120);
    if (!name) throw new HttpError(400, 'Give the playlist a name');
    const now = Date.now();
    const id = Number(db.prepare('INSERT INTO household_playlists (name, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?)').run(name, user.id, now, now).lastInsertRowid);
    const tracks = (req.body as { tracks?: unknown } | null)?.tracks;
    if (Array.isArray(tracks)) add(id, tracks, user.id);
    const grownUps = everyone(db, user.id).filter((id) => (db.prepare('SELECT role FROM users WHERE id = ?').get(id) as { role: string }).role !== 'kid');
    notify(db, grownUps, 'share', `${user.displayName} started a household playlist`, `${name}: add your songs`);
    audit(db, { actorId: user.id, action: 'household.created', target: name, ip: clientIp(req) });
    return { playlist: toPlaylist(get(id)) };
  });

  app.get<{ Params: { id: string } }>('/api/household/playlists/:id', async (req) => {
    grownUp(req);
    const p = get(req.params.id);
    const rows = db.prepare(`SELECT t.id, t.track, t.added_by, u.display_name AS added_name, t.added_at FROM household_tracks t
      LEFT JOIN users u ON u.id = t.added_by WHERE t.playlist_id = ? ORDER BY t.pos, t.id`).all(p.id) as unknown as TrackRow[];
    return {
      playlist: toPlaylist(p),
      tracks: rows.map((r) => ({
        id: r.id, track: JSON.parse(r.track) as unknown, addedAt: r.added_at,
        addedBy: r.added_by === null ? null : { id: r.added_by, displayName: r.added_name ?? '' },
      })),
    };
  });

  /** `{ name }`: the owner or an admin. */
  app.patch<{ Params: { id: string } }>('/api/household/playlists/:id', async (req) => {
    const auth = grownUp(req);
    const p = get(req.params.id);
    if (!mayManage(auth, p)) throw new HttpError(403, 'Only whoever made it (or an admin) can rename it');
    const name = str(req.body, 'name', 120);
    if (!name) throw new HttpError(400, 'Give the playlist a name');
    db.prepare('UPDATE household_playlists SET name = ?, updated_at = ? WHERE id = ?').run(name, Date.now(), p.id);
    return { playlist: toPlaylist(get(p.id)) };
  });

  app.delete<{ Params: { id: string } }>('/api/household/playlists/:id', async (req) => {
    const auth = grownUp(req);
    const p = get(req.params.id);
    if (!mayManage(auth, p)) throw new HttpError(403, 'Only whoever made it (or an admin) can delete it');
    db.prepare('DELETE FROM household_playlists WHERE id = ?').run(p.id);
    audit(db, { actorId: auth.user.id, action: 'household.deleted', target: p.name, ip: clientIp(req) });
    return { ok: true };
  });

  /** Append songs, after the last one. */
  const add = (playlistId: number, tracks: unknown[], userId: number) => {
    const songs = tracks.slice(0, MAX_ADD).map(cleanTrack).filter((t) => !!t);
    const { n, last } = db.prepare('SELECT COUNT(*) AS n, MAX(pos) AS last FROM household_tracks WHERE playlist_id = ?').get(playlistId) as { n: number; last: number | null };
    if (n + songs.length > MAX_SONGS) throw new HttpError(400, `A household playlist holds at most ${MAX_SONGS} songs`);
    const ins = db.prepare('INSERT INTO household_tracks (playlist_id, pos, track, added_by, added_at) VALUES (?, ?, ?, ?, ?)');
    const now = Date.now();
    songs.forEach((t, i) => ins.run(playlistId, (last ?? 0) + i + 1, JSON.stringify(t), userId, now));
    touch(playlistId);
    return songs.length;
  };

  /** `{ tracks: [{ title, artist, album?, duration?, coverUrl? }] }` */
  app.post<{ Params: { id: string } }>('/api/household/playlists/:id/tracks', async (req) => {
    const { user } = grownUp(req);
    const p = get(req.params.id);
    const tracks = (req.body as { tracks?: unknown } | null)?.tracks;
    if (!Array.isArray(tracks) || !tracks.length) throw new HttpError(400, 'Send tracks');
    return { added: add(p.id, tracks, user.id) };
  });

  /** Take a song off: whoever added it, the playlist's owner, or an admin. */
  app.delete<{ Params: { id: string; entry: string } }>('/api/household/playlists/:id/tracks/:entry', async (req) => {
    const auth = grownUp(req);
    const p = get(req.params.id);
    const t = db.prepare('SELECT added_by FROM household_tracks WHERE id = ? AND playlist_id = ?').get(Number(req.params.entry), p.id) as { added_by: number | null } | undefined;
    if (!t) throw new HttpError(404, 'That song isn’t on this playlist');
    if (t.added_by !== auth.user.id && !mayManage(auth, p)) throw new HttpError(403, 'Only whoever added it, made the playlist, or an admin can take it off');
    db.prepare('DELETE FROM household_tracks WHERE id = ?').run(Number(req.params.entry));
    touch(p.id);
    return { ok: true };
  });

  /** `{ ids }`: the playlist's entries in their new order. Entries not listed keep their place after these. */
  app.put<{ Params: { id: string } }>('/api/household/playlists/:id/order', async (req) => {
    grownUp(req);
    const p = get(req.params.id);
    const ids = (req.body as { ids?: unknown } | null)?.ids;
    if (!Array.isArray(ids)) throw new HttpError(400, 'Send ids');
    const rest = (db.prepare('SELECT id FROM household_tracks WHERE playlist_id = ? ORDER BY pos, id').all(p.id) as { id: number }[]).map((r) => r.id);
    const known = new Set(rest);
    const first = [...new Set(ids.map(Number))].filter((id) => known.has(id));
    const order = [...first, ...rest.filter((id) => !first.includes(id))];
    const set = db.prepare('UPDATE household_tracks SET pos = ? WHERE id = ?');
    order.forEach((id, i) => set.run(i + 1, id));
    touch(p.id);
    return { ok: true };
  });
}
