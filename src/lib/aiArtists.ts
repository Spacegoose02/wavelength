import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AiArtist, AiArtistPrefs } from '../../hub/src/api/aiArtists';
import { hubClient, useHub } from '../store/hub';
import { useSettings } from '../store/settings';
import { primaryArtist } from './match';

/**
 * AI-generated artists (docs/USER-GUIDE.md, "AI-generated artists"): artists a Hub admin marked, from Edit artist,
 * an artist's Deezer page or a song's menu. The list is kept on the Hub (hub/src/aiArtists.ts) and on this device,
 * read at start, when the profile changes and every ten minutes. Marked artists get a ✦ AI badge
 * (components/AiBadge.tsx); each person can hide them from Discover (`hideInDiscover`) and keep them out of what
 * Wavelength picks for them (`outOfPicks`, which lib/dontPlay.ts and the Hub's dontPlay.ts treat as Don't play).
 * Names match on the main artist, without case, accents, a leading "the" or punctuation, like Don't play.
 */
export type { AiArtist, AiArtistPrefs };

/** Like Don't play's: lower case, no accents, no leading "the", "&" as "and", letters and digits only. */
export const normName = (s = '') =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/^the\s+/, '').replace(/&/g, 'and').replace(/[^\p{L}\p{N}]+/gu, '');

interface State {
  artists: AiArtist[];
}
export const useAiArtists = create<State>()(persist(() => ({ artists: [] as AiArtist[] }), { name: 'wavelength.aiArtists' }));

let indexed: AiArtist[] | undefined;
let keys = new Set<string>();
function keySet(list: AiArtist[]) {
  if (list !== indexed) {
    indexed = list;
    keys = new Set(list.map((a) => normName(a.name)).filter(Boolean));
  }
  return keys;
}

/** Whether these marks cover an artist credit: the whole name ("Simon & Garfunkel") or its main artist ("A feat. B" → A). */
export function isAiIn(list: AiArtist[], artist = ''): boolean {
  if (!list.length || !artist) return false;
  const k = keySet(list);
  return k.has(normName(artist)) || k.has(normName(primaryArtist(artist)));
}

export const isAiArtist = (artist = '') => isAiIn(useAiArtists.getState().artists, artist);

/** The mark itself (who set it, when), for the artist page. */
export function aiMarkOf(list: AiArtist[], artist = ''): AiArtist | undefined {
  if (!isAiIn(list, artist)) return undefined;
  return list.find((a) => normName(a.name) === normName(artist)) ?? list.find((a) => normName(a.name) === normName(primaryArtist(artist)));
}

/** Re-renders when the list changes. */
export function useIsAi(artist = ''): boolean {
  const list = useAiArtists((s) => s.artists);
  return isAiIn(list, artist);
}

/** Discover's filter: true for an artist this person hides there. A new function only when the list or the choice changes. */
export function useAiHiddenInDiscover(): (artist: string) => boolean {
  const list = useAiArtists((s) => s.artists);
  const on = useSettings((s) => s.aiArtists.hideInDiscover);
  return on && list.length ? (artist) => isAiIn(list, artist) : NEVER;
}
const NEVER = () => false;

/** The names Don't play adds when this person keeps AI artists out of their picks. */
export function aiOutOfPicks(): string[] {
  return useSettings.getState().aiArtists.outOfPicks ? useAiArtists.getState().artists.map((a) => a.name) : [];
}

export async function loadAiArtists() {
  const c = hubClient();
  if (!c) return;
  try {
    const r = await c.aiArtists();
    useAiArtists.setState({ artists: r.artists });
  } catch {
    // an older Hub, or offline: keep what this device has
  }
}

let started = false;
/** Keep the list fresh: now, when the profile changes, and every ten minutes. */
export function startAiArtistChecks() {
  if (started) return;
  started = true;
  void loadAiArtists();
  setInterval(() => void loadAiArtists(), 600_000);
  useHub.subscribe((s, prev) => s.token !== prev.token && void loadAiArtists());
}

/** Admins: mark or unmark an artist. The list changes here at once, then the Hub's is read back. */
export async function setAiArtist(name: string, ai: boolean) {
  const c = hubClient();
  if (!c) throw new Error('Marking AI artists needs a Wavelength Hub');
  const r = await c.setAiArtist(name.trim(), ai);
  const rest = useAiArtists.getState().artists.filter((a) => normName(a.name) !== normName(name));
  useAiArtists.setState({ artists: r.artist ? [...rest, r.artist].sort((a, b) => a.name.localeCompare(b.name)) : rest });
  void loadAiArtists();
}
