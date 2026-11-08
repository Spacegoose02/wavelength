import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import { clientIp, HttpError, need } from '../http.ts';
import { serviceForHub, setServiceUser } from '../services.ts';
import { getUser } from '../users.ts';

/**
 * Admin sessions by server and login. Navidrome only lets a few sign-ins through per address in a short window
 * (AuthRequestLimit, 5 per 20 s by default) and answers the rest with 429, so a Library care scan that signed in
 * again for every page or batch of albums got "refused" part way through. One sign-in now lasts a while.
 */
const sessions = new Map<string, { token: string; isAdmin?: boolean; at: number }>();
const SESSION_FOR = 10 * 60_000;

/** Navidrome's own API (not Subsonic): sign in as the admin, then call it with the token. */
export async function navidromeAdmin(url: string, username: string, password: string) {
  const base = url.replace(/\/+$/, '');
  const key = `${base}\n${username}\n${createHash('sha256').update(password).digest('hex')}`;
  const call = async (path: string, init: RequestInit) => {
    let r: Response;
    try {
      r = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new HttpError(502, `Couldn't reach Navidrome at ${url}`);
    }
    // Navidrome restarted or the token ran out: sign in afresh next time
    if (r.status === 401) sessions.delete(key);
    return r;
  };
  let session = sessions.get(key);
  if (!session || Date.now() - session.at > SESSION_FOR) {
    sessions.delete(key);
    const login = await call('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
    if (login.status === 429) throw new HttpError(502, 'Navidrome is turning away sign-ins for a moment (too many in a row). Wait a minute and try again');
    const body = (await login.json().catch(() => null)) as { token?: string; isAdmin?: boolean } | null;
    if (!login.ok || !body?.token) throw new HttpError(502, 'Navidrome refused the admin login saved on the Hub. Check it under Settings → Server');
    session = { token: body.token, isAdmin: body.isAdmin, at: Date.now() };
    sessions.set(key, session);
  }
  if (session.isAdmin === false) throw new HttpError(502, `${username} isn't a Navidrome admin, so it can't make accounts`);
  return {
    /** An album's songs with their file paths (as Navidrome sees them). */
    async albumSongs(albumId: string): Promise<{ id: string; path: string; title: string; artist: string; album: string; albumArtist?: string }[]> {
      const r = await call(`/api/song?${new URLSearchParams({ album_id: albumId, _start: '0', _end: '1000', _sort: 'album', _order: 'ASC' })}`, {
        headers: { 'x-nd-authorization': `Bearer ${session.token}` },
      });
      if (!r.ok) throw new HttpError(502, `Navidrome couldn't list that album (${r.status})`);
      const list = (await r.json().catch(() => [])) as any[];
      return (Array.isArray(list) ? list : []).filter((x) => x && (x.albumId ?? x.album_id ?? albumId) === albumId);
    },
    /**
     * One page of every song in the library (`start` to `end`, sorted by album), with its file path, and how many
     * songs there are in all. Navidrome's own copy of the tags, so no file is opened.
     */
    async songs(start: number, end: number): Promise<{ songs: { id: string; path: string; title: string; trackNumber: number; albumId: string; album: string; artist: string; albumArtist: string; albumArtistId: string }[]; total: number }> {
      const r = await call(`/api/song?${new URLSearchParams({ _start: String(start), _end: String(end), _sort: 'album', _order: 'ASC' })}`, {
        headers: { 'x-nd-authorization': `Bearer ${session.token}` },
      });
      if (!r.ok) throw new HttpError(502, `Navidrome couldn't list the songs (${r.status})`);
      const list = (await r.json().catch(() => [])) as any[];
      const songs = (Array.isArray(list) ? list : []).filter((x) => x?.id && typeof x.title === 'string').map((x) => ({
        id: String(x.id),
        path: String(x.path ?? ''),
        title: String(x.title),
        trackNumber: Number(x.trackNumber ?? 0) || 0,
        albumId: String(x.albumId ?? x.album_id ?? ''),
        album: String(x.album ?? ''),
        artist: String(x.artist ?? ''),
        albumArtist: String(x.albumArtist ?? x.album_artist ?? ''),
        albumArtistId: String(x.albumArtistId ?? x.album_artist_id ?? ''),
      }));
      const total = Number(r.headers.get('x-total-count'));
      return { songs, total: Number.isFinite(total) && total > 0 ? total : start + songs.length };
    },
    /** Every album with its genres (for the genre review). */
    async albums(): Promise<{ id: string; name: string; artist: string; genres: string[]; songs: number }[]> {
      const r = await call(`/api/album?${new URLSearchParams({ _start: '0', _end: '50000', _sort: 'name', _order: 'ASC' })}`, {
        headers: { 'x-nd-authorization': `Bearer ${session.token}` },
      });
      if (!r.ok) throw new HttpError(502, `Navidrome couldn't list the albums (${r.status})`);
      const list = (await r.json().catch(() => [])) as any[];
      return (Array.isArray(list) ? list : []).filter((a) => a?.id).map((a) => {
        const names = (Array.isArray(a.genres) ? a.genres : []).map((g: { name?: unknown }) => String(g?.name ?? '')).filter(Boolean);
        return {
          id: String(a.id),
          name: String(a.name ?? ''),
          artist: String(a.albumArtist || a.artist || ''),
          genres: names.length ? [...new Set<string>(names)] : a.genre ? [String(a.genre)] : [],
          songs: Number(a.songCount ?? 0),
        };
      });
    },
    /** Artist and genre names in the library, for the tag editor's suggestions. */
    async names(): Promise<{ artists: string[]; genres: string[] }> {
      const list = async (path: string) => {
        const r = await call(path, { headers: { 'x-nd-authorization': `Bearer ${session.token}` } });
        const v = r.ok ? ((await r.json().catch(() => [])) as unknown) : [];
        return (Array.isArray(v) ? v : []).map((x) => String((x as { name?: unknown })?.name ?? '')).filter(Boolean);
      };
      const [artists, genres] = await Promise.all([
        list(`/api/artist?${new URLSearchParams({ _start: '0', _end: '20000', _sort: 'name', _order: 'ASC' })}`),
        list(`/api/genre?${new URLSearchParams({ _start: '0', _end: '2000', _sort: 'name', _order: 'ASC' })}`),
      ]);
      return { artists, genres };
    },
    async createUser(u: { userName: string; name: string; password: string }) {
      const r = await call('/api/user', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-nd-authorization': `Bearer ${session.token}` },
        body: JSON.stringify({ ...u, email: '', isAdmin: false }),
      });
      if (r.ok) return;
      const text = await r.text().catch(() => '');
      if (r.status === 409 || /unique|exists|already/i.test(text)) throw new HttpError(409, `Navidrome already has a user called ${u.userName}. Enter that person's Navidrome login instead`);
      throw new HttpError(502, `Navidrome couldn't make the account (${r.status})`);
    },
  };
}

