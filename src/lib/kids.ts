import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DeezerResult } from '../sources/deemix';
import type { HubFlag, HubRating } from '../sources/hub';
import { norm } from '../sources/registry';
import type { Album, Artist, Track } from '../sources/types';
import { hubClient, useHub } from '../store/hub';
import type { Route } from '../store/ui';
import { cleanTitle, primaryArtist } from './match';

/**
 * Kid-safe music (docs/USERS-AND-ADMIN.md §6.5). On a kid profile the app hides anything explicit (from
 * the server's tags or Deezer) and anything an admin marked as not for kids, unless an admin marked it as
 * fine. Flags are kept on the Hub and matched by name here, because every device reaches the music through
 * its own logins and ids differ between servers.
 */

interface FlagsState {
  flags: HubFlag[];
}

export const useFlags = create<FlagsState>()(persist(() => ({ flags: [] as HubFlag[] }), { name: 'tonearm.kidFlags' }));

/** Explicit / clean ratings the library check found on Deezer (src/lib/explicitCheck.ts). */
export const useRatings = create<{ ratings: HubRating[] }>()(persist(() => ({ ratings: [] as HubRating[] }), { name: 'tonearm.ratings' }));

/** Fetch the Hub's flags and ratings (kept on the device, so a kid profile stays filtered offline). */
export async function loadFlags() {
  const c = hubClient();
  if (!c) return;
  try {
    // ratings: an older Hub doesn't have them yet
    const [f, r] = await Promise.all([c.flags(), c.ratings().catch(() => undefined)]);
    useFlags.setState({ flags: f.flags });
    if (r) useRatings.setState({ ratings: r.ratings });
  } catch {
    /* offline: keep the last lists */
  }
}

let started = false;
/** Keep the flags fresh: now, when the profile changes, and every ten minutes. */
export function startFlagChecks() {
  if (started) return;
  started = true;
  loadFlags();
  setInterval(loadFlags, 600_000);
  useHub.subscribe((s, prev) => s.token !== prev.token && loadFlags());
}

const artistKey = (a = '') => norm(primaryArtist(a));
const key = (kind: string, artist = '', title = '') => `${kind}|${artistKey(artist)}|${kind === 'artist' ? '' : cleanTitle(title)}`;

let indexed: HubFlag[] | undefined;
let index = new Map<string, HubFlag['verdict']>();
function verdicts() {
  const { flags } = useFlags.getState();
  if (flags !== indexed) {
    indexed = flags;
    index = new Map(flags.map((f) => [key(f.kind, f.artist, f.title), f.verdict]));
  }
  return index;
}

let ratedFrom: HubRating[] | undefined;
let rated = new Map<string, HubRating>();
function ratingIndex() {
  const { ratings } = useRatings.getState();
  if (ratings !== ratedFrom) {
    ratedFrom = ratings;
    rated = new Map(ratings.map((r) => [r.kind === 'album' ? key('album', r.artist, r.album) : `${key('album', r.artist, r.album)}|${cleanTitle(r.title)}`, r]));
  }
  return rated;
}

/** The library check's rating for an album, if it was checked. */
export const albumRating = (artist = '', album = '') => ratingIndex().get(key('album', artist, album));

/**
 * Explicit or clean: the file's own tag first, then the library check. A song on a checked explicit album
 * that isn't in its explicit list is clean.
 */
export function explicitOfTrack(t: Pick<Track, 'artist' | 'album' | 'title' | 'explicit'>): 'explicit' | 'clean' | undefined {
  if (t.explicit) return t.explicit;
  const idx = ratingIndex();
  if (idx.get(`${key('album', t.artist, t.album)}|${cleanTitle(t.title)}`)) return 'explicit';
  const a = idx.get(key('album', t.artist, t.album));
  return a?.rating === 'explicit' || a?.rating === 'clean' ? 'clean' : undefined;
}
export function explicitOfAlbum(a: Pick<Album, 'artist' | 'title' | 'explicit'>): 'explicit' | 'clean' | undefined {
  if (a.explicit) return a.explicit;
  const r = albumRating(a.artist, a.title)?.rating;
  return r === 'explicit' || r === 'clean' ? r : undefined;
}

