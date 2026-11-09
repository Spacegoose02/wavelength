import { norm, sourceFor } from '../sources/registry';
import type { NavidromeSource } from '../sources/navidrome';
import type { Album, Track } from '../sources/types';
import { useCatalog } from '../store/catalog';
import { enabledSources } from '../store/settings';
import { albumGenres, albumTags, type BrowseQuery, genreKey } from './browse';
import { featuresFor } from './sonic';

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
  if (!servers.length) throw new Error('Smart playlists need a Navidrome server (Settings → Sources)');
  const now = Date.now();
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
