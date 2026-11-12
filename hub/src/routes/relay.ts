import { createHash, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Ctx } from '../app.ts';
import { hmac, safeEqual } from '../crypto.ts';
import { getDevice } from '../devices.ts';
import { relayPassword, relayTarget, serviceIdOfKind } from '../services.ts';
import { getUser } from '../users.ts';
import { songNotForKids } from '../kidSafe.ts';
import { join } from 'node:path';
import { ALONE, answer, cover, SERVED, songsById, type Starred } from '../subsonicCatalog.ts';
import { sendSong } from '../catalogStream.ts';
import { playedBy } from '../playedBy.ts';
import { permissionsFor } from '../roles.ts';
import { addStation, deleteStation, radioImportedAt, readStation, subsonicStations, updateStation } from '../radioStations.ts';
import { HttpError } from '../http.ts';
import { importUserData, played, playsOf, rate, star, starredOf, userDataImported } from '../userData.ts';
import { createPlaylist, deletePlaylist, getPlaylist, importPlaylists, playlistsImported, replaceSongs, updatePlaylist, visiblePlaylists, type HubPlaylist } from '../playlists.ts';
import { knownPositions, playlistDuration, playlistEntries } from '../subsonicCatalog.ts';

/**
 * Navidrome through the Hub (docs/USERS-AND-ADMIN.md Phase 4). A device gets a Subsonic login for
 * `/nd/<server id>` that only the Hub knows about (one per device, see services.ts `relayPassword`). The Hub
 * checks it, swaps in the person's real Navidrome login and passes the call on, so that login never sits on
 * the device. Kids always go through here, and for them the Hub also refuses to play anything explicit or
 * flagged as not for kids, as a backstop to the app's own filters.
 */

/** Things a relayed login may not do: user and server admin, and shares that would hand the music out. */
const BLOCKED = new Set([
  'createUser', 'updateUser', 'deleteUser', 'changePassword', 'getUsers', 'startScan',
  'createShare', 'updateShare', 'deleteShare', 'createInternetRadioStation', 'updateInternetRadioStation',
  'deleteInternetRadioStation', 'createPodcastChannel', 'deletePodcastChannel', 'deletePodcastEpisode',
  'refreshPodcasts', 'downloadPodcastEpisode', 'jukeboxControl',
]);
/** Calls that hand over the audio itself. */
const AUDIO = new Set(['stream', 'download', 'hls']);
/** Response headers worth passing back (Range requests need the content-range ones to seek). */
const PASS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control', 'last-modified', 'etag', 'content-disposition'];
const AUTH = new Set(['u', 'p', 't', 's', 'apiKey']);
/** Playlist calls the Hub answers once it keeps a person's playlists (playlists.ts) */
const PLAYLIST_CALLS = new Set(['getPlaylists', 'getPlaylist', 'createPlaylist', 'updatePlaylist', 'deletePlaylist']);

const md5 = (s: string) => createHash('md5').update(s).digest('hex');

function fail(reply: FastifyReply, code: number, message: string) {
  // Subsonic answers errors with 200 and an error body; clients look at the body
  return reply.code(200).send({ 'subsonic-response': { status: 'failed', version: '1.16.1', error: { code, message } } });
}

function passwordOf(q: Record<string, string>, expected: string): boolean {
  if (q.t && q.s) return safeEqual(q.t.toLowerCase(), md5(expected + q.s));
  if (!q.p) return false;
  const p = q.p.startsWith('enc:') ? Buffer.from(q.p.slice(4), 'hex').toString('utf8') : q.p;
  return safeEqual(p, expected);
}

/**
 * A relay login always ends in `~<device id>`. Without it someone typed their own Navidrome login over the one the
 * Hub gave the device, so say what this address is rather than only "wrong password".
 */
const wrongLogin = (u: string | undefined) => /~\d+$/.test(u ?? '')
  ? 'Wrong username or password'
  : 'Wrong username or password. This address is Navidrome through your Hub, which signs your devices in by itself: use the login the Hub gave this device (Wavelength fills it in), not your Navidrome one';

const one = (v: unknown) => (Array.isArray(v) ? String(v[0] ?? '') : typeof v === 'string' ? v : '');

