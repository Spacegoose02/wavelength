import { norm } from '../sources/registry';
import type { MusicSource, Track } from '../sources/types';

export const cleanTitle = (s: string) =>
  norm(s.replace(/^\d{1,3}\s*[-.]\s+/, '').replace(/\s*[([](feat|ft|with|remaster|remastered|live|explicit|clean|edited|censored|radio edit|\d{4} remaster)[^)\]]*[)\]]/gi, ''));

/** "Drake Featuring Future & Lil Baby" → "Drake" — charts list features in the artist field. */
export const primaryArtist = (s: string) => s.split(/\s+(?:featuring|feat\.?|ft\.?|with|x|&|and|•)\s+|,\s*/i)[0].trim();

/** Find the same song in a library (title + artist match), returning the playable track. */
export async function findTrackOnSource(src: MusicSource, t: { title: string; artist: string }): Promise<Track | undefined> {
  if (!src.search) return undefined;
  const artist = norm(primaryArtist(t.artist));
  const title = cleanTitle(t.title);
  const pick = (cands: Track[]) => {
    const same = cands.filter((c) => cleanTitle(c.title) === title || cleanTitle(c.title).startsWith(title));
    return (
      same.find((c) => norm(primaryArtist(c.artist)) === artist) ??
      same.find((c) => norm(c.artist).includes(artist) || artist.includes(norm(primaryArtist(c.artist))))
    );
  };
  const first = await src.search(`${primaryArtist(t.artist)} ${t.title.replace(/\(.*?\)/g, '')}`).catch(() => ({ tracks: [] as Track[] }));
  let hit = pick(first.tracks ?? []);
  if (!hit) hit = pick((await src.search(t.title.replace(/\(.*?\)/g, '')).catch(() => ({ tracks: [] as Track[] }))).tracks ?? []);
  return hit;
}

/**
 * Find the same song on another server (e.g. a Plex track inside a Navidrome playlist).
 * Tracks already from that source pass straight through.
 */
export async function findOnSource(src: MusicSource, t: Track): Promise<string | undefined> {
  if (t.sourceId === src.config.id) return t.id;
  if (t.kind !== 'track') return undefined;
  return (await findTrackOnSource(src, t))?.id;
}

/** Run async jobs with limited concurrency. */
export async function pool<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

/** Map a list of tracks onto one server; returns found ids plus what couldn't be matched. */
export async function matchAll(src: MusicSource, tracks: Track[], onProgress?: (done: number) => void) {
  let done = 0;
  const found = await pool(tracks, 4, async (t) => {
    const id = await findOnSource(src, t);
    onProgress?.(++done);
    return id;
  });
  const ids: string[] = [];
  const missing: Track[] = [];
  found.forEach((id, i) => (id ? ids.push(id) : missing.push(tracks[i])));
  return { ids, missing };
}
