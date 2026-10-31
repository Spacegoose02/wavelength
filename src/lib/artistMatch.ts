import type { DeezerResult } from '../sources/deemix';
import { norm } from '../sources/registry';
import type { Album } from '../sources/types';
import { ownedIndex } from './artistReleases';
import { primaryArtist } from './match';

/**
 * Which Deezer artist a library artist is. Deezer often has several artists with exactly the same name (a
 * dozen "Drake"s, most of them small uploads with a compilation or two), so the first exact match from a name
 * search can be someone else entirely. See docs/USER-GUIDE.md#browse-an-artists-releases.
 */

/** A Deezer artist that could be the one, with its fan count (how Deezer's own pages tell same-name artists apart). */
export interface ArtistCandidate {
  id: number;
  name: string;
  picture?: string;
  fans: number;
}

/** How sure the match is, and the other Deezer artists with the same name. */
export interface ArtistMatch {
  artist: ArtistCandidate;
  /**
   * True when one of your library albums is in this artist's discography, or (with nothing in your library to
   * check against) when it's the only artist with this name or has far more fans than the next one. The newest
   * release banner only shows when it's sure.
   */
  sure: boolean;
  /** How many of your albums by this artist are in its discography. */
  inLibrary: number;
  /** Other Deezer artists with exactly this name, most fans first. */
  others: ArtistCandidate[];
}

/** With nothing in the library to check, the top artist must have this many times the next one's fans. */
export const DOMINANT_FANS = 10;
/** Discographies checked against the library when several artists share the name. */
export const CHECK_AT_MOST = 3;

/** The artists in a Deezer artist search with exactly this name (case, accents and "The" don't matter), most fans first. */
export function sameNameArtists(name: string, results: any[]): ArtistCandidate[] {
  const key = norm(name);
  if (!key) return [];
  return (results ?? [])
    .filter((a) => a && typeof a.id === 'number' && norm(a.name) === key)
    .map((a, i) => ({ c: { id: a.id as number, name: String(a.name), picture: (a.picture_medium as string) || undefined, fans: Number(a.nb_fan) || 0 }, i }))
    // most fans first; Deezer's own order breaks ties
    .sort((x, y) => y.c.fans - x.c.fans || x.i - y.i)
    .map((x) => x.c);
}

/** Your library albums by this artist (by their main artist, so "Drake & Future" counts for Drake). */
export function libraryAlbumsBy(name: string, albums: Album[]): Album[] {
  const key = norm(name);
  return key ? albums.filter((a) => norm(primaryArtist(a.artist ?? '')) === key) : [];
}

/**
 * Pick the Deezer artist for a library artist from the same-name `candidates` (most fans first). When you have
 * albums by them, the discographies of the top few are checked and the one with the most of your albums wins;
 * if none has any, it's the one with the most fans, but not sure. With no albums to check, the one with the most
 * fans is sure only when it's alone or far ahead. `releasesOf` is the discography call (failures count as empty).
 */
export async function matchArtist(
  candidates: ArtistCandidate[],
  library: Album[],
  releasesOf: (c: ArtistCandidate) => Promise<DeezerResult[]>,
): Promise<ArtistMatch | undefined> {
  if (!candidates.length) return undefined;
  const others = (c: ArtistCandidate) => candidates.filter((x) => x.id !== c.id);
  if (!library.length) {
    const [top, next] = candidates;
    const sure = !next || top.fans >= Math.max(1, next.fans) * DOMINANT_FANS;
    return { artist: top, sure, inLibrary: 0, others: others(top) };
  }
  const owned = ownedIndex(library);
  const checked = await Promise.all(
    candidates.slice(0, CHECK_AT_MOST).map(async (c) => {
      const releases = await releasesOf(c).catch(() => [] as DeezerResult[]);
      const mine = new Set<string>();
      for (const r of releases) {
        const a = owned({ ...r, artist: r.artist ?? c.name });
        if (a) mine.add(a.id);
      }
      return { c, inLibrary: mine.size };
    }),
  );
  // most of your albums wins; fans (the candidates' order) break ties
  const best = checked.reduce((b, x) => (x.inLibrary > b.inLibrary ? x : b), checked[0]);
  return { artist: best.c, sure: best.inLibrary > 0, inLibrary: best.inLibrary, others: others(best.c) };
}
