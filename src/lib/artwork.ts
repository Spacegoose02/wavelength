import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { HubArtwork, HubArtworkInput } from '../sources/hub';
import { norm } from '../sources/registry';
import type { Album, Artist, Track } from '../sources/types';
import { useCatalog } from '../store/catalog';
import { hubClient, useHub } from '../store/hub';
import { cleanTitle, primaryArtist } from './match';

/**
 * Cover art kept on the Hub (docs/HUB.md "Cover art"). An admin picks a picture for an album or an artist
 * and every device shows it instead of the one from Navidrome or Plex. Matched by name, like the kid-safe
 * flags, because ids differ between servers. Kept on the device so it still shows offline.
 */

export const useArtwork = create<{ items: HubArtwork[] }>()(persist(() => ({ items: [] as HubArtwork[] }), { name: 'tonearm.artwork' }));

export async function loadArtwork() {
  const c = hubClient();
  if (!c) return useArtwork.setState({ items: [] });
  try {
    useArtwork.setState({ items: (await c.artwork()).artwork });
  } catch {
    /* offline, or a Hub from before cover art: keep the last list */
  }
}

let started = false;
/** Keep the list fresh: now, when the profile changes, and every ten minutes. */
export function startArtworkChecks() {
  if (started) return;
  started = true;
  loadArtwork();
  setInterval(loadArtwork, 600_000);
  useHub.subscribe((s, prev) => (s.token !== prev.token || s.url !== prev.url) && loadArtwork());
}

const key = (kind: string, artist = '', album = '') => `${kind}|${norm(primaryArtist(artist))}|${kind === 'artist' ? '' : cleanTitle(album)}`;

let indexedFrom: HubArtwork[] | undefined;
let byKey = new Map<string, string>();
/** Album title alone, when only one album has that title: songs on a compilation carry the song's artist. */
let byTitle = new Map<string, string | null>();
function index() {
  const { items } = useArtwork.getState();
  if (items !== indexedFrom) {
    indexedFrom = items;
    const base = useHub.getState().url.replace(/\/+$/, '');
    byKey = new Map();
    byTitle = new Map();
    for (const a of items) {
      const src = `${base}${a.url}`;
      byKey.set(key(a.kind, a.artist, a.album), src);
      if (a.kind === 'album') {
        const t = cleanTitle(a.album);
        byTitle.set(t, byTitle.has(t) ? null : src);
      }
    }
  }
  return { byKey, byTitle };
}

/** The Hub's picture for this album, if an admin picked one. */
export const hubAlbumArt = (artist = '', album = '') => (album ? index().byKey.get(key('album', artist, album)) : undefined);
export const hubArtistArt = (name = '') => index().byKey.get(key('artist', name));

export const albumArt = (a: Pick<Album, 'artist' | 'title' | 'coverUrl'>, fallback = a.coverUrl) => hubAlbumArt(a.artist, a.title) ?? fallback;
export const artistArt = (a: Pick<Artist, 'name' | 'coverUrl'>) => hubArtistArt(a.name) ?? a.coverUrl;
let libraryFrom: Album[] | undefined;
let libraryByKey = new Map<string, string>();
let libraryByTitle = new Map<string, string | null>();
/** The library's own album covers by artist and title, for songs that came without one. */
function libraryIndex() {
  const { albums } = useCatalog.getState();
  if (albums !== libraryFrom) {
    libraryFrom = albums;
    libraryByKey = new Map();
    libraryByTitle = new Map();
    for (const a of albums) {
      if (!a.coverUrl) continue;
      const k = key('album', a.artist, a.title);
      if (!libraryByKey.has(k)) libraryByKey.set(k, a.coverUrl);
      const t = cleanTitle(a.title);
      libraryByTitle.set(t, libraryByTitle.has(t) && libraryByTitle.get(t) !== a.coverUrl ? null : a.coverUrl);
    }
  }
  return { byKey: libraryByKey, byTitle: libraryByTitle };
}

/**
 * The library album's cover for a song that has none of its own: songs found through the Hub (sound-alike radio,
 * sonic journeys) or saved in a queue before they carried one. Only used when the song has no picture.
 */
export function libraryAlbumArt(artist = '', album = ''): string | undefined {
  if (!album) return undefined;
  const lib = libraryIndex();
  return lib.byKey.get(key('album', artist, album)) ?? lib.byTitle.get(cleanTitle(album)) ?? undefined;
}

/** A song shows its album's picture. Radio, audiobooks and podcasts keep their own. */
export function trackArt(t?: Pick<Track, 'kind' | 'artist' | 'album' | 'coverUrl'>): string | undefined {
  if (!t) return undefined;
  if (t.kind !== 'track' || !t.album) return t.coverUrl;
  return hubAlbumArt(t.artist, t.album) ?? index().byTitle.get(cleanTitle(t.album)) ?? t.coverUrl ?? libraryAlbumArt(t.artist, t.album);
}

/** Hook: re-render when the Hub's pictures, or the library's albums, change. */
export const useArtworkList = () => {
  useCatalog((s) => s.albums);
  return useArtwork((s) => s.items);
};

/** Admin: the picture set on exactly this album or artist, if any. */
export function artworkOn(kind: HubArtwork['kind'], artist: string, album = ''): HubArtwork | undefined {
  const k = key(kind, artist, album);
  return useArtwork.getState().items.find((a) => key(a.kind, a.artist, a.album) === k);
}

function client() {
  const c = hubClient();
  if (!c) throw new Error('Sign in to your Hub first');
  return c;
}

/** Admin: save a picture on the Hub for everyone. */
export async function setArtwork(b: HubArtworkInput) {
  await client().setArtwork(b);
  await loadArtwork();
}

/** Admin: back to the server's own picture. */
export async function resetArtwork(kind: HubArtwork['kind'], artist: string, album = '') {
  const a = artworkOn(kind, artist, album);
  if (a) await client().deleteArtwork(a.id);
  await loadArtwork();
}

/** A file the admin chose, as base64 for the Hub. */
export function readImageFile(file: File): Promise<string> {
  return new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => fail(new Error("Couldn't read that file"));
    r.readAsDataURL(file);
  });
}
