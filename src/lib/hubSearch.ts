import type { NavidromeSource } from '../sources/navidrome';
import { sourceFor } from '../sources/registry';
import type { SearchResults, SourceConfig, Track } from '../sources/types';
import { hubClient } from '../store/hub';
import { sameNavidrome } from './discoverMatch';

/**
 * Search through the Hub (hub/src/routes/search.ts) for the Navidrome the Hub knows: typo-tolerant, finds words by
 * their start, and puts what you play first. `undefined` without a Hub, with an older Hub, when the Hub hasn't
 * listed the library yet, or when its Navidrome isn't one of this device's servers: Search then asks that server
 * itself, as before.
 */
export async function hubSearch(
  q: string,
  sources: SourceConfig[],
): Promise<{ sourceId: string; results: Partial<SearchResults>; didYouMean?: string; lyrics?: { track: Track; line: string }[] } | undefined> {
  const hub = hubClient();
  if (!hub || !sources.some((s) => s.kind === 'navidrome')) return undefined;
  try {
    const r = await hub.librarySearch(q);
    const src = r.ready && r.server ? sameNavidrome(r.server, sources) : undefined;
    if (!src) return undefined;
    const nd = sourceFor(src) as NavidromeSource;
    return {
      sourceId: src.id,
      results: nd.fromSubsonicSearch(r),
      ...(r.didYouMean && { didYouMean: r.didYouMean }),
      ...(r.lyrics?.length && { lyrics: r.lyrics.map((l) => ({ track: nd.fromSubsonic({ ...l.song }), line: l.line })) }),
    };
  } catch {
    return undefined;
  }
}

const RECENT_KEY = 'tonearm.recentSearches';

/** The last few searches on this device, newest first. */
export function recentSearches(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}

/** Remember a search that found something. Drops older searches it extends ("kend" when "kendrick" comes). */
export function rememberSearch(q: string): string[] {
  const t = q.trim();
  if (t.length < 2) return recentSearches();
  const low = t.toLowerCase();
  const list = [t, ...recentSearches().filter((x) => { const l = x.toLowerCase(); return l !== low && !low.startsWith(l); })].slice(0, 8);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // private mode: nothing to remember
  }
  return list;
}

export function forgetSearches() {
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch {
    // ignore
  }
}
