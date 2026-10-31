import { tx, type Db } from './db.ts';
import { HttpError } from './http.ts';
import { notify } from './notify.ts';
import { fetchAllowed } from './routes/webfetch.ts';

/**
 * Release Radar (docs/RELEASE-RADAR.md): each person follows artists, and the Hub looks those artists up on
 * Deezer's public API in the background and keeps their new releases, so the apps read one short list
 * instead of each asking Deezer about every artist. A release that turns up after someone followed the
 * artist becomes a notification ("New from …"). Suggestions are artists Deezer calls related to the ones
 * you follow and play, plus artists you play a lot but don't follow yet.
 *
 * Every artist is looked up once per CHECK_MS however many people follow them. Lookups run one after another
 * with a short pause, well under Deezer's 50 requests per 5 seconds.
 */

const DZ = 'https://api.deezer.com';
/** Releases from the last this many days are on the radar. */
export const WINDOW_DAYS = 42;
/** Announced releases (Deezer lists some before they're out) this far ahead show as "Coming soon". */
export const UPCOMING_DAYS = 120;
/** Kept this long, so a release doesn't count as "new" again if Deezer drops and re-adds it. */
const KEEP_DAYS = 120;
/** Each followed artist is looked up this often. */
const CHECK_MS = 12 * 60 * 60_000;
/** How often the Hub looks for artists due a lookup. */
const TICK_MS = 30 * 60_000;
/** Artists looked up per tick at most; the rest wait for the next one. */
const PER_TICK = 300;
/** Pause between Deezer calls in the background. */
const GAP_MS = 250;
/** A release found more than this long after it came out is listed, but not news worth a notification. */
const NOTIFY_DAYS = 14;
/** "Check now" skips artists looked up more recently than this. */
const RECHECK_MS = 10 * 60_000;
/** Deezer's related artists and name lookups change slowly. */
const LOOKUP_MS = 7 * 24 * 60 * 60_000;
/** Each person's suggestions are worked out again after this, or when they follow or hide someone. */
const SUGGEST_MS = 6 * 60 * 60_000;
export const MAX_FOLLOWS = 1000;
const DAY = 86_400_000;

export interface Followed {
  id: number;
  name: string;
  picture: string | null;
  followedAt: number;
  /** "Get new releases automatically" is on (since then). */
  autoGetAt: number | null;
}

/** What auto-get does with a new release for one person (wired to requests in routes/requests.ts). */
export type AutoGet = (userId: number, r: RadarRelease) => void | Promise<void>;

export interface RadarRelease {
  id: number;
  artistId: number;
  artist: string;
  title: string;
  /** album, ep, single or compile, as Deezer says. */
  type: string;
  /** YYYY-MM-DD */
  released: string;
  cover: string | null;
  link: string;
  explicit: boolean;
  /** When the Hub first saw it. */
  foundAt: number;
}

export interface Suggestion {
  id: number;
  name: string;
  picture: string | null;
  fans: number | null;
  /** Followed or played artists Deezer says this one is like. */
  because: string[];
  /** Set when it's suggested because you play them: how many times in the last 90 days. */
  plays?: number;
}

/** A song in someone's Weekly Mix: Deezer's, with a 30-second preview. */
export interface MixTrack {
  id: number;
  title: string;
  artist: string;
  album: string;
  cover: string | null;
  link: string;
  preview: string | null;
  explicit: boolean;
  duration: number;
  /** why it's in the mix, e.g. "New from Tame Impala" or "Like Khruangbin" */
  because: string;
}

/** The Friday a mix belongs to (YYYY-MM-DD): mixes are made fresh each Friday, like New Music Friday. */
export function mixWeek(now: number): string {
  const d = new Date(now);
  const back = (d.getUTCDay() + 2) % 7; // days since Friday
  return new Date(now - back * DAY).toISOString().slice(0, 10);
}

export interface DzArtist { id: number; name: string; picture: string | null; fans: number | null }

/** Same idea as the app's norm() (src/sources/registry.ts), so names compare the same way on both sides. */
export function normName(s = '') {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/^the\s+/, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
}

/** "Drake Featuring Future & Lil Baby" → "Drake", like the app's primaryArtist() (src/lib/match.ts). */
export const primaryArtist = (s: string) => s.split(/\s+(?:featuring|feat\.?|ft\.?|with|x|&|and|•)\s+|,\s*/i)[0].trim();

