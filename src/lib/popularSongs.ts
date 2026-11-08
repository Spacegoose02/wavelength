import { sameNameArtists } from './artistMatch';
import { withoutDontPlay } from './dontPlay';
import { getJson, qs } from './http';
import { cleanTitle, findInLibrary, pool } from './match';
import { norm, sourceFor } from '../sources/registry';
import { enabledSources } from '../store/settings';
import type { Track } from '../sources/types';

/**
 * An artist page's "Popular" songs: the artist's best-known songs, Spotify-style, but only the ones in your own
 * library, so every row plays. Deezer's top tracks for the artist give the order; each is looked up on your music
 * servers (Navidrome, then Plex) the way Song radio does. When Deezer doesn't know the artist, or none of its list
 * is in the library, Navidrome's own top songs (from Last.fm, when the server has it set up) are asked instead.
 * Empty when neither finds anything, and the page leaves the section out.
 */

const DZ = 'https://api.deezer.com';
/** How far down Deezer's list to look. */
const CANDIDATES = 25;
/** How many to show at most ("Show more" opens the second five). */
export const POPULAR_MAX = 10;
const TTL = 30 * 60_000;

export interface PopularCandidate {
  title: string;
  artist: string;
}

/** Deezer's top tracks as songs to look for: one per title, in Deezer's order (it lists a song once per release). */
export function popularCandidates(raw: unknown[]): PopularCandidate[] {
  const seen = new Set<string>();
  const out: PopularCandidate[] = [];
  for (const t of raw as any[]) {
    if (!t?.title || !t.artist?.name) continue;
    const key = cleanTitle(String(t.title));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ title: String(t.title), artist: String(t.artist.name) });
  }
  return out;
}

/** Found tracks, best first, without the same track or the same song (another copy or version) twice. */
export function uniqueSongs(found: (Track | undefined)[], max = POPULAR_MAX): Track[] {
  const ids = new Set<string>();
  const titles = new Set<string>();
  const out: Track[] = [];
  for (const t of found) {
    if (!t) continue;
    const id = `${t.sourceId}:${t.id}`;
    const title = cleanTitle(t.title);
    if (ids.has(id) || titles.has(title)) continue;
    ids.add(id);
    titles.add(title);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

async function fromDeezer(name: string): Promise<Track[]> {
  const search = await getJson(`${DZ}/search/artist?${qs({ q: name, limit: 25 })}`).catch(() => null);
  // only an artist with exactly this name: someone else's hits would be worse than no section
  const id = sameNameArtists(name, search?.data ?? [])[0]?.id;
  if (!id) return [];
  const top = await getJson(`${DZ}/artist/${id}/top?${qs({ limit: CANDIDATES })}`).catch(() => null);
  const wanted = popularCandidates(top?.data ?? []);
  if (!wanted.length) return [];
  const find = findInLibrary();
  let found = 0;
  // in Deezer's order (pool starts jobs in order), stopping once there are enough
  const hits = await pool(wanted, 4, async (c) => {
    if (found >= POPULAR_MAX) return undefined;
    const t = await find(c);
    if (t) found++;
    return t;
  });
  return uniqueSongs(hits);
}

async function fromServers(name: string): Promise<Track[]> {
  for (const cfg of enabledSources()) {
    const src = sourceFor(cfg);
    if (!src.getTopSongs) continue;
    const songs = await src.getTopSongs(name, POPULAR_MAX).catch(() => [] as Track[]);
    if (songs.length) return uniqueSongs(songs);
  }
  return [];
}

const cache = new Map<string, { at: number; songs: Promise<Track[]> }>();

/** The artist's popular songs that are in your library, most popular first; at most POPULAR_MAX. */
export function popularSongs(name: string): Promise<Track[]> {
  const key = norm(name);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.songs.then(withoutDontPlay);
  const songs = (async () => {
    const deezer = await fromDeezer(name).catch(() => [] as Track[]);
    return deezer.length ? deezer : await fromServers(name).catch(() => [] as Track[]);
  })();
  cache.set(key, { at: Date.now(), songs });
  // a failed lookup isn't kept, so the next visit tries again
  songs.then((s) => !s.length && cache.get(key)?.songs === songs && cache.delete(key));
  return songs.then(withoutDontPlay);
}
