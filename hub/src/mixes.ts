import type { Db } from './db.ts';
import { deezer, normName, primaryArtist, sameNameArtist } from './radar.ts';

/**
 * Made for you (docs/HUB.md "Made for you mixes"): playlists the Hub makes for each person once a day from their
 * plays (the `plays` table, the same one Rewind uses) and Deezer's "related artists":
 *
 * - **On Repeat**: what you've played most in the last 30 days.
 * - **Daily Mix 1–4**: your favourite artists of the last four months, grouped by who sounds alike (Deezer's
 *   related artists), with your most played songs by them and their best-known songs from related artists.
 * - **Discover Weekly**: best-known songs of artists related to your favourites that you haven't played.
 * - **Forgotten favourites**: songs you played a lot that you haven't played for three months.
 * - **Time Capsule**: your most played songs from one to three years ago.
 *
 * Songs are kept like household playlists (title, artist, album, length, cover, plus the played track when there
 * is one), and each person's app finds them in their own library, dropping what it can't find. So suggestions
 * can name songs the library doesn't have: the app just skips them. Kids get no explicit Deezer suggestions,
 * and the app's kid filter applies to everything on top.
 *
 * **Blend** mixes two or more people who have all said yes (`blend_optin`): songs by artists they share first,
 * then each person's favourites in turn.
 */

export interface MixSong {
  title: string;
  artist: string;
  album?: string;
  duration?: number;
  coverUrl?: string;
  /** the track as a device played it (sourceId, id …), so the same server can play it straight away */
  track?: Record<string, unknown>;
  /** why it's here, when that isn't obvious ("Like Drake") */
  because?: string;
}

export interface Mix {
  id: string;
  name: string;
  description: string;
  kind: 'onRepeat' | 'daily' | 'discover' | 'forgotten' | 'capsule' | 'blend';
  songs: MixSong[];
}

const DAY = 86_400_000;
const MIX_SIZE = 50;

export interface PlayRow { played_at: number; title: string; artist: string; album: string; seconds: number; track: string }

/** What mixes ask Deezer, so tests can answer instead. */
export interface MixLookups {
  related(artist: string): Promise<string[]>;
  top(artist: string, kid: boolean): Promise<MixSong[]>;
}

const songKey = (s: { title: string; artist: string }) => `${normName(primaryArtist(s.artist))}\u0000${normName(s.title.replace(/\s*[([].*?[)\]]\s*/g, ' '))}`;
const artistKey = (a: string) => normName(primaryArtist(a));

function toSong(r: PlayRow): MixSong {
  let track: Record<string, unknown> | undefined;
  try {
    track = JSON.parse(r.track);
  } catch {
    track = undefined;
  }
  return {
    title: r.title,
    artist: r.artist,
    ...(r.album && { album: r.album }),
    ...(r.seconds > 0 && { duration: r.seconds }),
    ...(typeof track?.coverUrl === 'string' && { coverUrl: track.coverUrl }),
    ...(track && { track }),
  };
}

interface Tally { song: MixSong; plays: number; last: number; first: number }

/** Songs in `rows` between `from` and `to`, most played first. */
function tallySongs(rows: PlayRow[], from: number, to: number): Tally[] {
  const m = new Map<string, Tally>();
  for (const r of rows) {
    if (r.played_at < from || r.played_at >= to) continue;
    const k = songKey(r);
    const t = m.get(k);
    if (t) {
      t.plays++;
      t.last = Math.max(t.last, r.played_at);
      t.first = Math.min(t.first, r.played_at);
    } else m.set(k, { song: toSong(r), plays: 1, last: r.played_at, first: r.played_at });
  }
  return [...m.values()].sort((a, b) => b.plays - a.plays || b.last - a.last);
}

function lastPlayed(rows: PlayRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(songKey(r), Math.max(m.get(songKey(r)) ?? 0, r.played_at));
  return m;
}

/** A stable shuffle for the day, so a mix doesn't reorder every time it's opened. */
function dayShuffle<T>(list: T[], seed: string): T[] {
  const hash = (s: string) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  };
  return list.map((x, i) => ({ x, k: hash(`${seed}:${i}`) })).sort((a, b) => a.k - b.k).map((p) => p.x);
}

