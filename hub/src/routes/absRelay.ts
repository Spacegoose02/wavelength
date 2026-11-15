import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Ctx } from '../app.ts';
import { safeEqual } from '../crypto.ts';
import { getDevice } from '../devices.ts';
import { type Auth, HttpError } from '../http.ts';
import { permissionsFor } from '../roles.ts';
import { absRelayKey, absTarget } from '../services.ts';
import { getUser } from '../users.ts';

/**
 * Audiobookshelf through the Hub, for the app in a browser (docs/HUB.md "Audiobookshelf through the Hub").
 *
 * A browser page calling Audiobookshelf itself fails with only "NetworkError when attempting to fetch resource"
 * (Firefox) or "Failed to fetch" (Chrome) when Audiobookshelf doesn't list the page under Allowed CORS Origins,
 * when it's plain http under an https page, or when its address only works from the Hub (a Docker name or a LAN
 * address). Here the Hub makes the call with the person's saved API key and hands back the answer, so none of
 * those matter. The desktop and Android apps keep calling Audiobookshelf directly (no CORS there).
 *
 * `/api/abs/<server id>/<Audiobookshelf path>`. API calls sign in with the Hub token as usual; covers and audio
 * (loaded by <img> and <audio>, which can't send headers) carry the device's relay key as `?k=` (services.ts).
 */

/** Only Audiobookshelf's API and its stream paths, never its web UI. */
const PATH = /^(api|s)\/[^?#]*$/;
const PASS_UP = ['content-type', 'range', 'accept', 'if-none-match', 'if-modified-since'];
const PASS_DOWN = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control', 'etag', 'last-modified', 'content-disposition'];
/** How long Audiobookshelf has to start answering. A stream itself can run for hours. */
const ANSWER_MS = 30_000;
const BODY_LIMIT = 4 * 1024 * 1024;

export function absRelayRoutes(app: FastifyInstance, { db, config }: Ctx) {
  const key = config.secretKey;

  /** The caller: a Hub token in the header, or this device's relay key in `?k=`. */
  function caller(req: FastifyRequest, k: string | undefined): Auth | undefined {
    if (req.auth) return req.auth;
    const deviceId = Number((k ?? '').split('.')[0]);
    const device = Number.isInteger(deviceId) && deviceId > 0 ? getDevice(db, deviceId) : undefined;
    const user = device && getUser(db, device.userId);
    if (!device || !user || user.disabled || !safeEqual(k!, absRelayKey(key, device.id))) return undefined;
    return { user, device, permissions: permissionsFor(user) };
  }

  const handler = async (req: FastifyRequest<{ Params: { id: string; '*': string }; Querystring: Record<string, string> }>, reply: FastifyReply) => {
    const path = req.params['*'];
    if (!PATH.test(path) || path.split('/').some((p) => p === '..' || p === '.' || /%2e|%2f|%5c/i.test(p))) throw new HttpError(400, 'Not an Audiobookshelf API path');
    const auth = caller(req, req.query.k);
    if (!auth) throw new HttpError(401, 'Sign in to the Hub first');
    const target = absTarget(db, key, Number(req.params.id), auth);
    if (!target) throw new HttpError(404, 'This Audiobookshelf server isn’t shared with you, or has no API key on the Hub');

    // pass the query on without our key or any Audiobookshelf token the app tacked on
    const q = new URLSearchParams(req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '');
    q.delete('k');
    q.delete('token');
    const url = `${target.url.replace(/\/+$/, '')}/${path}${q.size ? `?${q}` : ''}`;

    const headers: Record<string, string> = { authorization: `Bearer ${target.token}` };
    for (const h of PASS_UP) if (typeof req.headers[h] === 'string') headers[h] = req.headers[h] as string;
    let body: string | undefined;
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined && req.body !== null) {
      body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      if (!headers['content-type']) headers['content-type'] = 'application/json';
    }

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), ANSWER_MS);
    req.raw.on('close', () => ac.abort());
    let res: Response;
    try {
      res = await fetch(url, { method: req.method, headers, body, signal: ac.signal, redirect: 'manual' });
    } catch (e) {
      const why = (e as Error).name === 'AbortError' || (e as Error).name === 'TimeoutError' ? 'it didn’t answer in time' : ((e as { cause?: { code?: string } }).cause?.code ?? (e as Error).message);
      throw new HttpError(502, `The Hub couldn’t reach Audiobookshelf at ${target.url} (${why}). Check the address saved for it in the Hub’s Settings → Sources.`);
    } finally {
      clearTimeout(timer);
    }
    // a key Audiobookshelf turns down is the Hub's saved login, not this device signing out of the Hub
    if (res.status === 401 || res.status === 403) {
      await res.body?.cancel();
      throw new HttpError(502, `Audiobookshelf turned down the API key saved on the Hub (${res.status}). Save a new key for it in Settings → Sources.`);
    }
    reply.code(res.status);
    // fetch() has already unzipped a zipped answer, so its length no longer holds
    const unzipped = !!res.headers.get('content-encoding');
    for (const h of PASS_DOWN) {
      const v = res.headers.get(h);
      if (v && !(unzipped && h === 'content-length')) reply.header(h, v);
    }
    if (!res.headers.get('cache-control')) reply.header('cache-control', 'private, no-store');
    if (!res.body || req.method === 'HEAD') return reply.send();
    // JSON whole, so the Hub can zip it on (compress.ts); covers and audio streamed as they come
    if (/json|^text\//i.test(res.headers.get('content-type') ?? '')) {
      reply.removeHeader('content-length');
      return reply.send(Buffer.from(await res.arrayBuffer()));
    }
    return reply.send(Readable.fromWeb(res.body as any));
  };

  app.route({ method: 'GET', url: '/api/abs/:id/*', handler });
  app.route({ method: ['POST', 'PATCH', 'PUT', 'DELETE'], url: '/api/abs/:id/*', bodyLimit: BODY_LIMIT, handler });
}