export async function deezer(path: string): Promise<any> {
  const r = await fetchAllowed(DZ + path);
  if (r.status !== 200) throw new Error(`Deezer answered ${r.status}`);
  let body: any;
  try {
    body = JSON.parse(r.body.toString('utf8'));
  } catch {
    throw new Error('Deezer sent something unreadable');
  }
  // rate limits and unknown ids come back as 200 { error }
  if (body?.error) throw new Error(`Deezer: ${body.error.message ?? 'error'}`);
  return body;
}

/**
 * The artist with exactly this name (case and accents don't matter) and the most fans, or null. Deezer often has
 * several artists with the same name (a dozen "Drake"s), and the first one it lists can be a small upload.
 * Like the app's sameNameArtists() (src/lib/artistMatch.ts).
 */
export function sameNameArtist<T extends { name: string; fans?: number | null }>(name: string, list: T[]): T | null {
  const key = normName(name);
  if (!key) return null;
  let best: T | null = null;
  for (const a of list) if (normName(a.name) === key && (!best || (a.fans ?? 0) > (best.fans ?? 0))) best = a;
  return best;
}

const toArtist = (a: any): DzArtist => ({ id: Number(a.id), name: String(a.name ?? ''), picture: a.picture_medium ?? a.picture ?? null, fans: typeof a.nb_fan === 'number' ? a.nb_fan : null });

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ReleaseRow { id: number; artist_id: number; artist: string; title: string; type: string; released: string; cover: string | null; link: string; explicit: number; found_at: number }
const outRelease = (r: ReleaseRow): RadarRelease => ({
  id: r.id, artistId: r.artist_id, artist: r.artist, title: r.title, type: r.type, released: r.released, cover: r.cover, link: r.link, explicit: !!r.explicit, foundAt: r.found_at,
});

export class ReleaseRadar {
  private db: Db;
  private now: () => number;
  private gapMs: number;
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private related = new Map<number, { at: number; list: DzArtist[] }>();
  private names = new Map<string, { at: number; artist: DzArtist | null }>();
  private suggested = new Map<number, { at: number; list: Suggestion[] }>();
  private mixes = new Map<number, { week: string; list: MixTrack[] }>();
  /** Set by routes/requests.ts: turns an auto-got release into a request. */
  autoGet?: AutoGet;

  constructor(db: Db, opts: { now?: () => number; gapMs?: number } = {}) {
    this.db = db;
    this.now = opts.now ?? Date.now;
    this.gapMs = opts.gapMs ?? GAP_MS;
  }