function dedupe(songs: MixSong[], max = MIX_SIZE): MixSong[] {
  const seen = new Set<string>();
  const out: MixSong[] = [];
  for (const s of songs) {
    const k = songKey(s);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

const names = (artists: string[]) => (artists.length <= 2 ? artists.join(' and ') : `${artists.slice(0, 3).join(', ')} and more`);

export function onRepeat(rows: PlayRow[], now: number): Mix | null {
  const songs = tallySongs(rows, now - 30 * DAY, now + 1).filter((t) => t.plays >= 2).map((t) => t.song);
  if (songs.length < 5) return null;
  return { id: 'on-repeat', name: 'On Repeat', description: 'The songs you’ve played most in the last 30 days.', kind: 'onRepeat', songs: dedupe(songs) };
}

export function forgotten(rows: PlayRow[], now: number): Mix | null {
  const last = lastPlayed(rows);
  const songs = tallySongs(rows, 0, now + 1)
    .filter((t) => t.plays >= 4 && (last.get(songKey(t.song)) ?? 0) < now - 90 * DAY)
    .map((t) => t.song);
  if (songs.length < 5) return null;
  return { id: 'forgotten', name: 'Forgotten favourites', description: 'Songs you loved and haven’t played for a while.', kind: 'forgotten', songs: dedupe(songs) };
}

export function timeCapsule(rows: PlayRow[], now: number): Mix | null {
  const last = lastPlayed(rows);
  const songs = tallySongs(rows, now - 3 * 365 * DAY, now - 365 * DAY)
    .filter((t) => t.plays >= 2 && (last.get(songKey(t.song)) ?? 0) < now - 180 * DAY)
    .map((t) => t.song);
  if (songs.length < 5) return null;
  return { id: 'time-capsule', name: 'Time Capsule', description: 'Your most played songs from a year or more ago.', kind: 'capsule', songs: dedupe(songs) };
}

/** Top artists in the window, most played first, with how they're written in the plays. */
function topArtists(rows: PlayRow[], from: number, n: number): string[] {
  const m = new Map<string, { name: string; plays: number }>();
  for (const r of rows) {
    if (r.played_at < from) continue;
    const name = primaryArtist(r.artist);
    const k = artistKey(r.artist);
    if (!k) continue;
    const a = m.get(k);
    if (a) a.plays++;
    else m.set(k, { name, plays: 1 });
  }
  return [...m.values()].sort((a, b) => b.plays - a.plays).slice(0, n).map((a) => a.name);
}

/** Group artists who are related to each other (either way), in order, at most `max` groups. */
export function clusterArtists(artists: string[], related: Map<string, string[]>, max: number): string[][] {
  const rel = (a: string, b: string) =>
    (related.get(artistKey(a)) ?? []).some((x) => artistKey(x) === artistKey(b)) || (related.get(artistKey(b)) ?? []).some((x) => artistKey(x) === artistKey(a));
  const groups: string[][] = [];
  const used = new Set<string>();
  for (const a of artists) {
    if (used.has(artistKey(a))) continue;
    const g = [a];
    used.add(artistKey(a));
    for (const b of artists) {
      if (used.has(artistKey(b))) continue;
      if (g.some((x) => rel(x, b))) {
        g.push(b);
        used.add(artistKey(b));
      }
    }
    groups.push(g);
    if (groups.length >= max) break;
  }
  return groups;
}

export async function dailyMixes(rows: PlayRow[], now: number, look: MixLookups, kid: boolean): Promise<Mix[]> {
  const artists = topArtists(rows, now - 120 * DAY, 12);
  if (artists.length < 2) return [];
  const related = new Map<string, string[]>();
  await Promise.all(artists.map(async (a) => related.set(artistKey(a), await look.related(a).catch(() => []))));
  const groups = clusterArtists(artists, related, 4);
  const played = tallySongs(rows, now - 365 * DAY, now + 1);
  const mixes: Mix[] = [];
  for (const g of groups) {
    const keys = new Set(g.map(artistKey));
    const mine = played.filter((t) => keys.has(artistKey(t.song.artist))).map((t) => t.song);
    // a few artists like these that this person doesn't play much
    const like = [...new Set(g.flatMap((a) => (related.get(artistKey(a)) ?? []).slice(0, 4)))].filter((a) => !keys.has(artistKey(a))).slice(0, 6);
    const extra = (await Promise.all(like.map((a) => look.top(a, kid).then((s) => s.slice(0, 4)).catch(() => [] as MixSong[])))).flat();
    // mostly theirs, one new one in every four
    const out: MixSong[] = [];
    const a = dayShuffle(mine.slice(0, 60), `${now / DAY | 0}:${g[0]}`);
    const b = dayShuffle(extra, `${now / DAY | 0}:${g[0]}:x`).map((s) => ({ ...s, because: `Like ${g[0]}` }));
    while (a.length || b.length) {
      out.push(...a.splice(0, 3));
      if (b.length) out.push(b.shift()!);
    }
    const songs = dedupe(out);
    if (songs.length < 8) continue;
    mixes.push({ id: `daily-${mixes.length + 1}`, name: `Daily Mix ${mixes.length + 1}`, description: names(g), kind: 'daily', songs });
  }
  return mixes;
}

export async function discoverWeekly(rows: PlayRow[], now: number, look: MixLookups, kid: boolean): Promise<Mix | null> {
  const artists = topArtists(rows, now - 120 * DAY, 8);
  if (!artists.length) return null;
  const playedArtists = new Set(rows.map((r) => artistKey(r.artist)));
  const cands: { artist: string; because: string }[] = [];
  const seen = new Set<string>();
  for (const a of artists) {
    for (const r of (await look.related(a).catch(() => [])).slice(0, 8)) {
      const k = artistKey(r);
      if (playedArtists.has(k) || seen.has(k)) continue;
      seen.add(k);
      cands.push({ artist: r, because: `Like ${a}` });
    }
  }
  const picked = dayShuffle(cands, `dw:${Math.floor(now / (7 * DAY))}`).slice(0, 24);
  const songs = (await Promise.all(picked.map((c) => look.top(c.artist, kid).then((s) => s.slice(0, 3).map((x) => ({ ...x, because: c.because }))).catch(() => [] as MixSong[])))).flat();
  // more than a mix needs: the app keeps the ones it finds in the library
  const list = dedupe(dayShuffle(songs, `dw2:${Math.floor(now / (7 * DAY))}`), 80);
  if (list.length < 5) return null;
  return { id: 'discover-weekly', name: 'Discover Weekly', description: `New to you, from artists like ${names(artists.slice(0, 3))}. Changes every Monday.`, kind: 'discover', songs: list };
}

/** Deezer, cached for a day: related artists and top songs barely change. */
export function deezerLookups(): MixLookups {
  const cache = new Map<string, { at: number; v: unknown }>();
  const cached = async <T>(k: string, fn: () => Promise<T>): Promise<T> => {
    const hit = cache.get(k);
    if (hit && Date.now() - hit.at < DAY) return hit.v as T;
    const v = await fn();
    cache.set(k, { at: Date.now(), v });
    if (cache.size > 2000) cache.delete(cache.keys().next().value!);
    return v;
  };
  const artistId = (name: string) =>
    cached(`id:${artistKey(name)}`, async () => {
      const r = await deezer(`/search/artist?q=${encodeURIComponent(name)}&limit=10`);
      const list = ((r?.data ?? []) as any[]).map((a) => ({ id: Number(a.id), name: String(a.name ?? ''), fans: typeof a.nb_fan === 'number' ? a.nb_fan : null }));
      return sameNameArtist(name, list)?.id ?? null;
    });
  return {
    related: (name) =>
      cached(`rel:${artistKey(name)}`, async () => {
        const id = await artistId(name);
        if (!id) return [];
        const r = await deezer(`/artist/${id}/related?limit=12`);
        return ((r?.data ?? []) as any[]).map((a) => String(a.name ?? '')).filter(Boolean);
      }),
    top: async (name, kid) => {
      const list = await cached(`top:${artistKey(name)}`, async () => {
        const id = await artistId(name);
        if (!id) return [];
        const r = await deezer(`/artist/${id}/top?limit=10`);
        return ((r?.data ?? []) as any[]).map((t) => ({
          song: { title: String(t.title ?? ''), artist: String(t.artist?.name ?? name), album: t.album?.title ? String(t.album.title) : undefined, duration: Number(t.duration) || undefined, coverUrl: t.album?.cover_medium ?? undefined } as MixSong,
          explicit: !!t.explicit_lyrics,
        }));
      });
      return list.filter((x) => !kid || !x.explicit).map((x) => x.song).filter((s) => s.title);
    },
  };
}

const today = (now: number) => new Date(now).toISOString().slice(0, 10);

function playsOf(db: Db, userId: number): PlayRow[] {
  return db.prepare('SELECT played_at, title, artist, album, seconds, track FROM plays WHERE user_id = ? ORDER BY played_at').all(userId) as unknown as PlayRow[];
}

export async function buildMixes(db: Db, userId: number, kid: boolean, look: MixLookups, now = Date.now()): Promise<Mix[]> {
  const rows = playsOf(db, userId);
  const out: Mix[] = [];
  const push = (m: Mix | null) => m && out.push(m);
  push(onRepeat(rows, now));
  out.push(...(await dailyMixes(rows, now, look, kid)));
  push(await discoverWeekly(rows, now, look, kid));
  push(forgotten(rows, now));
  push(timeCapsule(rows, now));
  return out;
}

/** Today's mixes for this person, made now if they haven't been yet today (or `fresh`). */
export class Mixes {
  private building = new Map<number, Promise<Mix[]>>();
  private db: Db;
  private look: MixLookups;
  private now: () => number;
  constructor(db: Db, look: MixLookups = deezerLookups(), now = () => Date.now()) {
    this.db = db;
    this.look = look;
    this.now = now;
  }

  async get(userId: number, kid: boolean, fresh = false): Promise<{ mixes: Mix[]; builtAt: number }> {
    const row = this.db.prepare('SELECT day, mixes, built_at FROM mixes WHERE user_id = ?').get(userId) as { day: string; mixes: string; built_at: number } | undefined;
    if (row && row.day === today(this.now()) && !fresh) return { mixes: JSON.parse(row.mixes), builtAt: row.built_at };
    let p = this.building.get(userId);
    if (!p) {
      p = buildMixes(this.db, userId, kid, this.look, this.now()).finally(() => this.building.delete(userId));
      this.building.set(userId, p);
    }
    const mixes = await p;
    const at = this.now();
    this.db.prepare('INSERT INTO mixes (user_id, day, mixes, built_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET day = excluded.day, mixes = excluded.mixes, built_at = excluded.built_at')
      .run(userId, today(at), JSON.stringify(mixes), at);
    return { mixes, builtAt: at };
  }

  /** A Blend of these people's listening (all of them opted in; checked by the route). */
  blend(people: { id: number; displayName: string }[], now = this.now()): Mix {
    const per = people.map((p) => ({ p, top: tallySongs(playsOf(this.db, p.id), now - 180 * DAY, now + 1) }));
    // artists more than one of them plays
    const fans = new Map<string, Set<number>>();
    for (const { p, top } of per) for (const t of top) {
      const k = artistKey(t.song.artist);
      if (!fans.has(k)) fans.set(k, new Set());
      fans.get(k)!.add(p.id);
    }
    const shared: MixSong[] = [];
    const rest = per.map(() => [] as MixSong[]);
    per.forEach(({ p, top }, i) => {
      for (const t of top.slice(0, 80)) {
        const both = (fans.get(artistKey(t.song.artist))?.size ?? 0) > 1;
        if (both) shared.push({ ...t.song, because: 'You both play this artist' });
        else rest[i].push({ ...t.song, because: `From ${p.displayName}` });
      }
    });
    const out: MixSong[] = dayShuffle(shared, `blend:${today(now)}`).slice(0, 20);
    for (let i = 0; out.length < 120 && rest.some((r) => r.length); i = (i + 1) % rest.length) {
      const s = rest[i].shift();
      if (s) out.push(s);
    }
    const label = people.map((p) => p.displayName).join(' + ');
    return { id: `blend-${people.map((p) => p.id).sort((a, b) => a - b).join('-')}`, name: `Blend: ${label}`, description: 'Songs you share first, then each person’s favourites in turn.', kind: 'blend', songs: dedupe(dayShuffle(out.slice(0, 20), 'b').concat(out.slice(20))) };
  }
}

export const blendOptedIn = (db: Db, userId: number) => !!db.prepare('SELECT 1 FROM blend_optin WHERE user_id = ?').get(userId);
export function setBlendOptIn(db: Db, userId: number, on: boolean) {
  if (on) db.prepare('INSERT OR IGNORE INTO blend_optin (user_id, at) VALUES (?, ?)').run(userId, Date.now());
  else db.prepare('DELETE FROM blend_optin WHERE user_id = ?').run(userId);
}
