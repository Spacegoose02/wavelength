import type { Track } from '../sources/types';

/**
 * The songs of every part of one album (Navidrome can list one album as two). A part that won't load is left out,
 * with its error in `failed`, so the rest of the album still shows; only when no part loads does this fail.
 */
export async function loadParts(ids: string[], load: (id: string) => Promise<Track[]>): Promise<{ tracks: Track[]; failed?: string }> {
  const results = await Promise.allSettled(ids.map(load));
  const lists = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  const bad = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (!lists.length) throw bad?.reason ?? new Error('No songs found for this album');
  const failed = bad ? String(bad.reason?.message ?? bad.reason) : undefined;
  return { tracks: ids.length > 1 ? byPosition(lists.flat()) : lists[0], failed };
}

/** Songs from several parts of one album, in disc and track order, each once. */
export function byPosition(tracks: Track[]): Track[] {
  const seen = new Set<string>();
  return tracks
    .filter((t) => !seen.has(t.id) && !!seen.add(t.id))
    .sort((a, b) => (a.discNumber ?? 1) - (b.discNumber ?? 1) || (a.trackNumber ?? 999) - (b.trackNumber ?? 999));
}
