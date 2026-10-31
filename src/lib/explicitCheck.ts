import { create } from 'zustand';
import { getJson, qs } from './http';
import { getDeezerAlbum } from '../sources/deemix';
import type { HubAlbumRating } from '../sources/hub';
import { norm } from '../sources/registry';
import { hubClient } from '../store/hub';
import { useCatalog } from '../store/catalog';
import { albumRating, albumVersion, loadFlags } from './kids';
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

/** Deezer's `explicit_content_lyrics`: 1 explicit, 3 edited (the clean version), 4 partly explicit. */
const EDITED = 3;
const EXPLICIT_CONTENT = [1, 4];

/**
 * Whether a Deezer album (`/album/{id}`, with its tracks) really is the clean version of an explicit album
 * whose explicit songs are `explicitSongs`: not explicit, no explicit song on it, and the explicit album's
 * explicit songs are on it (edited). A different release that happens to share the title, or one Deezer just
 * doesn't mark, isn't a clean version.
 */
export function isCleanEdition(candidate: any, explicitSongs: string[]): boolean {
  if (!candidate || candidate.error || candidate.explicit_lyrics === true || EXPLICIT_CONTENT.includes(candidate.explicit_content_lyrics)) return false;
  const tracks: any[] = candidate.tracks?.data ?? [];
  if (!tracks.length || tracks.some((t) => t.explicit_lyrics === true || EXPLICIT_CONTENT.includes(t.explicit_content_lyrics))) return false;
  if (candidate.explicit_content_lyrics === EDITED) return true;
  const titles = new Set(tracks.map((t) => cleanTitle(t.title ?? '')));
  const wanted = [...new Set(explicitSongs.map(cleanTitle))];
  // the songs that needed editing are there, edited
  return wanted.length > 0 && wanted.filter((t) => titles.has(t)).length * 2 >= wanted.length;
}

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
  const page = await deezer(() => getDeezerAlbum(explicit.id));
  const explicitTracks = page.tracks.filter((t) => t.explicit).map((t) => t.title).slice(0, 500);
  // the clean version: marked edited first, then the others Deezer doesn't call explicit; each one is checked
  const candidates = same.filter((a) => a.explicit_lyrics === false)
    .sort((a, b) => Number(b.explicit_content_lyrics === EDITED) - Number(a.explicit_content_lyrics === EDITED)).slice(0, 3);
  let clean: any;
  for (const c of candidates) {
    const full = await deezer(() => getJson(`${DZ}/album/${c.id}`)).catch(() => undefined);
    if (isCleanEdition(full, explicitTracks)) {
      clean = c;
      break;
    }
  }
  return {
    artist,
    album,
    rating: 'explicit',
    cleanLink: clean ? clean.link ?? `https://www.deezer.com/album/${clean.id}` : undefined,
    explicitTracks,
  };
}

/**
 * Check a clean version the library check found before it checked them (0.17.1 and older): whether the Deezer
 * album behind `link` really is the clean version. Undefined when Deezer couldn't be asked.
 */
export async function verifyCleanLink(link: string, explicitSongs: string[]): Promise<boolean | undefined> {
  const id = Number(link.match(/album\/(\d+)/)?.[1]);
  if (!id) return false;
  const full = await deezer(() => getJson(`${DZ}/album/${id}`)).catch(() => undefined);
  if (!full) return undefined;
  return isCleanEdition(full, explicitSongs);
}

/** Check every album in the library that hasn't been checked yet. */
export async function runExplicitCheck() {
  const c = hubClient();
  if (!c || useExplicitCheck.getState().running) return;
  stopRequested = false;
  const seen = new Set<string>();
  const todo = useCatalog.getState().albums.filter((a) => {
    // a clean copy ("Loud (Clean)") isn't checked: Deezer's answer would be about the explicit album
    if (albumVersion(a) === 'clean') return false;
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
