import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DeezerResult } from '../sources/deemix';
import type { FlagVersion, HubFlag, HubRating } from '../sources/hub';
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
 *
 * An album's clean version ("Loud (Clean)") and the explicit one have the same name once the mark is dropped,
 * and their songs have the same titles. So a song or album flag also says which version it's for, and only
 * applies to that version (`FlagVersion`, the same rules as the Hub's hub/src/kidSafe.ts):
 *   'clean'     "(Clean)", "(Edited)" or "(Censored)" in the album's or song's title
 *   ''          anything else, whatever its explicit tag says (one album holds songs tagged both ways)
 *   'any'       every version: artists, and "Hide every version"
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
const flagKey = (kind: string, artist: string, title: string, version: FlagVersion) => `${key(kind, artist, title)}|${kind === 'artist' ? 'any' : version}`;
/**
 * A flag's version. From a Hub older than versions, the title says whether it's the clean version. 'explicit'
 * (saved by 0.17.2 for songs tagged explicit) counts as '': the tag doesn't make another version.
 */
const versionOfFlag = (f: HubFlag): FlagVersion =>
  f.kind === 'artist' ? 'any' : f.version === 'explicit' ? '' : f.version ?? (CLEAN_MARK.test(f.title) ? 'clean' : '');

/**
 * Which version a song is, for kid-safe flags: the clean version when its album's name (or its own) has
 * "(Clean)" in it. Not from its tag: on an explicit album the songs without bad words are tagged clean too.
 */
export function trackVersion(t: Pick<Track, 'album' | 'title'>): Exclude<FlagVersion, 'any' | 'explicit'> {
  return CLEAN_MARK.test(t.album ?? '') || CLEAN_MARK.test(t.title) ? 'clean' : '';
}
/** Which version an album is, for kid-safe flags: "(Clean)" in its name. */
export function albumVersion(a: Pick<Album, 'title'>): Exclude<FlagVersion, 'any' | 'explicit'> {
  return CLEAN_MARK.test(a.title) ? 'clean' : '';
}

let indexed: HubFlag[] | undefined;
let index = new Map<string, HubFlag['verdict']>();
function verdicts() {
  const { flags } = useFlags.getState();
  if (flags !== indexed) {
    indexed = flags;
    index = new Map(flags.map((f) => [flagKey(f.kind, f.artist, f.title, versionOfFlag(f)), f.verdict]));
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

/** "(Clean)", "(Edited)" and the like in an album title: the clean version (Inbox → Clean versions saves them so). */
export const CLEAN_MARK = /[([]\s*(clean|edited|censored)\b[^)\]]*[)\]]/i;

/**
 * Explicit or clean: the file's own tag first, then the album's title, then the library check. A song on a
 * checked explicit album that isn't in its explicit list is clean. The library check's rating is for the
 * explicit album: "Loud (Clean)" shares its name once "(Clean)" is dropped, so the title is looked at first.
 */
export function explicitOfTrack(t: Pick<Track, 'artist' | 'album' | 'title' | 'explicit'>): 'explicit' | 'clean' | undefined {
  if (t.explicit) return t.explicit;
  if (CLEAN_MARK.test(t.album ?? '')) return 'clean';
  const idx = ratingIndex();
  if (idx.get(`${key('album', t.artist, t.album)}|${cleanTitle(t.title)}`)) return 'explicit';
  const a = idx.get(key('album', t.artist, t.album));
  return a?.rating === 'explicit' || a?.rating === 'clean' ? 'clean' : undefined;
}
export function explicitOfAlbum(a: Pick<Album, 'artist' | 'title' | 'explicit'>): 'explicit' | 'clean' | undefined {
  if (a.explicit) return a.explicit;
  if (CLEAN_MARK.test(a.title)) return 'clean';
  const r = albumRating(a.artist, a.title)?.rating;
  return r === 'explicit' || r === 'clean' ? r : undefined;
}

/**
 * Most specific flag wins: song, then album, then artist. A flag on this version counts, then one on every
 * version; a flag on another version of the same song or album doesn't.
 */
function verdictFor(i: { artist?: string; album?: string; title?: string; version: '' | 'clean' }): HubFlag['verdict'] | undefined {
  const v = verdicts();
  const get = (kind: string, title = '') => v.get(flagKey(kind, i.artist ?? '', title, i.version)) ?? v.get(flagKey(kind, i.artist ?? '', title, 'any'));
  return (i.title ? get('track', i.title) : undefined) ?? (i.album ? get('album', i.album) : undefined) ?? v.get(flagKey('artist', i.artist ?? '', '', 'any'));
}

/** Kid profiles get a shorter, bigger menu, with these labels. */
export const KID_VIEWS: Partial<Record<Route['view'], string>> = {
  home: 'Home', search: 'Search', discover: 'Discover', albums: 'Albums', artists: 'Artists', favorites: 'Favorites',
  radio: 'Radio', books: 'Audiobooks', downloads: 'Ask for music', inbox: 'Inbox', settings: 'Me', playlists: 'Playlists', dj: 'DJ',
};

export const isKid = () => useHub.getState().user?.role === 'kid';
export const useIsKid = () => useHub((s) => s.user?.role === 'kid');

/** Whether this would be hidden from a kid. `explicit` is the item's own rating, `version` which version it is. */
export function notForKids(i: { artist?: string; album?: string; title?: string; explicit?: boolean; version?: '' | 'clean' }): boolean {
  const v = verdictFor({ ...i, version: i.version ?? '' });
  if (v) return v === 'block';
  return !!i.explicit;
}

export const trackNotForKids = (t: Track) =>
  t.kind === 'track' && notForKids({ artist: t.artist, album: t.album, title: t.title, explicit: explicitOfTrack(t) === 'explicit', version: trackVersion(t) });
export const albumNotForKids = (a: Album) => notForKids({ artist: a.artist, album: a.title, explicit: explicitOfAlbum(a) === 'explicit', version: albumVersion(a) });
export const artistNotForKids = (a: Artist) => notForKids({ artist: a.name });
/** Deezer: "(Clean)" in the title makes the clean version. */
export const deezerNotForKids = (r: DeezerResult) => {
  const album = r.type === 'album' ? r.title : r.album;
  const version = CLEAN_MARK.test(album ?? '') || (r.type === 'track' && CLEAN_MARK.test(r.title)) ? 'clean' : '';
  return notForKids({ artist: r.type === 'artist' ? r.title : r.artist, album, title: r.type === 'track' ? r.title : undefined, explicit: r.explicit, version });
};

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

/** Admin: the flag set on exactly this item and version, if any. */
export function flagOn(kind: HubFlag['kind'], artist: string, title: string, version: FlagVersion): HubFlag | undefined {
  const k = flagKey(kind, artist, title, version);
  return useFlags.getState().flags.find((f) => flagKey(f.kind, f.artist, f.title, versionOfFlag(f)) === k);
}

/** Admin: mark this version of something not for kids, fine for kids, or clear its flag (`null`). */
export async function setFlag(kind: HubFlag['kind'], artist: string, title: string, version: FlagVersion, verdict: HubFlag['verdict'] | null) {
  const c = hubClient();
  if (!c) throw new Error('Sign in to your Hub first');
  const existing = flagOn(kind, artist, title, version);
  if (verdict === null) {
    if (existing) await c.deleteFlag(existing.id);
  } else {
    await c.setFlag({ kind, artist, title: kind === 'artist' ? undefined : title, version: kind === 'artist' ? 'any' : version, verdict });
  }
  await loadFlags();
}

/** Admin: remove one flag from the list. */
export async function removeFlag(id: number) {
  const c = hubClient();
  if (!c) throw new Error('Sign in to your Hub first');
  await c.deleteFlag(id);
  await loadFlags();
}

/** How to name a flag's version in lists. */
export const flagVersionLabel = (f: HubFlag) => {
  const v = versionOfFlag(f);
  return f.kind === 'artist' ? '' : v === 'clean' ? 'clean version' : v === 'any' ? 'every version' : '';
};
