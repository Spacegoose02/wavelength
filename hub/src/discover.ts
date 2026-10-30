import { HttpError } from './http.ts';
import { allowedUrl, fetchAllowed, type Fetched } from './routes/webfetch.ts';

/**
 * The Hub's copy of the Discover charts (routes/discover.ts). Every app signed in to the Hub reads charts
 * from here, so opening Discover doesn't hit Billboard, Deezer, iHeart, Spotify and friends again on every
 * device, and a chart service that is down or rate limiting still shows the last copy that worked.
 *
 * Kept in memory (it is a few MB at most). Each page the apps asked for in the last few days is fetched
 * again in the background every REFRESH_MS, so the copy the apps get is rarely older than that.
 */

/** Served as is when younger than this. */
const FRESH_MS = 30 * 60_000;
/** Between FRESH_MS and this, served right away and fetched again behind the scenes. */
const SERVE_STALE_MS = 6 * 60 * 60_000;
const REFRESH_MS = 30 * 60_000;
/** Pages nobody has opened for this long stop being refreshed, then are dropped. */
const FORGET_MS = 3 * 24 * 60 * 60_000;
const MAX_PAGES = 400;

export interface CachedPage extends Fetched {
  fetchedAt: number;
  /** The source failed just now (or is being fetched again), so this is the last copy that worked. */
  stale: boolean;
}

interface Entry extends Fetched {
  fetchedAt: number;
  wantedAt: number;
}

/**
 * Whether a response is worth keeping. Deezer answers rate limits ("Quota limit exceeded") and other
 * errors with a 200 and an `error` object, which must not replace a good copy.
 */
function usable(url: URL, r: Fetched): boolean {
  if (r.status < 200 || r.status >= 300) return false;
  if (url.hostname === 'api.deezer.com') {
    try {
      return !JSON.parse(r.body.toString('utf8'))?.error;
    } catch {
      return false;
    }
  }
  return true;
}

function upstreamError(url: URL, r: Fetched): HttpError {
  let why = `${url.hostname} answered ${r.status}`;
  if (url.hostname === 'api.deezer.com' && r.status === 200) {
    try {
      why = `Deezer: ${JSON.parse(r.body.toString('utf8'))?.error?.message ?? 'error'}`;
    } catch {
      why = 'Deezer sent something unreadable';
    }
  }
  return new HttpError(502, why);
}

export class ChartCache {
  private pages = new Map<string, Entry>();
  private inflight = new Map<string, Promise<Entry>>();
  private timer?: NodeJS.Timeout;
  private now: () => number;
  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  start() {
    this.timer ??= setInterval(() => void this.refreshAll(), REFRESH_MS);
    this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  get size() {
    return this.pages.size;
  }

  /** The page at `raw` (one of the hosts /api/fetch allows), from the cache when it can be. */
  async get(raw: string): Promise<CachedPage> {
    const url = allowedUrl(raw);
    const key = url.href;
    const hit = this.pages.get(key);
    const now = this.now();
    if (hit) hit.wantedAt = now;
    const age = hit ? now - hit.fetchedAt : Infinity;
    if (hit && age < FRESH_MS) return { ...hit, stale: false };
    if (hit && age < SERVE_STALE_MS) {
      this.fetch(url).catch(() => undefined);
      return { ...hit, stale: true };
    }
    try {
      return { ...(await this.fetch(url)), stale: false };
    } catch (err) {
      if (hit) return { ...hit, stale: true };
      throw err;
    }
  }

  /** Fetch every page someone opened recently again, one at a time; forget the rest. */
  async refreshAll() {
    const now = this.now();
    for (const [key, e] of [...this.pages]) {
      if (now - e.wantedAt > FORGET_MS) {
        this.pages.delete(key);
        continue;
      }
      if (now - e.fetchedAt >= REFRESH_MS - 60_000) await this.fetch(new URL(key)).catch(() => undefined);
    }
  }

  private fetch(url: URL): Promise<Entry> {
    const key = url.href;
    let p = this.inflight.get(key);
    if (p) return p;
    p = (async () => {
      const r = await fetchAllowed(key);
      if (!usable(url, r)) throw upstreamError(url, r);
      const e: Entry = { ...r, fetchedAt: this.now(), wantedAt: this.pages.get(key)?.wantedAt ?? this.now() };
      this.pages.set(key, e);
      this.trim();
      return e;
    })().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  /** Over the limit: drop the pages opened longest ago. */
  private trim() {
    if (this.pages.size <= MAX_PAGES) return;
    const oldest = [...this.pages].sort((a, b) => a[1].wantedAt - b[1].wantedAt);
    for (const [key] of oldest.slice(0, this.pages.size - MAX_PAGES)) this.pages.delete(key);
  }
}
