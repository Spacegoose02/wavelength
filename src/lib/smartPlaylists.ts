import { norm, sourceFor } from '../sources/registry';
import type { NavidromeSource } from '../sources/navidrome';
import type { Track } from '../sources/types';
import { enabledSources } from '../store/settings';

/**
 * Smart playlists: rules ("Rap; Hip-Hop, rated 4+, not played in 90 days") instead of a list of songs. Each time
 * one plays, the songs are looked up again on your Navidrome servers, so it keeps up with what you add, rate
 * and play. The rules sync between devices with a Hub; the songs never need to.
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
  const lists = await Promise.all(servers.map(async (src) => {
    const songs = p.genres.length
      ? (await Promise.all(p.genres.map((genre) => src.songsWithFacts({ genre })))).flat()
      : await src.songsWithFacts({ fromYear: p.fromYear, toYear: p.toYear });
    return songs.filter((s) => matches(p, s.facts, now)).map((s) => s.track);
  }));
  const seen = new Set<string>();
  const all = lists.flat().filter((t) => !seen.has(`${t.sourceId}:${t.id}`) && !!seen.add(`${t.sourceId}:${t.id}`));
  return shuffle(all).slice(0, Math.max(1, p.limit));
}
