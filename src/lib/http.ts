import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Public music APIs that refuse browser requests from other sites (no CORS). In a browser, a signed-in Hub
 * fetches them instead (hub/src/routes/webfetch.ts keeps the same list).
 */
const NO_CORS_HOSTS = new Set(['api.deezer.com', 'us.api.iheart.com', 'www.billboard.com', 'rss.applemarketingtools.com', 'rss.marketingtools.apple.com', 'www.radiowavemonitor.com', 'open.spotify.com']);

let hubFetch: (() => { url: string; token: string } | undefined) | undefined;
/** store/hub.ts tells this module how to reach the signed-in Hub (set here to avoid an import cycle). */
export function setHubFetch(fn: typeof hubFetch) {
  hubFetch = fn;
}

/** The signed-in Hub's address and token, if any. */
export function hubEndpoint() {
  return hubFetch?.();
}

/** fetch() that goes through Rust inside the app (no CORS limits), plain fetch in a browser. */
export function http(url: string, init?: RequestInit): Promise<Response> {
  if (isTauri) return tauriFetch(url, init);
  const hub = hubFetch?.();
  if (hub && (init?.method ?? 'GET') === 'GET' && NO_CORS_HOSTS.has(hostOf(url))) {
    return fetch(`${hub.url}/api/fetch?${qs({ url })}`, { signal: init?.signal, headers: { authorization: `Bearer ${hub.token}` } });
  }
  return fetch(url, init);
}

/**
 * Discover's charts: from the signed-in Hub's copy (hub/src/discover.ts), so opening Discover doesn't pull
 * every chart again and a chart service that's down still shows its last good copy. `stale` is set when the
 * Hub's source failed and this is that older copy. With no Hub, or a Hub too old to keep charts, it's http().
 */
export async function chartFetch(url: string, init?: RequestInit): Promise<{ res: Response; stale?: Date }> {
  const hub = hubFetch?.();
  if (hub && NO_CORS_HOSTS.has(hostOf(url))) {
    const res = await http(`${hub.url}/api/discover/fetch?${qs({ url })}`, { headers: { authorization: `Bearer ${hub.token}` } }).catch(() => undefined);
    if (res?.ok) {
      const at = res.headers.get('x-wavelength-fetched-at');
      return { res, stale: res.headers.get('x-wavelength-stale') === '1' && at ? new Date(at) : undefined };
    }
  }
  return { res: await http(url, init) };
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

/** Fetch a URL and parse its JSON. Errors name the URL without its query string, so tokens never show. */
export async function getJson<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await http(url, init);
  const where = url.split('?')[0];
  if (!res.ok) throw new Error(`${res.status} ${res.statusText || 'error'} — ${where}`);
  try {
    return JSON.parse(await res.text()) as T;
  } catch (e) {
    // a reply cut short reads as "Expected ':' after property name…", which says nothing about where it came from
    throw new Error(`Couldn't read the reply from ${where} (${(e as Error).message})`);
  }
}

export function trimSlash(url: string) {
  return url.trim().replace(/\/+$/, '');
}

type QsValue = string | number | boolean | undefined;

/** Arrays become repeated keys (?songId=a&songId=b), as Subsonic expects. */
export function qs(params: Record<string, QsValue | QsValue[]>) {
  return Object.entries(params)
    .flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x] as const) : [[k, v] as const]))
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

/**
 * 502/503/504 come from a reverse proxy (nginx, Caddy, Traefik, Cloudflare…) in front of the server, not from
 * the server itself or the Hub: the proxy answered but couldn't reach what's behind it. Say so, since the
 * bare status reads like Wavelength's fault.
 */
export function gatewayHint(msg: string) {
  if (!/^50[234]\b/.test(msg)) return msg;
  return `${msg}. The web proxy in front of this server answered, but couldn't reach the server behind it. Check the server is running, and that the proxy points at the right address and port (Audiobookshelf's own port is 13378 unless you changed it). Opening the address in a browser should show the same error until it's fixed.`;
}
