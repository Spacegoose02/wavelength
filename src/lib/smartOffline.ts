import { isTauri } from './http';
import { featureOn } from './features';
import { sourceFor } from '../sources/registry';
import type { Track } from '../sources/types';
import { useLibrary } from '../store/library';
import { canDownload, trackKey, useOffline } from '../store/offline';
import { useSettings } from '../store/settings';
export { DEFAULT_SMART_OFFLINE, type SmartOfflineSettings } from '../store/settings';

/**
 * Smart offline: keeps music on this device without anyone picking albums. Each "shelf" (♥ favourites, songs
 * played lately, Made for you mixes, …) is an `auto` collection in the offline store, refreshed every few
 * hours while the app is open, on Wi-Fi only unless told otherwise, and kept under a size cap: shelves are
 * filled in priority order until the cap is reached, and songs that fall off a shelf are deleted (unless an
 * album or playlist download still has them).
 *
 * Per device, not synced: a phone and a PC want different things. Settings → Downloads → Smart offline.
 * A Hub admin can switch the feature off (lib/features.ts `smartOffline`).
 */

/** One shelf. Lower `priority` fills first. */
export interface Shelf {
  id: string;
  name: string;
  priority: number;
  /** which setting turns it on */
  setting: 'favorites' | 'recent' | 'mixes';
  tracks(): Promise<Track[]>;
}

const shelves = new Map<string, Shelf>();
/** More shelves (the mixes do this). Registering the same id again replaces it. */
export function registerShelf(s: Shelf) {
  shelves.set(s.id, s);
}

registerShelf({
  id: 'auto:favorites',
  name: 'Favourites (kept offline)',
  priority: 0,
  setting: 'favorites',
  async tracks() {
    const out: Track[] = [];
    for (const cfg of useSettings.getState().sources.filter((s) => s.enabled)) {
      const src = sourceFor(cfg);
      if (!src.getFavorites) continue;
      const f = await src.getFavorites().catch(() => null);
      if (f) out.push(...f.tracks);
    }
    return out;
  },
});

registerShelf({
  id: 'auto:recent',
  name: 'Played lately (kept offline)',
  priority: 20,
  setting: 'recent',
  async tracks() {
    const days = useSettings.getState().smartOffline.recentDays;
    const since = Date.now() - days * 86_400_000;
    // most played first, so a tight cap keeps the songs you actually come back to
    const counts = new Map<string, { t: Track; n: number; last: number }>();
    for (const p of useLibrary.getState().history) {
      if (p.playedAt < since) continue;
      const k = trackKey(p.track);
      const c = counts.get(k);
      if (c) c.n++;
      else counts.set(k, { t: p.track, n: 1, last: p.playedAt });
    }
    return [...counts.values()].sort((a, b) => b.n - a.n || b.last - a.last).map((c) => c.t);
  },
});

const AVG_SONG = 8e6;

/** Whether the device says it's on a metered/cellular connection (Android WebView exposes this). */
function onCellular(): boolean {
  const c = (navigator as Navigator & { connection?: { type?: string; saveData?: boolean } }).connection;
  return c?.type === 'cellular' || !!c?.saveData;
}

/**
 * Which songs each shelf keeps, under the cap. Pure, for tests: `sizes` has the size of songs already saved;
 * others count as `avg` bytes.
 */
export function plan(lists: { id: string; priority: number; tracks: Track[] }[], capBytes: number, sizes: Record<string, number>, avg = AVG_SONG): Record<string, Track[]> {
  const out: Record<string, Track[]> = {};
  const taken = new Set<string>();
  let used = 0;
  for (const l of [...lists].sort((a, b) => a.priority - b.priority)) {
    out[l.id] = [];
    for (const t of l.tracks) {
      if (!canDownload(t)) continue;
      const k = trackKey(t);
      if (taken.has(k)) {
        out[l.id].push(t);
        continue;
      }
      const size = sizes[k] ?? avg;
      if (used + size > capBytes) continue;
      used += size;
      taken.add(k);
      out[l.id].push(t);
    }
  }
  return out;
}

let running: Promise<string> | null = null;

/** Refresh every shelf now. Resolves with a short note for Settings. */
export function runSmartOffline(force = false): Promise<string> {
  if (running) return running;
  running = (async () => {
    const cfg = useSettings.getState().smartOffline;
    if (!isTauri) return 'Smart offline works in the Wavelength app, not a browser.';
    if (!featureOn('smartOffline')) return 'An admin turned smart offline off on the Hub.';
    if (!cfg.enabled && !force) return 'Off.';
    if (cfg.wifiOnly && onCellular()) return 'Waiting for Wi-Fi.';
    const off = useOffline.getState();
    const on = [...shelves.values()].filter((s) => (s.setting === 'recent' ? cfg.recentDays > 0 : cfg[s.setting]));
    const lists = await Promise.all(on.map(async (s) => ({ id: s.id, name: s.name, priority: s.priority, tracks: await s.tracks().catch(() => [] as Track[]) })));
    const sizes = Object.fromEntries(Object.values(off.tracks).map((t) => [t.key, t.size]));
    const saved = Object.values(off.tracks);
    const avg = saved.length ? saved.reduce((a, t) => a + t.size, 0) / saved.length : AVG_SONG;
    const picks = plan(lists, cfg.capMb * 1e6, sizes, avg);
    // shelves turned off: drop them
    for (const c of off.collections.filter((c) => c.kind === 'auto' && !picks[c.id])) await useOffline.getState().remove(c.id);
    let songs = 0;
    for (const l of lists) {
      const tracks = picks[l.id];
      await useOffline.getState().trim(l.id, tracks.map(trackKey));
      if (!tracks.length) {
        await useOffline.getState().remove(l.id);
        continue;
      }
      await useOffline.getState().download({ id: l.id, kind: 'auto', name: l.name, cover: tracks.find((t) => t.coverUrl)?.coverUrl, tracks });
      songs += tracks.length;
    }
    useSettings.getState().setSmartOffline({ lastRun: Date.now() });
    return `Up to date: ${songs} songs on ${lists.filter((l) => picks[l.id].length).length} shelves.`;
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Every 3 hours while the app is open, and shortly after it starts. */
export function startSmartOffline() {
  const tick = () => {
    const c = useSettings.getState().smartOffline;
    if (c.enabled && Date.now() - (c.lastRun ?? 0) > 3 * 3600_000) runSmartOffline().catch(() => undefined);
  };
  setTimeout(tick, 60_000);
  setInterval(tick, 20 * 60_000);
}
