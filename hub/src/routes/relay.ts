import { createHash, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Ctx } from '../app.ts';
import { hmac, safeEqual } from '../crypto.ts';
import { getDevice } from '../devices.ts';
import { relayPassword, relayTarget } from '../services.ts';
import { getUser } from '../users.ts';
import { songNotForKids } from '../kidSafe.ts';

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

const one = (v: unknown) => (Array.isArray(v) ? String(v[0] ?? '') : typeof v === 'string' ? v : '');

export function relayRoutes(app: FastifyInstance, { db, config }: Ctx) {
  const key = config.secretKey;

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
    if (typeof who === 'string') return reply.code(401).send({ error: 'Wrong username or password' });
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

  app.get<{ Params: { id: string; method: string }; Querystring: Record<string, string | string[]> }>('/nd/:id/rest/:method', async (req, reply) => {
    const q: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.query ?? {})) q[k] = one(v);
    const method = req.params.method.replace(/\.view$/, '');

    const who = signIn(req.params.id, q.u, (expected) => passwordOf(q, expected));
    if (who === 'login') return fail(reply, 40, 'Wrong username or password');
    if (who === 'server') return fail(reply, 50, 'This Navidrome server isn’t shared with you through the Hub any more');
    const { user, target } = who;
    if (BLOCKED.has(method)) return fail(reply, 50, 'Not allowed through the Hub');

    const call = async (name: string, params: Record<string, string>, init: RequestInit = {}) => {
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
        const r = await call('getSong', { id: q.id, f: 'json' }, { signal: AbortSignal.timeout(15_000) });
        const song = ((await r.json()) as any)?.['subsonic-response']?.song;
        if (!song || songNotForKids(db, song)) return reply.code(403).send({ error: 'Not for kids' });
      } catch {
        return reply.code(502).send({ error: 'Couldn’t reach Navidrome' });
      }
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
  });
}