  start() {
    this.timer ??= setInterval(() => void this.checkDue().catch(() => undefined), TICK_MS);
    this.timer.unref();
    // first pass shortly after the Hub starts, not during it
    setTimeout(() => void this.checkDue().catch(() => undefined), 60_000).unref();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  // ---- following ----

  follows(userId: number): Followed[] {
    const rows = this.db.prepare('SELECT artist_id, name, picture, followed_at, auto_get_at FROM follows WHERE user_id = ? ORDER BY name COLLATE NOCASE').all(userId) as
      { artist_id: number; name: string; picture: string | null; followed_at: number; auto_get_at: number | null }[];
    return rows.map((r) => ({ id: r.artist_id, name: r.name, picture: r.picture, followedAt: r.followed_at, autoGetAt: r.auto_get_at }));
  }

  /** Follow a Deezer artist. Looks them up right away (in the background), so their releases show up soon. */
  follow(userId: number, a: { id: number; name: string; picture?: string | null }): Followed {
    const n = (this.db.prepare('SELECT COUNT(*) AS n FROM follows WHERE user_id = ?').get(userId) as { n: number }).n;
    const had = this.db.prepare('SELECT 1 FROM follows WHERE user_id = ? AND artist_id = ?').get(userId, a.id);
    if (!had && n >= MAX_FOLLOWS) throw new HttpError(400, `You can follow up to ${MAX_FOLLOWS} artists`);
    const now = this.now();
    this.db.prepare(`INSERT INTO follows (user_id, artist_id, name, picture, followed_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (user_id, artist_id) DO UPDATE SET name = excluded.name, picture = COALESCE(excluded.picture, follows.picture)`)
      .run(userId, a.id, a.name, a.picture ?? null, now);
    this.db.prepare('DELETE FROM radar_hidden WHERE user_id = ? AND artist_id = ?').run(userId, a.id);
    this.suggested.delete(userId);
    if (!this.checkedAt(a.id)) void this.checkArtist(a.id).catch(() => undefined);
    const row = this.db.prepare('SELECT followed_at, auto_get_at FROM follows WHERE user_id = ? AND artist_id = ?').get(userId, a.id) as { followed_at: number; auto_get_at: number | null };
    return { id: a.id, name: a.name, picture: a.picture ?? null, followedAt: row.followed_at, autoGetAt: row.auto_get_at };
  }

  /** Turn "Get new releases automatically" on or off for an artist you follow. Only releases from now on. */
  setAutoGet(userId: number, artistId: number, on: boolean): boolean {
    return this.db.prepare('UPDATE follows SET auto_get_at = ? WHERE user_id = ? AND artist_id = ?').run(on ? this.now() : null, userId, artistId).changes > 0;
  }

  unfollow(userId: number, artistId: number): boolean {
    this.suggested.delete(userId);
    return this.db.prepare('DELETE FROM follows WHERE user_id = ? AND artist_id = ?').run(userId, artistId).changes > 0;
  }

  /** Don't suggest this artist again. */
  hide(userId: number, artistId: number) {
    this.db.prepare('INSERT OR IGNORE INTO radar_hidden (user_id, artist_id) VALUES (?, ?)').run(userId, artistId);
    const s = this.suggested.get(userId);
    if (s) s.list = s.list.filter((x) => x.id !== artistId);
  }

  /**
   * Find a Deezer artist by name (an exact match, ignoring case and accents), for following from the library.
   * Deezer often has several artists with the same name, so it's the one with the most fans.
   */
  async resolve(name: string): Promise<DzArtist | null> {
    const key = normName(name);
    if (!key) return null;
    const hit = this.names.get(key);
    if (hit && this.now() - hit.at < LOOKUP_MS) return hit.artist;
    const r = await deezer(`/search/artist?q=${encodeURIComponent(name)}&limit=25`);
    const found = sameNameArtist<DzArtist>(name, (r?.data ?? []).map(toArtist));
    this.names.set(key, { at: this.now(), artist: found });
    return found;
  }

  // ---- the radar ----

  /** New releases from the artists `userId` follows, newest first. */
  releases(userId: number): RadarRelease[] {
    const cutoff = new Date(this.now() - WINDOW_DAYS * DAY).toISOString().slice(0, 10);
    const until = new Date(this.now() + DAY).toISOString().slice(0, 10);
    const rows = this.db.prepare(`SELECT r.* FROM radar_releases r JOIN follows f ON f.artist_id = r.artist_id AND f.user_id = ?
      WHERE r.released >= ? AND r.released <= ? ORDER BY r.released DESC, r.found_at DESC`).all(userId, cutoff, until) as unknown as ReleaseRow[];
    return rows.map(outRelease);
  }

  /** Announced releases from the artists `userId` follows that aren't out yet, soonest first. */
  upcoming(userId: number): RadarRelease[] {
    const from = new Date(this.now() + DAY).toISOString().slice(0, 10);
    const rows = this.db.prepare(`SELECT r.* FROM radar_releases r JOIN follows f ON f.artist_id = r.artist_id AND f.user_id = ?
      WHERE r.released > ? ORDER BY r.released, r.found_at`).all(userId, from) as unknown as ReleaseRow[];
    return rows.map(outRelease);
  }

  /** When the Hub last looked at any of the artists `userId` follows, and how many it couldn't look up. */
  status(userId: number): { checkedAt: number | null; pending: number; failed: number } {
    const r = this.db.prepare(`SELECT MAX(a.checked_at) AS at, SUM(a.artist_id IS NULL) AS pending, SUM(a.error IS NOT NULL) AS failed
      FROM follows f LEFT JOIN radar_artists a ON a.artist_id = f.artist_id WHERE f.user_id = ?`).get(userId) as { at: number | null; pending: number | null; failed: number | null };
    return { checkedAt: r.at, pending: r.pending ?? 0, failed: r.failed ?? 0 };
  }

  private checkedAt(artistId: number): number | null {
    return (this.db.prepare('SELECT checked_at FROM radar_artists WHERE artist_id = ?').get(artistId) as { checked_at: number } | undefined)?.checked_at ?? null;
  }

  /**
   * Look one artist up on Deezer and keep their recent releases. Releases that are new to the Hub, came out
   * in the last NOTIFY_DAYS, and turned up after someone followed the artist become a notification for them.
   */
  async checkArtist(artistId: number): Promise<number> {
    const now = this.now();
    const before = this.checkedAt(artistId);
    let data: any;
    try {
      data = await deezer(`/artist/${artistId}/albums?limit=50`);
    } catch (e) {
      this.db.prepare(`INSERT INTO radar_artists (artist_id, checked_at, error) VALUES (?, ?, ?)
        ON CONFLICT (artist_id) DO UPDATE SET checked_at = excluded.checked_at, error = excluded.error`).run(artistId, now, String((e as Error).message ?? e).slice(0, 200));
      throw e;
    }
    const keepFrom = new Date(now - KEEP_DAYS * DAY).toISOString().slice(0, 10);
    const until = new Date(now + UPCOMING_DAYS * DAY).toISOString().slice(0, 10);
    const today = new Date(now).toISOString().slice(0, 10);
    const name = (this.db.prepare('SELECT name FROM follows WHERE artist_id = ? LIMIT 1').get(artistId) as { name: string } | undefined)?.name ?? '';
    const fresh: RadarRelease[] = [];
    tx(this.db, () => {
      const has = this.db.prepare('SELECT 1 FROM radar_releases WHERE id = ?');
      const put = this.db.prepare(`INSERT INTO radar_releases (id, artist_id, artist, title, type, released, cover, link, explicit, found_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET title = excluded.title, type = excluded.type, released = excluded.released, cover = excluded.cover, link = excluded.link, explicit = excluded.explicit`);
      for (const a of data?.data ?? []) {
        const released = typeof a?.release_date === 'string' ? a.release_date : '';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(released) || released < keepFrom || released > until || !Number.isSafeInteger(a.id)) continue;
        const r: RadarRelease = {
          id: a.id, artistId, artist: name || String(a.artist?.name ?? ''), title: String(a.title ?? ''), type: String(a.record_type ?? 'album'), released,
          cover: a.cover_medium ?? a.cover ?? null, link: String(a.link ?? `https://www.deezer.com/album/${a.id}`), explicit: !!a.explicit_lyrics, foundAt: now,
        };
        if (!has.get(r.id)) fresh.push(r);
        put.run(r.id, r.artistId, r.artist, r.title, r.type, r.released, r.cover, r.link, r.explicit ? 1 : 0, r.foundAt);
      }
      this.db.prepare(`INSERT INTO radar_artists (artist_id, checked_at, error) VALUES (?, ?, NULL)
        ON CONFLICT (artist_id) DO UPDATE SET checked_at = excluded.checked_at, error = NULL`).run(artistId, now);
    });
    // the first look at an artist only fills the list: it's all old news to whoever just followed them
    if (before !== null) {
      const newsFrom = new Date(now - NOTIFY_DAYS * DAY).toISOString().slice(0, 10);
      for (const r of fresh.filter((x) => x.released >= newsFrom)) {
        const who = (this.db.prepare('SELECT user_id FROM follows WHERE artist_id = ? AND followed_at <= ?').all(artistId, before) as { user_id: number }[]).map((x) => x.user_id);
        const what = { single: 'single', ep: 'EP', compile: 'compilation' }[r.type] ?? 'album';
        if (r.released > today) {
          const day = new Date(r.released + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
          notify(this.db, who, 'radar', `Coming soon from ${r.artist}`, `${r.title} (${what}), out ${day}`, now);
        } else notify(this.db, who, 'radar', `New from ${r.artist}`, `${r.title} (${what})`, now);
      }
    }
    await this.runAutoGet(artistId);
    return fresh.length;
  }

  /**
   * "Get new releases automatically": every release of this artist that is out (today or in the last NOTIFY_DAYS),
   * that the Hub found after the person turned it on, and that wasn't got already, goes to `autoGet` once.
   * An announced release is got on the day it comes out.
   */
  private async runAutoGet(artistId: number) {
    if (!this.autoGet) return;
    const now = this.now();
    const today = new Date(now).toISOString().slice(0, 10);
    const from = new Date(now - NOTIFY_DAYS * DAY).toISOString().slice(0, 10);
    const due = this.db.prepare(`SELECT f.user_id, r.* FROM follows f JOIN radar_releases r ON r.artist_id = f.artist_id
      LEFT JOIN radar_autoget g ON g.user_id = f.user_id AND g.release_id = r.id
      WHERE f.artist_id = ? AND f.auto_get_at IS NOT NULL AND g.release_id IS NULL
        AND r.released <= ? AND r.released >= ? AND r.found_at >= f.auto_get_at`).all(artistId, today, from) as unknown as (ReleaseRow & { user_id: number })[];
    for (const row of due) {
      this.db.prepare('INSERT OR IGNORE INTO radar_autoget (user_id, release_id, at) VALUES (?, ?, ?)').run(row.user_id, row.id, now);
      await Promise.resolve(this.autoGet(row.user_id, outRelease(row))).catch(() => undefined);
    }
  }

  /** Look up every followed artist that is due (or, with `userId`, that person's artists not looked at in the last few minutes). */
  checkDue(userId?: number): Promise<void> {
    if (this.running) return this.running;
    const run = (async () => {
      const now = this.now();
      const due = userId === undefined ? now - CHECK_MS + 60_000 : now - RECHECK_MS;
      const ids = (this.db.prepare(`SELECT DISTINCT f.artist_id AS id FROM follows f LEFT JOIN radar_artists a ON a.artist_id = f.artist_id
        WHERE (? IS NULL OR f.user_id = ?) AND (a.checked_at IS NULL OR a.checked_at < ?) ORDER BY a.checked_at IS NOT NULL, a.checked_at LIMIT ?`)
        .all(userId ?? null, userId ?? null, due, PER_TICK) as { id: number }[]).map((r) => r.id);
      for (const [i, id] of ids.entries()) {
        if (i && this.gapMs) await wait(this.gapMs);
        await this.checkArtist(id).catch(() => undefined);
      }
      this.prune();
    })();
    // cleared after it's stored: a run with nothing to do finishes before this line is reached
    this.running = run.finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  /** Drop releases that are too old to matter, and artists nobody follows any more. */
  prune() {
    const keepFrom = new Date(this.now() - KEEP_DAYS * DAY).toISOString().slice(0, 10);
    this.db.prepare('DELETE FROM radar_releases WHERE released < ? OR artist_id NOT IN (SELECT artist_id FROM follows)').run(keepFrom);
    this.db.prepare('DELETE FROM radar_artists WHERE artist_id NOT IN (SELECT artist_id FROM follows)').run();
    this.db.prepare('DELETE FROM radar_autoget WHERE release_id NOT IN (SELECT id FROM radar_releases)').run();
  }

  // ---- weekly mix ----

  /**
   * Weekly Mix: up to 30 songs to try, made each Friday. Songs from the new releases of artists you follow (two
   * from each), mixed with the top songs of the artists suggested to you (one or two from each). Kept for the
   * week, unless `fresh`.
   */
  async weeklyMix(userId: number, fresh = false): Promise<{ week: string; tracks: MixTrack[] }> {
    const week = mixWeek(this.now());
    const hit = this.mixes.get(userId);
    if (!fresh && hit?.week === week) return { week, tracks: hit.list };
    const toTrack = (t: any, because: string, album?: { title?: string; cover?: string | null }): MixTrack | null =>
      Number.isSafeInteger(t?.id) && t.title ? {
        id: t.id, title: String(t.title), artist: String(t.artist?.name ?? ''), album: String(album?.title ?? t.album?.title ?? ''),
        cover: album?.cover ?? t.album?.cover_medium ?? null, link: String(t.link ?? `https://www.deezer.com/track/${t.id}`),
        preview: typeof t.preview === 'string' && t.preview ? t.preview : null, explicit: !!t.explicit_lyrics, duration: Number(t.duration) || 30, because,
      } : null;

    const fromReleases: MixTrack[] = [];
    for (const r of this.releases(userId).slice(0, 12)) {
      const got = await deezer(`/album/${r.id}/tracks?limit=2`).catch(() => null);
      for (const t of got?.data ?? []) {
        const m = toTrack({ ...t, artist: t.artist ?? { name: r.artist } }, `New from ${r.artist}`, { title: r.title, cover: r.cover });
        if (m) fromReleases.push(m);
      }
      if (this.gapMs) await wait(this.gapMs);
    }
    const fromSuggested: MixTrack[] = [];
    for (const a of (await this.suggestions(userId).catch(() => [])).slice(0, 10)) {
      const got = await deezer(`/artist/${a.id}/top?limit=${a.plays ? 1 : 2}`).catch(() => null);
      const because = a.plays ? `You play ${a.name} a lot` : a.because.length ? `Like ${a.because.slice(0, 2).join(' and ')}` : `New to you`;
      for (const t of got?.data ?? []) {
        const m = toTrack(t, because);
        if (m) fromSuggested.push(m);
      }
      if (this.gapMs) await wait(this.gapMs);
    }
    // alternate the two, so the mix isn't all one kind; no song twice
    const seen = new Set<number>();
    const list: MixTrack[] = [];
    for (let i = 0; list.length < 30 && (i < fromReleases.length || i < fromSuggested.length); i++) {
      for (const t of [fromReleases[i], fromSuggested[i]]) if (t && !seen.has(t.id) && list.length < 30) seen.add(t.id), list.push(t);
    }
    this.mixes.set(userId, { week, list });
    return { week, tracks: list };
  }

  // ---- suggestions ----

  private async relatedTo(artistId: number): Promise<DzArtist[]> {
    const hit = this.related.get(artistId);
    if (hit && this.now() - hit.at < LOOKUP_MS) return hit.list;
    try {
      const r = await deezer(`/artist/${artistId}/related?limit=20`);
      const list = (r?.data ?? []).map(toArtist).filter((a: DzArtist) => Number.isSafeInteger(a.id) && a.name);
      this.related.set(artistId, { at: this.now(), list });
      return list;
    } catch {
      return hit?.list ?? [];
    }
  }

  /** The artists `userId` played most in the last 90 days (from Rewind's plays), most played first. */
  topPlayed(userId: number, limit = 12): { name: string; plays: number }[] {
    const rows = this.db.prepare('SELECT artist, COUNT(*) AS n FROM plays WHERE user_id = ? AND played_at >= ? AND artist != \'\' GROUP BY artist').all(userId, this.now() - 90 * DAY) as { artist: string; n: number }[];
    const by = new Map<string, { name: string; plays: number }>();
    for (const r of rows) {
      const name = primaryArtist(r.artist);
      const k = normName(name);
      if (!k || /^(variousartists|unknownartist)$/.test(k)) continue;
      const cur = by.get(k);
      if (cur) cur.plays += r.n;
      else by.set(k, { name, plays: r.n });
    }
    return [...by.values()].filter((a) => a.plays >= 3).sort((a, b) => b.plays - a.plays).slice(0, limit);
  }

  /**
   * Artists to follow: ones Deezer calls related to the artists you follow (counted twice) and play the most,
   * scored by how many of them point at it and how high; plus artists you play a lot and don't follow yet.
   * Kept for SUGGEST_MS per person unless `fresh`.
   */
  async suggestions(userId: number, fresh = false): Promise<Suggestion[]> {
    const hit = this.suggested.get(userId);
    if (!fresh && hit && this.now() - hit.at < SUGGEST_MS) return hit.list;
    const followed = this.follows(userId);
    const hidden = new Set((this.db.prepare('SELECT artist_id FROM radar_hidden WHERE user_id = ?').all(userId) as { artist_id: number }[]).map((r) => r.artist_id));
    const followedIds = new Set(followed.map((f) => f.id));
    const followedNames = new Set(followed.map((f) => normName(f.name)));

    // seeds: everyone you follow (newest first, so a fresh follow counts) and your most played artists
    const seeds: { id: number; name: string; weight: number }[] = [...followed].sort((a, b) => b.followedAt - a.followedAt).slice(0, 20).map((f) => ({ id: f.id, name: f.name, weight: 2 }));
    const played: Suggestion[] = [];
    for (const p of this.topPlayed(userId)) {
      const a = followedNames.has(normName(p.name)) ? null : await this.resolve(p.name).catch(() => null);
      if (!a) continue;
      if (seeds.length < 30) seeds.push({ id: a.id, name: a.name, weight: 1 });
      if (!followedIds.has(a.id) && !hidden.has(a.id)) played.push({ id: a.id, name: a.name, picture: a.picture, fans: a.fans, because: [], plays: p.plays });
    }

    const score = new Map<number, { a: DzArtist; pts: number; because: Set<string> }>();
    for (const s of seeds) {
      const list = await this.relatedTo(s.id);
      list.forEach((a, rank) => {
        if (followedIds.has(a.id) || hidden.has(a.id)) return;
        const cur = score.get(a.id) ?? { a, pts: 0, because: new Set<string>() };
        cur.pts += s.weight * (1 - rank / (list.length + 5));
        cur.because.add(s.name);
        score.set(a.id, cur);
      });
    }
    const playedIds = new Set(played.map((p) => p.id));
    const related: Suggestion[] = [...score.values()]
      .filter((x) => !playedIds.has(x.a.id))
      .sort((x, y) => y.pts - x.pts || (y.a.fans ?? 0) - (x.a.fans ?? 0))
      .slice(0, 24)
      .map((x) => ({ id: x.a.id, name: x.a.name, picture: x.a.picture, fans: x.a.fans, because: [...x.because].slice(0, 3) }));
    const list = [...played.slice(0, 6), ...related];
    this.suggested.set(userId, { at: this.now(), list });
    return list;
  }
}
