import { createHash, randomBytes } from 'node:crypto';
import type { Db } from './db.ts';
import { tx } from './db.ts';
import type { Plays, Starred } from './subsonicCatalog.ts';

/**
 * Each person's hearts, play counts and ratings kept by the Hub (phase 5 of the Hub's own music server, docs/HUB.md
 * "Hearts and play counts"). Navidrome used to be the only keeper. When an admin turns this on, the Hub copies a
 * person's hearts (getStarred2), plays and ratings (Navidrome's own API) the first time they use the Hub's relay, and
 * from then on answers and records them itself. Every change is also sent on to Navidrome, so Navidrome stays complete
 * for devices that still talk to it directly and for going back.
 */

export interface NavidromeLogin {
  url: string;
  username: string;
  password: string;
}

const importedKey = (userId: number) => `userdata.imported.${userId}`;

export function userDataImported(db: Db, userId: number): boolean {
  return !!db.prepare('SELECT 1 FROM hub_settings WHERE key = ?').get(importedKey(userId));
}

/**
 * Each person's hearts and plays as last read, so browsing doesn't read them all again on every call (about 10 ms
 * for someone with thousands of plays). Dropped whenever they change here; the maps handed out are only read.
 */
const kept = new WeakMap<Db, Map<number, { stars?: Starred; plays?: Plays }>>();
const keptFor = (db: Db, userId: number) => {
  let m = kept.get(db);
  if (!m) kept.set(db, (m = new Map()));
  let k = m.get(userId);
  if (!k) m.set(userId, (k = {}));
  return k;
};
const changed = (db: Db, userId: number) => kept.get(db)?.delete(userId);

export function starredOf(db: Db, userId: number): Starred {
  const k = keptFor(db, userId);
  if (k.stars) return k.stars;
  const rows = db.prepare('SELECT item_id, starred_at FROM user_stars WHERE user_id = ? ORDER BY starred_at DESC').all(userId) as { item_id: string; starred_at: number }[];
  return (k.stars = new Map(rows.map((r) => [r.item_id, new Date(r.starred_at).toISOString()])));
}

export function playsOf(db: Db, userId: number): Plays {
  const k = keptFor(db, userId);
  if (k.plays) return k.plays;
  const rows = db.prepare('SELECT song_id, play_count, last_played, rating FROM user_song_plays WHERE user_id = ?').all(userId) as { song_id: string; play_count: number; last_played: number | null; rating: number }[];
  return (k.plays = new Map(rows.map((r) => [r.song_id, { count: r.play_count, last: r.last_played, rating: r.rating }])));
}

export function star(db: Db, userId: number, ids: string[], on: boolean, at = Date.now()) {
  const add = db.prepare('INSERT OR IGNORE INTO user_stars (user_id, item_id, starred_at) VALUES (?, ?, ?)');
  const del = db.prepare('DELETE FROM user_stars WHERE user_id = ? AND item_id = ?');
  tx(db, () => ids.forEach((id) => (on ? add.run(userId, id, at) : del.run(userId, id))));
  changed(db, userId);
}

/** A finished play (Subsonic `scrobble` with submission): one more play, played at `at`. */
export function played(db: Db, userId: number, songId: string, at = Date.now()) {
  db.prepare(`INSERT INTO user_song_plays (user_id, song_id, play_count, last_played) VALUES (?, ?, 1, ?)
    ON CONFLICT (user_id, song_id) DO UPDATE SET play_count = play_count + 1, last_played = MAX(COALESCE(last_played, 0), excluded.last_played)`).run(userId, songId, at);
  changed(db, userId);
}

/** 0 clears it; 1 to 5 stars. */
export function rate(db: Db, userId: number, songId: string, rating: number) {
  db.prepare(`INSERT INTO user_song_plays (user_id, song_id, rating) VALUES (?, ?, ?)
    ON CONFLICT (user_id, song_id) DO UPDATE SET rating = excluded.rating`).run(userId, songId, Math.max(0, Math.min(5, Math.round(rating))));
  changed(db, userId);
}

const md5 = (s: string) => createHash('md5').update(s).digest('hex');

async function subsonic(nd: NavidromeLogin, method: string, params: Record<string, string> = {}): Promise<any> {
  const salt = randomBytes(6).toString('hex');
  const q = new URLSearchParams({ ...params, u: nd.username, t: md5(nd.password + salt), s: salt, v: '1.16.1', c: 'wavelength-hub', f: 'json' });
  const res = await fetch(`${nd.url.replace(/\/+$/, '')}/rest/${method}?${q}`, { signal: AbortSignal.timeout(30_000) });
  const r = ((await res.json().catch(() => null)) as any)?.['subsonic-response'];
  if (!res.ok || r?.status !== 'ok') throw new Error(`Navidrome: ${r?.error?.message ?? res.status}`);
  return r;
}