export function relayRoutes(app: FastifyInstance, { db, config, catalog, sonic }: Ctx) {
  const key = config.secretKey;
  const coverCache = join(config.dataDir, 'covers');
  /** each person's Navidrome stars, for the Hub's own answers (a minute old at most; starring clears it) */
  const stars = new Map<number, { at: number; ids: Starred }>();
  /** people whose hearts and plays are being copied from Navidrome right now (one copy each) */
  const copying = new Map<number, Promise<boolean>>();
  /** what each device last said it's playing (scrobble without submission), for getNowPlaying without Navidrome */
  const nowPlaying = new Map<number, { userId: number; username: string; songId: string; at: number }>();
  /** playlists deleted on the Hub, so Navidrome's list doesn't bring them back if its delete hasn't landed yet */
  const deleted = new Map<number, Set<string>>();
  const wasDeleted = (userId: number, id: string) => deleted.get(userId)?.has(id) ?? false;


  /** Check a relay login (`u` is "<hub username>~<device id>") and find the real one behind it. */
  function signIn(serviceId: string, u: string | undefined, check: (expected: string) => boolean) {
    const m = /^(.+)~(\d+)$/.exec(u ?? '');
    const device = m ? getDevice(db, Number(m[2])) : undefined;
    const user = device && getUser(db, device.userId);
    if (!m || !device || !user || user.disabled || user.username !== m[1] || !check(relayPassword(key, device.id))) return 'login' as const;
    const target = relayTarget(db, key, Number(serviceId), user.id, user.role);
    return target ? { device, user, target } : ('server' as const);
  }

  // Navidrome's own API, for play history only (src/sources/navidrome.ts getHistory): the app signs in to
  // the relay, which answers with a token of its own, and the Hub signs in to Navidrome as the real user.
  const nativeToken = (deviceId: number) => `${deviceId}.${hmac(key, `navidrome-relay-native:${deviceId}`)}`;
  app.post<{ Params: { id: string } }>('/nd/:id/auth/login', async (req, reply) => {
    const b = (req.body ?? {}) as { username?: unknown; password?: unknown };
    const who = signIn(req.params.id, typeof b.username === 'string' ? b.username : '', (expected) => typeof b.password === 'string' && safeEqual(b.password, expected));
    if (typeof who === 'string') return reply.code(401).send({ error: wrongLogin(typeof b.username === 'string' ? b.username : '') });
    return { token: nativeToken(who.device.id), username: b.username, isAdmin: false };
  });
  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>('/nd/:id/api/song', async (req, reply) => {
    const token = String(req.headers['x-nd-authorization'] ?? '').replace(/^Bearer /, '');
    const deviceId = Number(token.split('.')[0]);
    const device = getDevice(db, deviceId);
    const user = device && getUser(db, device.userId);
    if (!device || !user || user.disabled || !safeEqual(token, nativeToken(deviceId))) return reply.code(401).send({ error: 'Sign in again' });
    const target = relayTarget(db, key, Number(req.params.id), user.id, user.role);
    if (!target) return reply.code(403).send({ error: 'Not shared with you any more' });
    if (catalog.standalone()) {
      // without Navidrome: the person's plays kept on the Hub, last played first (the only use: play history)
      const start = Math.max(0, Number(req.query._start) || 0), end = Math.min(start + 1000, Math.max(start, Number(req.query._end) || start + 100));
      const mine = playsOf(db, user.id);
      const ids = [...mine].filter(([, p]) => p.last).sort((a, b) => (b[1].last ?? 0) - (a[1].last ?? 0)).map(([id]) => id);
      const songs = songsById(db, ids.slice(start, end), starredOf(db, user.id), mine, (id) => ({ playDate: new Date(mine.get(id)!.last!).toISOString(), playCount: mine.get(id)!.count }))
        .map((x) => ({ ...x, trackNumber: x.track, mediaFileId: x.id }));
      return reply.header('x-total-count', String(ids.length)).send(songs);
    }
    try {
      const login = await fetch(`${target.url}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: target.username, password: target.password }), signal: AbortSignal.timeout(15_000) });
      const nd = (await login.json()) as { token?: string };
      if (!nd.token) return reply.code(502).send({ error: 'Navidrome refused the login kept on the Hub' });
      const search = new URLSearchParams(req.query).toString();
      const res = await fetch(`${target.url}/api/song?${search}`, { headers: { 'x-nd-authorization': `Bearer ${nd.token}` }, signal: AbortSignal.timeout(15_000) });
      reply.code(res.status).header('content-type', res.headers.get('content-type') ?? 'application/json');
      return reply.send(await res.text());
    } catch {
      return reply.code(502).send({ error: 'Couldn’t reach Navidrome' });
    }
  });

  type RestReq = FastifyRequest<{ Params: { id?: string; method: string }; Querystring: Record<string, string | string[]> }>;
  const rest = async (serviceId: string, req: RestReq, reply: FastifyReply) => {
    const q: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.query ?? {})) q[k] = one(v);
    const method = req.params.method.replace(/\.view$/, '');

    const who = signIn(serviceId, q.u, (expected) => passwordOf(q, expected));
    if (who === 'login') return fail(reply, 40, wrongLogin(q.u));
    if (who === 'server') return fail(reply, 50, 'This Navidrome server isn’t shared with you through the Hub any more');
    const { user, target } = who;
    // Navidrome is off for this household (catalog.ts standalone): everything below is answered here, nothing is
    // passed on, and what the Hub can't answer is an error rather than a call to a server that isn't there
    const off = catalog.standalone();
    // Radio stations live on the Hub once it has copied Navidrome's (radioStations.ts); admins change them here too
    if (method.endsWith('InternetRadioStation') || method === 'getInternetRadioStations') {
      if (radioImportedAt(db) !== null || off) {
        const done = (body: Record<string, unknown> = {}) => reply.send({ 'subsonic-response': { status: 'ok', version: '1.16.1', type: 'wavelength-hub', openSubsonic: true, ...body } });
        if (method === 'getInternetRadioStations') return done({ internetRadioStations: { internetRadioStation: subsonicStations(db) } });
        if (!permissionsFor(user).includes('library.edit')) return fail(reply, 50, 'Only admins can change radio stations');
        try {
          if (method === 'createInternetRadioStation') addStation(db, readStation({ name: q.name, streamUrl: q.streamUrl, homePageUrl: q.homepageUrl ?? q.homePageUrl }) as { name: string; streamUrl: string; homePageUrl?: string });
          else if (method === 'updateInternetRadioStation') updateStation(db, q.id ?? '', readStation({ name: q.name, streamUrl: q.streamUrl, homePageUrl: q.homepageUrl ?? q.homePageUrl }, true));
          else if (method === 'deleteInternetRadioStation') deleteStation(db, q.id ?? '');
          else return fail(reply, 0, 'Unknown radio call');
        } catch (e) {
          return fail(reply, e instanceof HttpError && e.statusCode === 404 ? 70 : 10, (e as Error).message);
        }
        return done();
      }
    }
    if (BLOCKED.has(method)) return fail(reply, 50, 'Not allowed through the Hub');

    const call = async (name: string, params: Record<string, string>, init: RequestInit = {}) => {
      if (off) throw new Error('Navidrome is off');
      const salt = randomBytes(6).toString('hex');
      const search = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) if (!AUTH.has(k)) search.append(k, v);
      search.set('u', target.username);
      search.set('t', md5(target.password + salt));
      search.set('s', salt);
      search.set('v', params.v || '1.16.1');
      search.set('c', params.c || 'wavelength-hub');
      return fetch(`${target.url}/rest/${name}?${search}`, { ...init, redirect: 'manual' });
    };

    if (user.role === 'kid' && AUDIO.has(method) && q.id) {
      try {
        const r = off ? null : await call('getSong', { id: q.id, f: 'json' }, { signal: AbortSignal.timeout(15_000) });
        const song = r ? ((await r.json()) as any)?.['subsonic-response']?.song : (answer(db, 'getSong', { id: q.id }, new Map()) as any)?.['subsonic-response']?.song;
        if (!song || songNotForKids(db, song)) return reply.code(403).send({ error: 'Not for kids' });
      } catch {
        return reply.code(502).send({ error: 'Couldn’t reach Navidrome' });
      }
    }

    if (method === 'star' || method === 'unstar') stars.delete(user.id);

    // Hearts, plays and ratings kept on the Hub (userData.ts), when an admin turned it on: copied from Navidrome the
    // first time, then recorded here and passed on to Navidrome in the background so it stays complete.
    // Their own playlists too (playlists.ts), copied at the same time; smart playlists stay on Navidrome.
    let mineOnHub = false;
    let playlistsOnHub = false;
    if (off) {
      // whatever was copied before Navidrome went off (Settings copies everyone when it's turned off) is all there is
      mineOnHub = playlistsOnHub = true;
    } else if (catalog.keepsUserData()) {
      if (!userDataImported(db, user.id) || !playlistsImported(db, user.id)) {
        let p = copying.get(user.id);
        if (!p) {
          p = (async () => {
            if (!userDataImported(db, user.id)) await importUserData(db, user.id, target).catch(() => undefined);
            if (!playlistsImported(db, user.id)) await importPlaylists(db, user.id, target).catch(() => undefined);
            return true;
          })().finally(() => copying.delete(user.id));
          copying.set(user.id, p);
        }
        await p;
      }
      mineOnHub = userDataImported(db, user.id);
      playlistsOnHub = playlistsImported(db, user.id);
    }
    if (mineOnHub && (method === 'star' || method === 'unstar' || method === 'scrobble' || method === 'setRating')) {
      const all = (k: string) => {
        const v = (req.query as Record<string, string | string[]>)[k];
        return (Array.isArray(v) ? v : v === undefined ? [] : [v]).map(String).filter(Boolean);
      };
      if (method === 'star' || method === 'unstar') star(db, user.id, [...all('id'), ...all('albumId'), ...all('artistId')], method === 'star');
      else if (method === 'setRating') rate(db, user.id, q.id ?? '', Number(q.rating) || 0);
      else if (q.submission !== 'false') {
        const times = all('time');
        all('id').forEach((id, i) => played(db, user.id, id, Number(times[i]) || Date.now()));
      }
      if (method === 'scrobble' && q.submission === 'false' && q.id) nowPlaying.set(who.device.id, { userId: user.id, username: user.username, songId: q.id, at: Date.now() });
      if (off) return reply.header('x-wavelength-answered-by', 'hub').send({ 'subsonic-response': { status: 'ok', version: '1.16.1', type: 'wavelength-hub', openSubsonic: true } });
      // Navidrome gets it too, without the device waiting for it
      const search = new URLSearchParams();
      for (const [k, v] of Object.entries(req.query as Record<string, string | string[]>)) if (!AUTH.has(k)) for (const x of Array.isArray(v) ? v : [v]) search.append(k, String(x));
      const salt = randomBytes(6).toString('hex');
      search.set('u', target.username);
      search.set('t', md5(target.password + salt));
      search.set('s', salt);
      void fetch(`${target.url}/rest/${method}?${search}`, { signal: AbortSignal.timeout(30_000) }).catch(() => undefined);
      return reply.header('x-wavelength-answered-by', 'hub').send({ 'subsonic-response': { status: 'ok', version: '1.16.1', type: 'wavelength-hub', openSubsonic: true } });
    }

    if (playlistsOnHub && PLAYLIST_CALLS.has(method)) {
      const all = (k: string) => {
        const v = (req.query as Record<string, string | string[]>)[k];
        return (Array.isArray(v) ? v : v === undefined ? [] : [v]).map(String).filter(Boolean);
      };
      const ownerName = (p: HubPlaylist) => (p.ownerId === user.id ? q.u : getUser(db, p.ownerId)?.username ?? '');
      const usable = !!config.musicDir && catalog.serving();
      /** a playlist, with its songs (`withSongs`), or only their count and length (the list of playlists) */
      const entry = (p: HubPlaylist, withSongs = true) => {
        // without Navidrome there's no one else to ask: a song the catalog doesn't know (its file gone, or never
        // matched when Navidrome was turned off) is left out rather than the whole playlist failing
        const songs = withSongs && usable ? playlistEntries(db, p.songs, mineOnHub ? starredOf(db, user.id) : new Map(), mineOnHub ? playsOf(db, user.id) : null, off) : null;
        const duration = songs ? songs.reduce((n, x) => n + Number(x.duration ?? 0), 0) : usable ? playlistDuration(db, p.songs) : 0;
        return {
          id: p.id, name: p.name, ...(p.comment && { comment: p.comment }), owner: ownerName(p), public: p.public, songCount: songs ? songs.length : p.songs.length,
          duration, created: new Date(p.created).toISOString(), changed: new Date(p.changed).toISOString(),
          coverArt: `pl-${p.id}`, songs,
        };
      };
      const done = (body: Record<string, unknown> = {}) => reply.header('x-wavelength-answered-by', 'hub').send({ 'subsonic-response': { status: 'ok', version: '1.16.1', type: 'wavelength-hub', openSubsonic: true, ...body } });
      const navidromeToo = async (search: URLSearchParams) => {
        if (off) throw new Error('Navidrome is off');
        for (const k of AUTH) search.delete(k);
        const salt = randomBytes(6).toString('hex');
        search.set('u', target.username);
        search.set('t', md5(target.password + salt));
        search.set('s', salt);
        search.set('v', q.v || '1.16.1');
        search.set('c', q.c || 'wavelength-hub');
        search.set('f', 'json');
        return fetch(`${target.url}/rest/${method}?${search}`, { signal: AbortSignal.timeout(30_000) });
      };
      const asked = () => {
        const s = new URLSearchParams();
        for (const [k, v] of Object.entries(req.query as Record<string, string | string[]>)) for (const x of Array.isArray(v) ? v : [v]) s.append(k, String(x));
        return s;
      };

      if (method === 'getPlaylists') {
        // Navidrome's list (smart playlists, and anyone's not copied yet), with the Hub's copies in place of its own
        const hub = visiblePlaylists(db, user.id);
        const kept = new Set(hub.map((p) => p.id));
        let theirs: Record<string, unknown>[] = [];
        try {
          const r = await call('getPlaylists', { f: 'json' }, { signal: AbortSignal.timeout(15_000) });
          const list = ((await r.json()) as any)?.['subsonic-response']?.playlists?.playlist;
          if (Array.isArray(list)) theirs = list.filter((x: { id?: string; owner?: string }) => x?.id && !kept.has(String(x.id)) && !wasDeleted(user.id, String(x.id)));
        } catch {
          // Navidrome away: the Hub's own still show
        }
        const mine = hub.map((p) => {
          const { songs: _songs, ...rest } = entry(p, false);
          return rest;
        });
        return done({ playlists: { playlist: [...mine, ...theirs].sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''))) } });
      }
      if (method === 'getPlaylist') {
        const p = getPlaylist(db, q.id ?? '');
        if (p && (p.ownerId === user.id || p.public)) {
          const { songs, ...rest } = entry(p);
          if (songs) return done({ playlist: { ...rest, entry: songs } });
        }
        // not on the Hub (a smart one), or a song the catalog doesn't know: Navidrome answers it below
      } else if (method === 'createPlaylist') {
        const songs = all('songId');
        if (q.playlistId) {
          const p = getPlaylist(db, q.playlistId);
          if (p && p.ownerId !== user.id) return fail(reply, 50, 'That playlist belongs to someone else');
          if (p) {
            replaceSongs(db, p.id, songs);
            void navidromeToo(asked()).catch(() => undefined);
            const { songs: entries, ...rest } = entry(getPlaylist(db, p.id)!);
            return done({ playlist: { ...rest, entry: entries ?? [] } });
          }
        } else {
          // Navidrome first, so the playlist has the same id in both; the Hub alone if Navidrome is away
          let id: string | undefined;
          try {
            const r = await navidromeToo(asked());
            id = ((await r.json()) as any)?.['subsonic-response']?.playlist?.id;
          } catch {
            id = undefined;
          }
          const p = createPlaylist(db, user.id, q.name || 'New playlist', songs, id && !getPlaylist(db, String(id)) ? String(id) : undefined);
          const { songs: entries, ...rest } = entry(p);
          return done({ playlist: { ...rest, entry: entries ?? [] } });
        }
      } else if (method === 'updatePlaylist' || method === 'deletePlaylist') {
        const id = method === 'updatePlaylist' ? q.playlistId ?? '' : q.id ?? '';
        const p = getPlaylist(db, id);
        if (p) {
          if (p.ownerId !== user.id) return fail(reply, 50, 'That playlist belongs to someone else');
          if (method === 'deletePlaylist') {
            deletePlaylist(db, id);
            deleted.set(user.id, new Set([...(deleted.get(user.id) ?? []), id]));
          } else {
            const seen = off && usable ? knownPositions(db, p.songs) : null;
            updatePlaylist(db, id, {
              name: q.name || undefined,
              comment: q.comment,
              public: q.public === undefined ? undefined : q.public === 'true',
              add: all('songIdToAdd'),
              // without Navidrome, devices saw only the songs the catalog knows (entry() above): their positions
              removeAt: all('songIndexToRemove').map(Number).filter((n) => Number.isInteger(n) && n >= 0)
                .map((n) => (seen ? seen[n] ?? -1 : n)).filter((n) => n >= 0),
            });
          }
          void navidromeToo(asked()).catch(() => undefined);
          return done();
        }
      }
    }

    // The Hub's own answers from the music catalog (subsonicCatalog.ts), when an admin turned them on: same ids, so
    // playing and starring still go to Navidrome. Anything not answered here goes on to Navidrome below.
    if (catalog.serving() && config.musicDir) {
      if (method === 'getCoverArt' && q.id) {
        // artists' pictures and playlist covers stay Navidrome's while it's on; without it, an album's cover stands in
        let id = q.id;
        if (off && id.startsWith('pl-')) id = `mf-${getPlaylist(db, id.slice(3).replace(/_[0-9a-f]+$/, ''))?.songs[0] ?? ''}`;
        const art = off || !id.startsWith('ar-') ? await cover(db, config.musicDir, coverCache, id, Number(q.size) || 0).catch(() => null) : null;
        if (art) return reply.header('content-type', art.type).header('cache-control', 'public, max-age=86400').header('x-wavelength-answered-by', 'hub').send(art.body);
      } else if ((SERVED.has(method) || (off && ALONE.has(method))) && (q.f === 'json' || off) && mineOnHub) {
        const body = answer(db, method, q, starredOf(db, user.id), playsOf(db, user.id), off);
        if (body) return reply.header('x-wavelength-answered-by', 'hub').send(body);
      } else if (SERVED.has(method) && q.f === 'json') {
        let mine = stars.get(user.id);
        if (!mine || Date.now() - mine.at > 60_000) {
          try {
            const r = await call('getStarred2', { f: 'json' }, { signal: AbortSignal.timeout(15_000) });
            const s = ((await r.json()) as any)?.['subsonic-response']?.starred2;
            if (!s) throw new Error('no stars');
            const ids: Starred = new Map();
            for (const x of [...(s.song ?? []), ...(s.album ?? []), ...(s.artist ?? [])]) if (x?.id) ids.set(String(x.id), String(x.starred ?? new Date().toISOString()));
            stars.set(user.id, (mine = { at: Date.now(), ids }));
          } catch {
            mine = undefined; // Navidrome answers this one, stars and all
          }
        }
        const body = mine && answer(db, method, q, mine.ids);
        if (body) return reply.header('x-wavelength-answered-by', 'hub').send(body);
      }
    }

    // The Hub plays the file itself (catalogStream.ts), when an admin turned it on; scrobbles still go to Navidrome
    if ((method === 'stream' || method === 'download') && q.id && config.musicDir && catalog.streaming()) {
      if (sendSong(db, config.musicDir, q.id, q, req, reply, method === 'download')) {
        if (method === 'stream') playedBy(who.device.id, 'hub');
        return reply;
      }
    }
    if (method === 'stream') playedBy(who.device.id, 'navidrome');

    if (off) {
      const done = (body: Record<string, unknown> = {}) => reply.header('x-wavelength-answered-by', 'hub').send({ 'subsonic-response': { status: 'ok', version: '1.16.1', type: 'wavelength-hub', serverVersion: 'hub', openSubsonic: true, ...body } });
      const status = catalog.status();
      switch (method) {
        case 'ping':
          return done();
        case 'getLicense':
          return done({ license: { valid: true } });
        case 'getOpenSubsonicExtensions':
          return done({ openSubsonicExtensions: [{ name: 'songLyrics', versions: [1] }] });
        case 'getMusicFolders':
          return done({ musicFolders: { musicFolder: [{ id: 1, name: 'Music' }] } });
        case 'getScanStatus':
          return done({ scanStatus: { scanning: status.scanning, count: status.files, ...(status.lastScanAt && { lastScan: new Date(status.lastScanAt).toISOString() }) } });
        case 'startScan':
          void catalog.scan().catch(() => undefined);
          return done({ scanStatus: { scanning: true, count: status.files } });
        case 'getUser':
          return done({ user: { username: q.u ?? '', scrobblingEnabled: true, adminRole: false, settingsRole: false, downloadRole: true, uploadRole: false, playlistRole: true, coverArtRole: false, commentRole: false, podcastRole: false, streamRole: true, jukeboxRole: false, shareRole: false, videoConversionRole: false, folder: [1] } });
        case 'getNowPlaying': {
          const fresh = [...nowPlaying.values()].filter((n) => Date.now() - n.at < 15 * 60_000);
          const entry = fresh.flatMap((n) => songsById(db, [n.songId], new Map(), null, () => ({ username: n.username, minutesAgo: Math.floor((Date.now() - n.at) / 60_000), playerId: 0 })));
          return done({ nowPlaying: { entry } });
        }
        case 'getLyricsBySongId':
          return done({ lyricsList: { structuredLyrics: [] } });
        case 'getLyrics':
          return done({ lyrics: {} });
        case 'getPlayQueue':
        case 'getBookmarks':
          return done(method === 'getBookmarks' ? { bookmarks: {} } : {});
        case 'savePlayQueue':
        case 'createBookmark':
        case 'deleteBookmark':
          return done();
        case 'getSimilarSongs':
        case 'getSimilarSongs2': {
          // the Hub's own sound-alike analysis (sonic/), when it has looked at this song
          const i = sonic?.index.find({ id: q.id });
          const count = Math.min(500, Math.max(1, Number(q.count) || 50));
          const ids = i === undefined ? [] : sonic!.index.similar(i, count).map((h) => h.id);
          const song = songsById(db, ids, starredOf(db, user.id), playsOf(db, user.id));
          return done(method === 'getSimilarSongs2' ? { similarSongs2: { song } } : { similarSongs: { song } });
        }
      }
      if (AUDIO.has(method)) return reply.code(404).send({ error: 'Not in the music folder' });
      return fail(reply, 70, `The Hub doesn’t know that (${method}), and Navidrome is off`);
    }

    // stop pulling from Navidrome when the player goes away (skipping, seeking)
    const abort = new AbortController();
    req.raw.on('close', () => abort.abort());
    const headers: Record<string, string> = {};
    for (const h of ['range', 'if-none-match', 'if-modified-since']) {
      const v = req.headers[h];
      if (typeof v === 'string') headers[h] = v;
    }
    let res: Response;
    try {
      res = await call(req.params.method, q, { headers, signal: abort.signal });
    } catch {
      return fail(reply, 0, `The Hub couldn’t reach Navidrome`);
    }
    reply.code(res.status >= 300 && res.status < 400 && res.status !== 304 ? 502 : res.status);
    // fetch() unzips a gzipped reply (Navidrome zips big JSON ones) but keeps the zipped content-length. Passed on,
    // that cut the reply off at the zipped size: big albums and artists came back as broken JSON.
    const unzipped = !!res.headers.get('content-encoding');
    for (const h of PASS) {
      const v = res.headers.get(h);
      if (v && !(unzipped && h === 'content-length')) reply.header(h, v);
    }
    return reply.send(res.body ? Readable.fromWeb(res.body as any) : null);
  };
  app.get<{ Params: { id: string; method: string }; Querystring: Record<string, string | string[]> }>('/nd/:id/rest/:method', (req, reply) => rest(req.params.id, req, reply));
  // The Hub's own address works too (http://hub:7780 instead of …/nd/1): apps that are given only the address ask
  // /rest/ping there, which otherwise got the web app's page back ("Unexpected token '<'").
  app.get<{ Params: { method: string }; Querystring: Record<string, string | string[]> }>('/rest/:method', (req, reply) => {
    const id = serviceIdOfKind(db, 'navidrome');
    if (id === undefined) return fail(reply, 50, 'This Hub has no music server to sign in to');
    return rest(String(id), req, reply);
  });
}
