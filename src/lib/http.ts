import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** fetch() that goes through Rust inside the app (no CORS limits), plain fetch in a browser. */
export function http(url: string, init?: RequestInit): Promise<Response> {
  return isTauri ? tauriFetch(url, init) : fetch(url, init);
}

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
