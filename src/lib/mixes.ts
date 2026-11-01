import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { HubMix, HubMixSong } from '../sources/hub';
import type { Track } from '../sources/types';
import { hubClient } from '../store/hub';
import { useSettings } from '../store/settings';
import { featureOn } from './features';
import { kidSafe } from './kids';
import { findInLibrary, pool } from './match';
import { registerShelf } from './smartOffline';

/**
 * Made for you mixes and Blends from the Hub (hub/src/mixes.ts), for Home and the mix page (views/Mix.tsx).
 * The Hub names songs; this finds each in the person's own library: a song they played comes with the track
 * that played, used as is when that server is on this device, and anything else is looked up by title and
 * artist (Navidrome, then Plex). Songs the library doesn't have are left out. Kid profiles get kidSafe() on top.
 *
 * The last list is kept on the device so Home shows mixes straight away (and offline); smart offline keeps
 * the songs of every mix downloaded when it's turned on (lib/smartOffline.ts).
 */

interface MixState {
  mixes: HubMix[];
  builtAt: number;
  /** songs found per mix id (kept, so a mix opens instantly the second time) */
  found: Record<string, { day: number; tracks: Track[] }>;
}

export const useMixes = create<MixState>()(persist(() => ({ mixes: [] as HubMix[], builtAt: 0, found: {} as MixState['found'] }), { name: 'tonearm.mixes' }));

export async function loadMixes(fresh = false): Promise<HubMix[]> {
  const c = hubClient();
  if (!c || !featureOn('homeMixes')) return [];
  const r = await c.mixes(fresh);
  const keep = new Set(r.mixes.map((m) => m.id));
  useMixes.setState((s) => ({
    mixes: r.mixes,
    builtAt: r.builtAt,
    // a new day's mix has new songs: forget what was found for the old one
    found: Object.fromEntries(Object.entries(s.found).filter(([id, f]) => keep.has(id) && f.day === r.builtAt)),
  }));
  return r.mixes;
}

/** One song in this library, or undefined (also DJ mode, lib/djStation.ts). */
export async function findSong(s: HubMixSong, find: ReturnType<typeof findInLibrary>): Promise<Track | undefined> {
  const t = s.track;
  if (t?.sourceId && t.id && useSettings.getState().sources.some((x) => x.id === t.sourceId && x.enabled)) {
    const { streamUrl: _u, ...rest } = t;
    return rest as Track;
  }
  return find({ title: s.title, artist: s.artist });
}

/** A mix's songs found in this library, at most `max`. Cached for the day. */
export async function mixTracks(mix: HubMix, max = 50, onProgress?: (n: number) => void): Promise<Track[]> {
  const day = useMixes.getState().builtAt;
  const hit = useMixes.getState().found[mix.id];
  if (hit && hit.day === day && mix.kind !== 'blend') return kidSafe(hit.tracks);
  const find = findInLibrary();
  let n = 0;
  const all = await pool(mix.songs, 4, async (s) => {
    const t = await findSong(s, find).catch(() => undefined);
    onProgress?.(++n);
    return t;
  });
  const seen = new Set<string>();
  const tracks = all.filter((t): t is Track => {
    if (!t) return false;
    const k = `${t.sourceId}:${t.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, max);
  if (mix.kind !== 'blend') useMixes.setState((s) => ({ found: { ...s.found, [mix.id]: { day, tracks } } }));
  return kidSafe(tracks);
}

/** Up to four different covers for a mix's mosaic. */
export function mixCovers(mix: HubMix): string[] {
  const out: string[] = [];
  for (const s of mix.songs) {
    const c = s.coverUrl ?? (s.track?.coverUrl as string | undefined);
    if (c && !out.includes(c)) out.push(c);
    if (out.length === 4) break;
  }
  return out;
}

// smart offline keeps the mixes (one shelf for all of them)
registerShelf({
  id: 'auto:mixes',
  name: 'Made for you (kept offline)',
  priority: 10,
  setting: 'mixes',
  async tracks() {
    const mixes = await loadMixes().catch(() => useMixes.getState().mixes);
    const lists = [];
    for (const m of mixes) lists.push(await mixTracks(m, 30));
    // take turns so a tight cap keeps some of every mix
    const out: Track[] = [];
    for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (l[i]) out.push(l[i]);
    return out;
  },
});
