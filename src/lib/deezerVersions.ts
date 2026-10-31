import { norm } from '../sources/registry';
import type { DeezerResult } from '../sources/deemix';
import { CLEAN_MARK } from './kids';
import { cleanTitle, primaryArtist } from './match';

/**
 * Explicit or clean, for Deezer search results and pages (Downloads → Deezer). Deezer often lists an explicit and
 * a clean release under the same name ("I Am Not A Human Being" twice), so the badge and the Clean only filter
 * need to know which is which:
 *
 * 1. "(Clean)", "(Edited)" or "(Censored)" in the name, or Deezer's `explicit_content_lyrics` = 3 ("edited"),
 *    makes the clean version. "(Explicit …)" in the name, `explicit_lyrics`, or `explicit_content_lyrics` 1 / 4
 *    makes the explicit one.
 * 2. Otherwise, a release Deezer marks not explicit is the clean version when the same list has an explicit one
 *    with the same name by the same artist. Alone, "not explicit" just means there was nothing to clean.
 */

export type DzVersion = 'explicit' | 'clean';

const EXPLICIT_MARK = /[([]\s*explicit\b[^)\]]*[)\]]/i;

/** What a result says about itself, before looking at the rest of the list. */
export function ownVersion(r: DeezerResult): DzVersion | undefined {
  if (r.type === 'artist' || r.type === 'playlist') return undefined;
  if (CLEAN_MARK.test(r.title) || (r.type === 'track' && CLEAN_MARK.test(r.album ?? '')) || r.explicitContent === 3) return 'clean';
  if (r.explicit || EXPLICIT_MARK.test(r.title) || r.explicitContent === 1 || r.explicitContent === 4) return 'explicit';
  return undefined;
}

/** Results with this key are versions of each other: same kind, same artist, same name without "(Clean)" and the like. */
export const dzVersionKey = (r: DeezerResult) => `${r.type}|${norm(primaryArtist(r.artist ?? ''))}|${cleanTitle(r.title)}`;

/** The list with `version` filled in on every song and album (rule 2 above needs the whole list). */
export function withVersions(list: DeezerResult[]): DeezerResult[] {
  const own = list.map(ownVersion);
  const hasExplicit = new Set<string>();
  list.forEach((r, i) => own[i] === 'explicit' && hasExplicit.add(dzVersionKey(r)));
  return list.map((r, i) => {
    const version = own[i] ?? (r.explicit === false && hasExplicit.has(dzVersionKey(r)) ? 'clean' : undefined);
    return version === r.version ? r : { ...r, version };
  });
}

/** Clean only: leave out explicit songs and albums. Artists and playlists stay, since they hold both. */
export const cleanOnly = (list: DeezerResult[]) => list.filter((r) => r.version !== 'explicit');
