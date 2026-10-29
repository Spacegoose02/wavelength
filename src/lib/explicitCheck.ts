import { create } from 'zustand';
import { getJson, qs } from './http';
import { getDeezerAlbum } from '../sources/deemix';
import type { HubAlbumRating } from '../sources/hub';
import { norm } from '../sources/registry';
import { hubClient } from '../store/hub';
import { useCatalog } from '../store/catalog';
import { albumRating, loadFlags } from './kids';
import { cleanTitle, primaryArtist } from './match';

/**
 * Library check (docs/USERS-AND-ADMIN.md §6.5): look each album in the library up on Deezer and keep on the
 * Hub which albums and songs are explicit, and where an explicit album's clean version is. For files without
 * the explicit tag, and for Plex, which doesn't report it. The files themselves are never changed.
 * Runs on an admin's device; albums already checked are skipped, so it can be stopped and resumed.
 */

interface CheckState {
  running: boolean;
  done: number;
  total: number;
  explicit: number;
  error?: string;
}

export const useExplicitCheck = create<CheckState>()(() => ({ running: false, done: 0, total: 0, explicit: 0 }));

const DZ = 'https://api.deezer.com';
/** Deezer allows about 50 requests per 5 seconds; stay well under it. */
const GAP_MS = 250;
const BATCH = 25;

let stopRequested = false;
let last = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function deezer<T>(fn: () => Promise<T>): Promise<T> {
  const wait = last + GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();
  return fn();
}

const sameArtist = (a: string, b: string) => {
  const x = norm(primaryArtist(a));
  const y = norm(primaryArtist(b));
  return x === y || (x.length > 2 && y.length > 2 && (x.includes(y) || y.includes(x)));
};

/** Look one album up on Deezer. */
export async function checkAlbum(artist: string, album: string): Promise<HubAlbumRating> {
  const res = await deezer(() => getJson(`${DZ}/search/album?${qs({ q: `${primaryArtist(artist)} ${album.replace(/\(.*?\)|\[.*?\]/g, '')}`, limit: 25 })}`));
  if (res?.error) throw new Error(res.error.message ?? 'Deezer refused the search');
  const title = cleanTitle(album);
  const same = ((res?.data ?? []) as any[]).filter((a) => cleanTitle(a.title ?? '') === title && sameArtist(a.artist?.name ?? '', artist));
  if (!same.length) return { artist, album, rating: 'unknown' };
  // Deezer often lists both versions: the explicit one is what most libraries have
  const explicit = same.find((a) => a.explicit_lyrics === true);
  if (!explicit) return { artist, album, rating: same.some((a) => a.explicit_lyrics === false) ? 'clean' : 'unknown' };
  const clean = same.find((a) => a.explicit_lyrics === false);
  const page = await deezer(() => getDeezerAlbum(explicit.id));
  return {
    artist,
    album,
    rating: 'explicit',
    cleanLink: clean ? clean.link ?? `https://www.deezer.com/album/${clean.id}` : undefined,
    explicitTracks: page.tracks.filter((t) => t.explicit).map((t) => t.title).slice(0, 500),
  };
}

/** Check every album in the library that hasn't been checked yet. */
export async function runExplicitCheck() {
  const c = hubClient();
  if (!c || useExplicitCheck.getState().running) return;
  stopRequested = false;
  const seen = new Set<string>();
  const todo = useCatalog.getState().albums.filter((a) => {
    const k = `${norm(primaryArtist(a.artist))}|${cleanTitle(a.title)}`;
    if (!a.artist || !a.title || seen.has(k)) return false;
    seen.add(k);
    // already tagged by the server, or already checked
    return !a.explicit && !albumRating(a.artist, a.title);
  });
  useExplicitCheck.setState({ running: true, done: 0, total: todo.length, explicit: 0, error: undefined });
  let batch: HubAlbumRating[] = [];
  const flush = async () => {
    if (!batch.length) return;
    const send = batch;
    batch = [];
    await c.saveRatings(send);
  };
  try {
    for (const a of todo) {
      if (stopRequested) break;
      const r = await checkAlbum(a.artist, a.title);
      batch.push(r);
      useExplicitCheck.setState((s) => ({ done: s.done + 1, explicit: s.explicit + (r.rating === 'explicit' ? 1 : 0) }));
      if (batch.length >= BATCH) {
        await flush();
        await loadFlags();
      }
    }
    await flush();
  } catch (e) {
    useExplicitCheck.setState({ error: String((e as Error).message ?? e) });
    await flush().catch(() => undefined);
  } finally {
    useExplicitCheck.setState({ running: false });
    await loadFlags();
  }
}

export function stopExplicitCheck() {
  stopRequested = true;
}

/** Forget every result and check the whole library again. */
export async function recheckLibrary() {
  const c = hubClient();
  if (!c || useExplicitCheck.getState().running) return;
  await c.clearRatings();
  await loadFlags();
  await runExplicitCheck();
}
