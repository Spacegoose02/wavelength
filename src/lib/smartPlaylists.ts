import { norm, sourceFor } from '../sources/registry';
import type { NavidromeSource } from '../sources/navidrome';
import type { Album, Track } from '../sources/types';
import { useCatalog } from '../store/catalog';
import { enabledSources } from '../store/settings';
import { albumGenres, albumTags, type BrowseQuery, genreKey } from './browse';
import { describeRules, evalGroup, needsSongTags, newRule, type Rule, type RuleGroup, type SortId, sortKey } from './smartRules';
import { featuresFor } from './sonic';
import { useItemTagStore } from './itemTags';

/**
 * Smart playlists: rules ("Rap; Hip-Hop, rated 4+, not played in 90 days") instead of a list of songs. Each time
 * one plays, the songs are looked up again on your Navidrome servers, so it keeps up with what you add, rate
 * and play. The rules sync between devices with a Hub; the songs never need to.
 *
 * Rules on the Hub's styles, moods and collections (lib/itemTags.ts) are about albums, so such a playlist picks
 * its songs from the albums that fit (the library's album list, lib/browse.ts) instead of by genre or at random:
 * that's how "Save as smart playlist" on Browse turns any slice ("80s", "Christmas", "Southern Rap") into one.
 */

export interface SmartPlaylist {
  id: string;
  name: string;
  /** Any of these genres; none = every genre. */
  genres: string[];
  /** Your star rating on Navidrome, 0 = any. */
  minRating: number;
  /** Only songs you ♥. */
  starred: boolean;
  /** Not played in this many days (never played counts), 0 = any. */
  notPlayedDays: number;
  /** Added to the library in the last this many days, 0 = any. */
  addedDays: number;
  fromYear?: number;
  toYear?: number;
  /** At most this many songs, picked at random from the ones that match. */
  limit: number;
  /** Sound-alike analysis on the Hub (lib/sonic.ts): any of these moods; tempo range in BPM. Songs it hasn't analysed are left out while one is set. */
  moods?: string[];
  minBpm?: number;
  maxBpm?: number;
  /** The Hub's tags (lib/itemTags.ts): any of these styles, any of these moods, in any of these collections. */
  styles?: string[];
  tagMoods?: string[];
  collections?: string[];
  /** Albums in these collections are left out ("everything but Christmas"). */
  notCollections?: string[];
  /**
   * Advanced rules (lib/smartRules.ts, Plex's filter builder): when set, they are the playlist's rules and the
   * simple ones above are ignored. `sort` says which songs the limit keeps (random when missing).
   */
  rules?: RuleGroup;
  sort?: SortId;
}

/** Whether the playlist has rules on the Hub's album tags, so its songs come from the albums that fit. */
export const byAlbum = (p: SmartPlaylist) => !!(p.styles?.length || p.tagMoods?.length || p.collections?.length || p.notCollections?.length);

const anyOf = (have: string[], want?: string[]) => !want?.length || want.some((w) => have.some((h) => genreKey(h) === genreKey(w)));

/** Whether an album fits the playlist's genre, year, style, mood and collection rules. */
export function albumFits(p: SmartPlaylist, a: Album): boolean {
  if (p.genres.length && !anyOf(albumGenres(a), p.genres.flatMap((g) => g.split(/\s*;\s*/)))) return false;
  if ((p.fromYear || p.toYear) && !a.year) return false;
  if (p.fromYear && a.year! < p.fromYear) return false;
  if (p.toYear && a.year! > p.toYear) return false;
  if (!anyOf(albumTags(a, 'style'), p.styles)) return false;
  if (!anyOf(albumTags(a, 'mood'), p.tagMoods)) return false;
  if (!anyOf(albumTags(a, 'collection'), p.collections)) return false;
  if (p.notCollections?.length && anyOf(albumTags(a, 'collection'), p.notCollections)) return false;
  return true;
}

