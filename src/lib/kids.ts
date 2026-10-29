import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DeezerResult } from '../sources/deemix';
import type { HubFlag } from '../sources/hub';
import { norm } from '../sources/registry';
import type { Album, Artist, Track } from '../sources/types';
import { hubClient, useHub } from '../store/hub';
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

/** Fetch the Hub's flags (kept on the device, so a kid profile stays filtered offline). */
export async function loadFlags() {
  const c = hubClient();
  if (!c) return;
  try {
    useFlags.setState({ flags: (await c.flags()).flags });
  } catch {
    /* offline: keep the last list */
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

/** Most specific flag wins: song, then album, then artist. */
function verdictFor(artist?: string, album?: string, title?: string): HubFlag['verdict'] | undefined {
  const v = verdicts();
  return (title ? v.get(key('track', artist, title)) : undefined)
    ?? (album ? v.get(key('album', artist, album)) : undefined)
    ?? v.get(key('artist', artist));
}

export const isKid = () => useHub.getState().user?.role === 'kid';
export const useIsKid = () => useHub((s) => s.user?.role === 'kid');

/** Whether this would be hidden from a kid. `explicit` is the item's own rating. */
export function notForKids(i: { artist?: string; album?: string; title?: string; explicit?: boolean }): boolean {
  const v = verdictFor(i.artist, i.album, i.title);
  if (v) return v === 'block';
  return !!i.explicit;
}

export const trackNotForKids = (t: Track) => t.kind === 'track' && notForKids({ artist: t.artist, album: t.album, title: t.title, explicit: t.explicit === 'explicit' });
export const albumNotForKids = (a: Album) => notForKids({ artist: a.artist, album: a.title, explicit: a.explicit === 'explicit' });
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
  return kid ? kidFilters(flags) : GROWN_UP;
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
let kidObj = GROWN_UP;
function kidFilters(flags: HubFlag[]) {
  if (flags !== kidFor) {
    kidFor = flags;
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
