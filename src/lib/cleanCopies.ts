import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { HubAlbumRating, HubRating } from '../sources/hub';
import { sourceFor } from '../sources/registry';
import type { Album } from '../sources/types';
import { useCatalog } from '../store/catalog';
import { hubClient } from '../store/hub';
import { useSettings } from '../store/settings';
import { verifyCleanLink } from './explicitCheck';
import { albumVersion, loadFlags, useRatings } from './kids';
import { versionKey } from './versions';

/**
 * Inbox → Clean versions → "Check clean versions" (docs/USERS-AND-ADMIN.md §6.5). Up to 0.17.1 the library check
 * took any Deezer album with the same title that Deezer didn't call explicit as the clean version, so some of
 * the albums offered (and downloaded with "Download all") weren't clean. This:
 *  1. checks every clean version the library check offered (lib/explicitCheck.ts `isCleanEdition`) and drops the
 *     ones that aren't, so they leave the list;
 *  2. goes through the clean copies in the library ("… (Clean)") and lists the ones to look at: songs tagged
 *     explicit in the files, or downloaded from a Deezer album that turned out not to be the clean version.
 * Admins can then delete those, or hide them from kids, a few or all at once.
 */

export interface Suspect {
  album: Album;
  reasons: string[];
}

interface CheckState {
  running: boolean;
  step?: string;
  /** Clean versions offered that weren't, as `artist|album` version keys. Kept on the device for the next check. */
  falseMatches: string[];
  suspects?: Suspect[];
  error?: string;
}

export const useCleanCheck = create<CheckState>()(
  persist(() => ({ running: false, falseMatches: [] }) as CheckState, { name: 'tonearm.cleanCheck', partialize: (s) => ({ falseMatches: s.falseMatches }) }),
);

/** The explicit album's explicit songs, from the library check. */
const explicitSongs = (r: HubRating, all: HubRating[]) =>
  all.filter((t) => t.kind === 'track' && t.artist === r.artist && t.album === r.album).map((t) => t.title);

export async function checkCleanVersions() {
  const c = hubClient();
  if (!c || useCleanCheck.getState().running) return;
  const set = (s: Partial<CheckState>) => useCleanCheck.setState(s);
  set({ running: true, step: 'Checking the clean versions on Deezer…', suspects: undefined, error: undefined });
  try {
    // 1. the clean versions on offer
    const ratings = useRatings.getState().ratings;
    const offered = ratings.filter((r) => r.kind === 'album' && r.rating === 'explicit' && r.cleanLink);
    const wrong: HubRating[] = [];
    for (const [i, r] of offered.entries()) {
      set({ step: `Checking clean versions on Deezer: ${i + 1} of ${offered.length}…` });
      if ((await verifyCleanLink(r.cleanLink!, explicitSongs(r, ratings))) === false) wrong.push(r);
    }
    // keep the rating and its explicit songs, without the clean version
    const fixes: HubAlbumRating[] = wrong.map((r) => ({ artist: r.artist, album: r.album, rating: 'explicit', explicitTracks: explicitSongs(r, ratings) }));
    for (let i = 0; i < fixes.length; i += 200) await c.saveRatings(fixes.slice(i, i + 200));
    const falseMatches = [...new Set([...useCleanCheck.getState().falseMatches, ...wrong.map((r) => versionKey({ artist: r.artist, title: r.album }))])];
    set({ falseMatches });
    if (wrong.length) await loadFlags();

    // 2. the clean copies in the library
    const sources = useSettings.getState().sources;
    const copies = useCatalog.getState().albums.flatMap((a) => a.refs ?? [a]).filter((a) => albumVersion(a) === 'clean');
    const suspects: Suspect[] = [];
    for (const [i, a] of copies.entries()) {
      set({ step: `Looking at your clean copies: ${i + 1} of ${copies.length}…` });
      const reasons: string[] = [];
      if (falseMatches.includes(versionKey(a))) reasons.push('Downloaded from a Deezer album that isn’t the clean version');
      const cfg = sources.find((s) => s.id === a.sourceId);
      const tracks = cfg ? await sourceFor(cfg).getAlbumTracks?.(a.id).catch(() => undefined) : undefined;
      const tagged = tracks?.filter((t) => t.explicit === 'explicit') ?? [];
      if (tagged.length) reasons.push(`${tagged.length} song${tagged.length === 1 ? '' : 's'} tagged explicit in the files: ${tagged.slice(0, 3).map((t) => t.title).join(', ')}${tagged.length > 3 ? '…' : ''}`);
      if (reasons.length) suspects.push({ album: a, reasons });
    }
    set({ suspects, step: undefined });
  } catch (e) {
    set({ error: String((e as Error).message ?? e), step: undefined });
  } finally {
    set({ running: false });
  }
}
