import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { HttpError, signedIn } from '../http.ts';

/**
 * Public music APIs that don't allow browser requests from other sites (no CORS). The desktop and Android
 * apps call them directly; in a browser (docs/HUB.md "In a browser") the app asks the Hub to fetch them.
 * Only these hosts, only GET, only for signed-in people, so the Hub can't be used to reach anything else.
 */
export const WEB_FETCH_HOSTS = new Set(['api.deezer.com', 'us.api.iheart.com', 'www.billboard.com', 'rss.applemarketingtools.com', 'www.radiowavemonitor.com', 'open.spotify.com']);

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

function allowed(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new HttpError(400, 'Send a link');
  }
  if (u.protocol !== 'https:' || !WEB_FETCH_HOSTS.has(u.hostname) || u.port || u.username || u.password) {
    throw new HttpError(403, 'The Hub only fetches a few public music sites for the browser');
  }
  return u;
}

export function webFetchRoutes(app: FastifyInstance, _ctx: Ctx) {
  app.get('/api/fetch', async (req, reply) => {
    signedIn(req);
    let url = allowed(String((req.query as Record<string, unknown>).url ?? ''));
    let res: Response | undefined;
    // follow redirects by hand, so each hop has to be on the list too
    for (let hop = 0; hop < 4; hop++) {
      res = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Wavelength', accept: 'application/json, text/html;q=0.9, */*;q=0.5' },
      }).catch(() => {
        throw new HttpError(502, `Couldn't reach ${url.hostname}`);
      });
      const next = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!next) break;
      url = allowed(new URL(next, url).toString());
    }
    if (!res || (res.status >= 300 && res.status < 400)) throw new HttpError(502, 'Too many redirects');
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length > MAX_BYTES) throw new HttpError(502, 'That page is too big');
    return reply
      .code(res.status)
      .header('content-type', res.headers.get('content-type') ?? 'application/octet-stream')
      .header('cache-control', 'no-store')
      .send(body);
  });
}
