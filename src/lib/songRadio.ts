import { getJson, qs } from './http';
import { findInLibrary, pool, primaryArtist } from './match';
import { norm } from '../sources/registry';
import type { Track } from '../sources/types';

/**
 * Song radio: a queue of songs from your own library that sound like one song or artist. Deezer says who's
 * related to the artist and what their best-known songs are; each of those found in your library (Navidrome,
 * then Plex) goes in. Nothing is downloaded, so it only ever plays what you already have.
 */

const DZ = 'https://api.deezer.com';
const PER_ARTIST = 5;
const RELATED = 12;
const MAX = 40;

interface Candidate { title: string; artist: string }

async function deezerArtistId(name: string): Promise<number | undefined> {
  const r = await getJson(`${DZ}/search/artist?${qs({ q: name, limit: 5 })}`).catch(() => null);
  const list = (r?.data ?? []) as { id: number; name: string }[];
  return (list.find((a) => norm(a.name) === norm(name)) ?? list[0])?.id;
}

async function topSongs(artistId: number, limit: number): Promise<Candidate[]> {
  const r = await getJson(`${DZ}/artist/${artistId}/top?${qs({ limit })}`).catch(() => null);
  return ((r?.data ?? []) as any[]).filter((t) => t?.title && t.artist?.name).map((t) => ({ title: String(t.title), artist: String(t.artist.name) }));
}

/** Spread artists out so the same one doesn't play twice in a row when it can be helped. */
export function interleave<T>(groups: T[][]): T[] {
  const out: T[] = [];
  for (let i = 0; groups.some((g) => i < g.length); i++) for (const g of groups) if (i < g.length) out.push(g[i]);
  return out;
}

/**
 * Songs like `seed` from your library, the seed itself first when it's a track. Empty when Deezer doesn't
 * know the artist or nothing related is in your library.
 */
export async function songRadio(seed: { artist: string; title?: string; track?: Track }, onProgress?: (found: number) => void): Promise<Track[]> {
  const artist = primaryArtist(seed.artist);
  const id = await deezerArtistId(artist);
  if (!id) return seed.track ? [seed.track] : [];
  const related = await getJson(`${DZ}/artist/${id}/related?${qs({ limit: RELATED })}`).catch(() => null);
  const ids = [id, ...((related?.data ?? []) as { id: number }[]).map((a) => a.id)];
  const groups = await pool(ids, 4, (a, i) => topSongs(a, i === 0 ? PER_ARTIST + 3 : PER_ARTIST));
  // shuffle within each artist, so two radios from the same seed aren't the same
  for (const g of groups) g.sort(() => Math.random() - 0.5);

  const seen = new Set<string>();
  const key = (t: { title: string; artist: string }) => `${norm(primaryArtist(t.artist))}|${norm(t.title)}`;
  if (seed.title) seen.add(key({ title: seed.title, artist: seed.artist }));
  const wanted = interleave(groups).filter((c) => !seen.has(key(c)) && seen.add(key(c)));

  const find = findInLibrary();
  let found = 0;
  const hits = await pool(wanted, 4, async (c) => {
    if (found >= MAX) return undefined;
    const t = await find(c);
    if (t) onProgress?.(++found);
    return t;
  });
  const ids2 = new Set<string>();
  const list = hits.filter((t): t is Track => !!t && !ids2.has(t.id) && !!ids2.add(t.id)).slice(0, MAX);
  return seed.track ? [seed.track, ...list.filter((t) => t.id !== seed.track!.id)] : list;
}