/** A smart playlist with the rules of a Browse slice or the Albums filters: "80s", "Christmas · Pop". */
export function fromBrowse(q: BrowseQuery, name: string): SmartPlaylist {
  const decade = q.decade !== undefined ? { fromYear: q.decade, toYear: q.decade + 9 } : { fromYear: q.from, toYear: q.to };
  const p = simpleFromBrowse(q, name, decade);
  if (!q.mood && !q.style) return p;
  // a mood or style is the album's or the song's own (as Browse shows it): advanced rules say "either"
  const either = (r: RuleGroup['rules'][number]): RuleGroup['rules'][number] => {
    if ('match' in r) return { ...r, rules: r.rules.map(either) };
    if (r.field === 'mood' || r.field === 'style') return { match: 'any', rules: [r, { ...r, field: r.field === 'mood' ? 'trackMood' : 'trackStyle' }] };
    return r;
  };
  return { ...p, rules: { ...advancedRules(p), rules: advancedRules(p).rules.map(either) } };
}

function simpleFromBrowse(q: BrowseQuery, name: string, decade: { fromYear?: number; toYear?: number }): SmartPlaylist {
  return {
    ...newSmartPlaylist(),
    name,
    genres: q.genre ? [q.genre] : [],
    ...decade,
    ...(q.style && { styles: [q.style] }),
    ...(q.mood && { tagMoods: [q.mood] }),
    ...(q.collection && { collections: [q.collection] }),
  };
}

export const MOODS = ['energetic', 'upbeat', 'chill', 'mellow', 'dark'] as const;

/** Whether a song's sound fits the playlist's mood and tempo rules (no rules: yes). */
export function soundMatches(p: SmartPlaylist, f: { mood: string; bpm: number } | null): boolean {
  const any = !!(p.moods?.length || p.minBpm || p.maxBpm);
  if (!any) return true;
  if (!f) return false;
  if (p.moods?.length && !p.moods.includes(f.mood)) return false;
  // a song at half or double the tempo feels the same: count either
  const fits = (b: number) => (!p.minBpm || b >= p.minBpm) && (!p.maxBpm || b <= p.maxBpm);
  return fits(f.bpm) || fits(f.bpm / 2) || fits(f.bpm * 2);
}

/** What smart playlists filter on, from Navidrome's song listing. */
export interface SongFacts {
  rating: number;
  starred: boolean;
  plays: number;
  playedAt?: number;
  addedAt?: number;
  year?: number;
  genre?: string;
  /** The file's type ("flac", "mp3") and bit rate (kbps); the album's record label (album songs only). */
  format?: string;
  bitRate?: number;
  label?: string;
  /** Where the file is, as the server shows it ("Artist/Album/01 Song.flac"). */
  path?: string;
}