/** Most specific flag wins: song, then album, then artist. */
function verdictFor(artist?: string, album?: string, title?: string): HubFlag['verdict'] | undefined {
  const v = verdicts();
  return (title ? v.get(key('track', artist, title)) : undefined)
    ?? (album ? v.get(key('album', artist, album)) : undefined)
    ?? v.get(key('artist', artist));
}

/** Kid profiles get a shorter, bigger menu, with these labels. */
export const KID_VIEWS: Partial<Record<Route['view'], string>> = {
  home: 'Home', search: 'Search', discover: 'Discover', albums: 'Albums', artists: 'Artists', favorites: 'Favorites',
  radio: 'Radio', books: 'Audiobooks', downloads: 'Ask for music', inbox: 'Inbox', settings: 'Me', playlists: 'Playlists',
};

export const isKid = () => useHub.getState().user?.role === 'kid';
export const useIsKid = () => useHub((s) => s.user?.role === 'kid');

/** Whether this would be hidden from a kid. `explicit` is the item's own rating. */
export function notForKids(i: { artist?: string; album?: string; title?: string; explicit?: boolean }): boolean {
  const v = verdictFor(i.artist, i.album, i.title);
  if (v) return v === 'block';
  return !!i.explicit;
}

export const trackNotForKids = (t: Track) => t.kind === 'track' && notForKids({ artist: t.artist, album: t.album, title: t.title, explicit: explicitOfTrack(t) === 'explicit' });
export const albumNotForKids = (a: Album) => notForKids({ artist: a.artist, album: a.title, explicit: explicitOfAlbum(a) === 'explicit' });
export const artistNotForKids = (a: Artist) => notForKids({ artist: a.name });
export const deezerNotForKids = (r: DeezerResult) =>
  notForKids({ artist: r.type === 'artist' ? r.title : r.artist, album: r.type === 'album' ? r.title : r.album, title: r.type === 'track' ? r.title : undefined, explicit: r.explicit });

/**
 * Hook: a function that says whether to hide something on this profile. Always false for grown-ups, so
 * views can call it everywhere. Re-renders when the flags or the profile change.
 */
export function useHidden(): Hidden {
  const kid = useIsKid();
  const flags = useFlags((s) => s.flags);
  const ratings = useRatings((s) => s.ratings);
  return kid ? kidFilters(flags, ratings) : GROWN_UP;
}
interface Hidden {
  track(t: Track): boolean;
  album(a: Album): boolean;
  artist(a: Artist): boolean;
  deezer(r: DeezerResult): boolean;
}
const no = () => false;
const GROWN_UP: Hidden = { track: no, album: no, artist: no, deezer: no };
// a new object only when the flags change, so it can sit in a dependency list
let kidFor: HubFlag[] | undefined;
let kidRatings: HubRating[] | undefined;
let kidObj = GROWN_UP;
function kidFilters(flags: HubFlag[], ratings: HubRating[]) {
  if (flags !== kidFor || ratings !== kidRatings) {
    kidFor = flags;
    kidRatings = ratings;
    kidObj = { track: trackNotForKids, album: albumNotForKids, artist: artistNotForKids, deezer: deezerNotForKids };
  }
  return kidObj;
}

/** Drop what a kid profile may not play (the last line of defence, in the player). */
export const kidSafe = (tracks: Track[]) => (isKid() ? tracks.filter((t) => !trackNotForKids(t)) : tracks);

/** Admin: the flag set on exactly this item, if any. */
export function flagOn(kind: HubFlag['kind'], artist: string, title = ''): HubFlag | undefined {
  const k = key(kind, artist, title);
  return useFlags.getState().flags.find((f) => key(f.kind, f.artist, f.title) === k);
}

/** Admin: mark something not for kids, fine for kids, or clear its flag (`null`). */
export async function setFlag(kind: HubFlag['kind'], artist: string, title: string, verdict: HubFlag['verdict'] | null) {
  const c = hubClient();
  if (!c) throw new Error('Sign in to your Hub first');
  const existing = flagOn(kind, artist, title);
  if (verdict === null) {
    if (existing) await c.deleteFlag(existing.id);
  } else {
    await c.setFlag({ kind, artist, title: kind === 'artist' ? undefined : title, verdict });
  }
  await loadFlags();
}