/** Navidrome's own API as this person: every song they played or rated, with counts, last play and rating. */
async function playsFromNavidrome(nd: NavidromeLogin): Promise<{ id: string; count: number; last: number | null; rating: number }[]> {
  const base = nd.url.replace(/\/+$/, '');
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: nd.username, password: nd.password }), signal: AbortSignal.timeout(30_000) });
  const token = ((await login.json().catch(() => null)) as { token?: string } | null)?.token;
  if (!login.ok || !token) throw new Error('Navidrome refused this person’s login');
  const out: { id: string; count: number; last: number | null; rating: number }[] = [];
  const PAGE = 2000;
  for (const sort of ['play_count', 'rating']) {
    for (let start = 0; start < 1_000_000; start += PAGE) {
      const r = await fetch(`${base}/api/song?${new URLSearchParams({ _start: String(start), _end: String(start + PAGE), _sort: sort, _order: 'DESC' })}`, { headers: { 'x-nd-authorization': `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) });
      if (!r.ok) throw new Error(`Navidrome couldn't list the songs (${r.status})`);
      const list = (await r.json().catch(() => [])) as { id?: string; playCount?: number; playDate?: string; rating?: number }[];
      const useful = list.filter((x) => x?.id && ((sort === 'play_count' && (x.playCount ?? 0) > 0) || (sort === 'rating' && (x.rating ?? 0) > 0)));
      for (const x of useful) out.push({ id: String(x.id), count: Number(x.playCount ?? 0) || 0, last: x.playDate ? Date.parse(x.playDate) || null : null, rating: Number(x.rating ?? 0) || 0 });
      // sorted most first: a page that runs out of played (or rated) songs is the last one worth reading
      if (list.length < PAGE || useful.length < list.length) break;
    }
  }
  return out;
}

/**
 * Copy one person's hearts, plays and ratings from Navidrome (their own login), once. Throws when Navidrome can't be
 * asked; nothing is marked copied then, so it is tried again next time.
 */
export async function importUserData(db: Db, userId: number, nd: NavidromeLogin): Promise<{ stars: number; plays: number }> {
  const s = (await subsonic(nd, 'getStarred2')).starred2 ?? {};
  const starred = [...(s.song ?? []), ...(s.album ?? []), ...(s.artist ?? [])].filter((x: { id?: string }) => x?.id) as { id: string; starred?: string }[];
  const plays = await playsFromNavidrome(nd);
  const addStar = db.prepare('INSERT OR IGNORE INTO user_stars (user_id, item_id, starred_at) VALUES (?, ?, ?)');
  const addPlay = db.prepare(`INSERT INTO user_song_plays (user_id, song_id, play_count, last_played, rating) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (user_id, song_id) DO UPDATE SET play_count = MAX(play_count, excluded.play_count),
      last_played = MAX(COALESCE(last_played, 0), COALESCE(excluded.last_played, 0)), rating = CASE WHEN excluded.rating > 0 THEN excluded.rating ELSE rating END`);
  tx(db, () => {
    for (const x of starred) addStar.run(userId, x.id, Date.parse(x.starred ?? '') || Date.now());
    for (const p of plays) addPlay.run(userId, p.id, p.count, p.last, p.rating);
    db.prepare('INSERT INTO hub_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(importedKey(userId), JSON.stringify({ at: Date.now(), stars: starred.length, plays: plays.length }));
  });
  changed(db, userId);
  return { stars: starred.length, plays: new Set(plays.map((p) => p.id)).size };
}

/** How many people's data the Hub keeps, for Settings → Server → Music catalog. */
export function userDataSummary(db: Db): { people: number; stars: number; plays: number } {
  const people = (db.prepare("SELECT COUNT(*) AS n FROM hub_settings WHERE key LIKE 'userdata.imported.%'").get() as { n: number }).n;
  const stars = (db.prepare('SELECT COUNT(*) AS n FROM user_stars').get() as { n: number }).n;
  const plays = (db.prepare('SELECT COALESCE(SUM(play_count), 0) AS n FROM user_song_plays').get() as { n: number }).n;
  return { people, stars, plays };
}