export const newSmartPlaylist = (): SmartPlaylist => ({
  id: `smart-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
  name: 'New smart playlist',
  genres: [],
  minRating: 0,
  starred: false,
  notPlayedDays: 0,
  addedDays: 0,
  limit: 100,
});

const DAY = 86_400_000;

/** Whether a song fits the rules (genres are checked when the songs are fetched, and again here). */
export function matches(p: SmartPlaylist, f: SongFacts, now = Date.now()): boolean {
  if (p.genres.length && f.genre !== undefined) {
    const mine = f.genre.split(/\s*[;,/]\s*/).map(norm);
    const want = p.genres.flatMap((g) => g.split(/\s*[;,/]\s*/)).map(norm);
    if (!want.some((g) => mine.includes(g))) return false;
  }
  if (p.minRating && f.rating < p.minRating) return false;
  if (p.starred && !f.starred) return false;
  if (p.notPlayedDays && f.playedAt && now - f.playedAt < p.notPlayedDays * DAY) return false;
  if (p.addedDays && (!f.addedAt || now - f.addedAt > p.addedDays * DAY)) return false;
  if (p.fromYear && (!f.year || f.year < p.fromYear)) return false;
  if (p.toYear && (!f.year || f.year > p.toYear)) return false;
  return true;
}

/** One line saying what the rules are, for the card. */
export function describe(p: SmartPlaylist): string {
  if (p.rules) {
    const sort = p.sort && p.sort !== 'random' ? `, ${SORT_WORDS[p.sort]}` : '';
    return `${describeRules(p.rules)} · up to ${p.limit}${sort}`;
  }
  const bits = [
    p.genres.length ? p.genres.join(' or ') : 'Any genre',
    p.minRating ? `rated ${p.minRating}+` : '',
    p.starred ? '♥ only' : '',
    p.notPlayedDays ? `not played in ${p.notPlayedDays} days` : '',
    p.addedDays ? `added in the last ${p.addedDays} days` : '',
    p.fromYear || p.toYear ? `${p.fromYear ?? '…'}–${p.toYear ?? '…'}` : '',
    p.moods?.length ? p.moods.join(' or ') : '',
    p.minBpm || p.maxBpm ? `${p.minBpm ?? '…'}–${p.maxBpm ?? '…'} BPM` : '',
    p.styles?.length ? p.styles.join(' or ') : '',
    p.tagMoods?.length ? p.tagMoods.join(' or ') : '',
    p.collections?.length ? `in ${p.collections.join(' or ')}` : '',
    p.notCollections?.length ? `not ${p.notCollections.join(' or ')}` : '',
  ].filter(Boolean);
  return `${bits.join(', ')} · up to ${p.limit}`;
}

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** The songs for a smart playlist right now, from every Navidrome server in use. */
export async function smartTracks(p: SmartPlaylist): Promise<Track[]> {
  const servers = enabledSources().filter((s) => s.kind === 'navidrome').map((s) => sourceFor(s) as NavidromeSource);
  if (!servers.length) throw new Error('Smart playlists need your library server (Navidrome or the Hub, Settings → Sources)');
  const now = Date.now();
  if (p.rules) return ruleTracks(p, p.rules, servers, now);
  if (byAlbum(p)) return pickSounds(p, await albumTracks(p, servers, now));
  const lists = await Promise.all(servers.map(async (src) => {
    const songs = p.genres.length
      ? (await Promise.all(p.genres.map((genre) => src.songsWithFacts({ genre })))).flat()
      : await src.songsWithFacts({ fromYear: p.fromYear, toYear: p.toYear });
    return songs.filter((s) => matches(p, s.facts, now)).map((s) => s.track);
  }));
  const seen = new Set<string>();
  return pickSounds(p, lists.flat().filter((t) => !seen.has(`${t.sourceId}:${t.id}`) && !!seen.add(`${t.sourceId}:${t.id}`)));
}

/**
 * Songs from the albums that fit the rules: a random handful of them (enough for the limit with room for the other
 * rules), read with their ratings and plays and checked against the rest of the rules.
 */
async function albumTracks(p: SmartPlaylist, servers: NavidromeSource[], now: number): Promise<Track[]> {
  const ids = new Set(servers.map((s) => s.config.id));
  const fits = useCatalog.getState().albums.filter((a) => albumFits(p, a))
    .map((a) => (a.refs ?? [a]).find((r) => ids.has(r.sourceId)))
    .filter((r): r is Album => !!r);
  const picked = shuffle(fits).slice(0, Math.min(150, Math.max(25, Math.ceil(p.limit / 4))));
  const out: Track[] = [];
  // genres and years were checked on the album; the song's own genre tag can be narrower
  const rest = { ...p, genres: [], fromYear: undefined, toYear: undefined };
  for (let i = 0; i < picked.length; i += 8) {
    const lists = await Promise.all(picked.slice(i, i + 8).map((a) => {
      const src = servers.find((s) => s.config.id === a.sourceId)!;
      return src.albumSongsWithFacts(a.id).catch(() => []);
    }));
    for (const s of lists.flat()) if (matches(rest, s.facts, now)) out.push(s.track);
  }
  return out;
}

const SORT_WORDS: Record<SortId, string> = { random: 'at random', plays: 'most played first', leastPlays: 'least played first', played: 'last played first', added: 'newest added first', rating: 'highest rated first', newest: 'newest first', oldest: 'oldest first' };

/** How many albums an advanced playlist reads at most, so a huge library doesn't mean thousands of requests. */
export const MAX_ALBUMS = 400;

/**
 * Songs for advanced rules: the albums that could match (the artist and album rows checked on the library's album
 * list), then their songs, each checked against every row. With random order it stops once there are plenty;
 * sorted ("most played"), it reads every candidate album up to MAX_ALBUMS so the top ones are the real top.
 */
async function ruleTracks(p: SmartPlaylist, rules: RuleGroup, servers: NavidromeSource[], now: number): Promise<Track[]> {
  if (needsSongTags(rules)) await useItemTagStore.getState().loadSongs();
  const ids = new Set(servers.map((s) => s.config.id));
  const candidates: { album: Album; ref: Album }[] = [];
  for (const album of useCatalog.getState().albums) {
    if (evalGroup(rules, { album, now }) === false) continue;
    const ref = (album.refs ?? [album]).find((r) => ids.has(r.sourceId));
    if (ref) candidates.push({ album, ref });
  }
  const sort = p.sort ?? 'random';
  // a random pick stops once there are a few times the limit, from as many albums as that took
  const enough = Math.max(p.limit * 3, 200);
  const matched: { track: Track; album: Album; facts: SongFacts }[] = [];
  const queue = shuffle(candidates).slice(0, MAX_ALBUMS);
  for (let i = 0; i < queue.length && (sort !== 'random' || matched.length < enough); i += 8) {
    const lists = await Promise.all(queue.slice(i, i + 8).map(async ({ album, ref }) => {
      const src = servers.find((s) => s.config.id === ref.sourceId)!;
      const read = await src.albumSongsWithFacts(ref.id).catch(() => []);
      return read.map((s) => ({ ...s, album }));
    }));
    for (const s of lists.flat()) if (evalGroup(rules, { album: s.album, track: s.track, facts: s.facts, now }) === true) matched.push(s);
  }
  let pool = shuffle(matched);
  if (p.moods?.length || p.minBpm || p.maxBpm) {
    pool = pool.slice(0, 3000);
    const feats = await featuresFor(pool.map((s) => s.track));
    pool = pool.filter((_, i) => soundMatches(p, feats[i]));
  }
  if (sort !== 'random') pool.sort((a, b) => sortKey(sort, a) - sortKey(sort, b));
  return pool.slice(0, Math.max(1, p.limit)).map((s) => s.track);
}

/** The sound-alike rules (mood, tempo), then a random pick up to the limit. */
async function pickSounds(p: SmartPlaylist, tracks: Track[]): Promise<Track[]> {
  let all = tracks;
  if (p.moods?.length || p.minBpm || p.maxBpm) {
    // pick from a shuffled sample so a big library doesn't mean a huge lookup
    all = shuffle(all).slice(0, 3000);
    const feats = await featuresFor(all);
    all = all.filter((_, i) => soundMatches(p, feats[i]));
  }
  return shuffle(all).slice(0, Math.max(1, p.limit));
}

/** The simple rules as advanced ones, for switching an existing playlist to the builder. */
export function advancedRules(p: SmartPlaylist): RuleGroup {
  const rules: RuleGroup['rules'] = [];
  const anyOfRows = (field: Rule['field'], names: string[] | undefined, op: Rule['op'] = 'is') => {
    if (!names?.length) return;
    if (names.length === 1) rules.push({ field, op, value: names[0] });
    else rules.push({ match: op === 'isNot' ? 'all' : 'any', rules: names.map((value) => ({ field, op, value })) });
  };
  anyOfRows('genre', p.genres.flatMap((g) => g.split(/\s*;\s*/)).filter(Boolean));
  if (p.fromYear) rules.push({ field: 'year', op: 'gt', value: String(p.fromYear - 1) });
  if (p.toYear) rules.push({ field: 'year', op: 'lt', value: String(p.toYear + 1) });
  anyOfRows('style', p.styles);
  anyOfRows('mood', p.tagMoods);
  anyOfRows('collection', p.collections);
  anyOfRows('collection', p.notCollections, 'isNot');
  if (p.minRating) rules.push({ field: 'rating', op: 'gt', value: String(p.minRating - 1) });
  if (p.starred) rules.push({ field: 'starred', op: 'is', value: 'true' });
  if (p.notPlayedDays) rules.push({ field: 'played', op: 'notInLast', value: String(p.notPlayedDays) });
  if (p.addedDays) rules.push({ field: 'added', op: 'inLast', value: String(p.addedDays) });
  return { match: 'all', rules: rules.length ? rules : [newRule()] };
}