/**
 * Own Navidrome profiles (docs/USERS-AND-ADMIN.md Phase 2): the Hub makes a Navidrome account for someone
 * with the admin login it keeps, and saves it as their own login, so their devices get it on sign-in.
 */
export function navidromeRoutes(app: FastifyInstance, { db, config }: Ctx) {
  app.post<{ Params: { id: string; userId: string } }>('/api/admin/services/:id/users/:userId/navidrome-account', async (req) => {
    const { user } = need(req, 'keys.manage');
    const s = serviceForHub(db, config.secretKey, Number(req.params.id));
    if (!s || s.kind !== 'navidrome') throw new HttpError(404, 'No such Navidrome server');
    const target = getUser(db, Number(req.params.userId));
    if (!target) throw new HttpError(404, 'No such user');
    if (!s.secrets.adminUsername || !s.secrets.adminPassword) throw new HttpError(409, 'Add the Navidrome admin login first');
    const nd = await navidromeAdmin(s.url, s.secrets.adminUsername, s.secrets.adminPassword);
    const password = randomBytes(18).toString('base64url');
    await nd.createUser({ userName: target.username, name: target.displayName, password });
    const service = setServiceUser(db, config.secretKey, s.id, target.id, { username: target.username, password });
    audit(db, { actorId: user.id, action: 'navidrome.account_created', target: target.username, detail: { server: s.name }, ip: clientIp(req) });
    return { service };
  });
}
