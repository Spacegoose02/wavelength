import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Public music APIs that refuse browser requests from other sites (no CORS). In a browser, a signed-in Hub
 * fetches them instead (hub/src/routes/webfetch.ts keeps the same list).
 */
const NO_CORS_HOSTS = new Set(['api.deezer.com', 'us.api.iheart.com', 'www.billboard.com', 'rss.applemarketingtools.com', 'www.radiowavemonitor.com', 'open.spotify.com']);

let hubFetch: (() => { url: string; token: string } | undefined) | undefined;
/** store/hub.ts tells this module how to reach the signed-in Hub (set here to avoid an import cycle). */
export function setHubFetch(fn: typeof hubFetch) {
  hubFetch = fn;
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

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

export async function getJson<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await http(url, init);
  if (!res.ok) {
    // Strip the query string so tokens never end up in error messages.
    throw new Error(`${res.status} ${res.statusText || 'error'} — ${url.split('?')[0]}`);
  }
  return res.json() as Promise<T>;
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
