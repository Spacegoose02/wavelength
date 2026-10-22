import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { isTauri } from '../lib/http';
import { isAndroid } from '../lib/platform';
import { sourceFor } from '../sources/registry';
import type { Track } from '../sources/types';
import { useSettings } from './settings';

/** A song saved on this device. Tracks are shared between albums/playlists that contain them. */
export interface OfflineTrack {
  key: string;
  path: string;
  size: number;
  savedAt: number;
  track: Track;
}

export interface OfflineCollection {
  id: string;
  kind: 'album' | 'playlist';
  name: string;
  subtitle?: string;
  cover?: string;
  keys: string[];
  savedAt: number;
}

interface Job {
  done: number;
  total: number;
  failed: number;
  error?: string;
}

interface OfflineState {
  tracks: Record<string, OfflineTrack>;
  /** album/series artwork saved locally, keyed by remote URL */
  covers: Record<string, string>;
  collections: OfflineCollection[];
  jobs: Record<string, Job>;
  download(c: { id: string; kind: OfflineCollection['kind']; name: string; subtitle?: string; cover?: string; tracks: Track[] }): Promise<void>;
  remove(id: string): Promise<void>;
}

export const trackKey = (t: Pick<Track, 'sourceId' | 'id'>) => `${t.sourceId}:${t.id}`;
const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 80);
/** File-system-safe stable name for a URL. */
const urlName = (u: string) => {
  let h = 2166136261;
  for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};

export const canDownload = (t: Track) => t.kind === 'track' || t.kind === 'episode';

export const useOffline = create<OfflineState>()(
  persist(
    (set, get) => ({
      tracks: {},
      covers: {},
      collections: [],
      jobs: {},

      async download({ id, kind, name, subtitle, cover, tracks }) {
        if (!isTauri) throw new Error('Downloads work in the Wavelength app, not a browser');
        const list = tracks.filter(canDownload);
        const job: Job = { done: 0, total: list.length, failed: 0 };
        const setJob = (j: Partial<Job>) => set((s) => ({ jobs: { ...s.jobs, [id]: { ...(s.jobs[id] ?? job), ...j } } }));
        setJob(job);

        const saveCover = async (url?: string) => {
          if (!url) return undefined;
          const have = get().covers[url];
          if (have) return have;
          try {
            const f = await invoke<{ path: string }>('offline_save', { url, rel: `covers/${urlName(url)}` });
            set((s) => ({ covers: { ...s.covers, [url]: f.path } }));
            return f.path;
          } catch {
            return undefined;
          }
        };

        // register the collection up front so a half-finished download still shows (and can resume)
        const keys = list.map(trackKey);
        set((s) => ({
          collections: [{ id, kind, name, subtitle, cover, keys, savedAt: Date.now() }, ...s.collections.filter((c) => c.id !== id)],
        }));
        await saveCover(cover);

        const sources = useSettings.getState().sources;
        let done = 0;
        let failed = 0;
        let lastError: string | undefined;
        // two at a time: quick on Wi-Fi without hammering the server
        const queue = [...list];
        await Promise.all(
          [0, 1].map(async () => {
            for (let t = queue.shift(); t; t = queue.shift()) {
              const key = trackKey(t);
              try {
                if (!get().tracks[key]) {
                  const cfg = sources.find((s) => s.id === t.sourceId);
                  const ready = (cfg && (await sourceFor(cfg).prepare?.(t))?.track) || t;
                  if (!ready.streamUrl) throw new Error('no stream for this item');
                  const f = await invoke<{ path: string; size: number }>('offline_save', {
                    url: ready.streamUrl,
                    rel: `tracks/${safe(t.sourceId)}/${safe(t.id)}`,
                  });
                  await saveCover(t.coverUrl);
                  // keep only what's needed to show + play it offline
                  const { streamUrl: _s, sessionId: _x, ...meta } = t;
                  set((s) => ({ tracks: { ...s.tracks, [key]: { key, path: f.path, size: f.size, savedAt: Date.now(), track: meta } } }));
                }
              } catch (e) {
                failed++;
                lastError = String((e as Error).message ?? e);
              }
              setJob({ done: ++done, failed, error: lastError });
            }
          }),
        );
        setJob({ done, failed, error: lastError });
      },

      async remove(id) {
        const { collections, tracks } = get();
        const target = collections.find((c) => c.id === id);
        if (!target) return;
        const rest = collections.filter((c) => c.id !== id);
        const stillUsed = new Set(rest.flatMap((c) => c.keys));
        const drop = target.keys.filter((k) => !stillUsed.has(k) && tracks[k]);
        for (const k of drop) await invoke('offline_delete_file', { path: tracks[k].path }).catch(() => {});
        // artwork no remaining download uses
        const keptTracks = Object.values(tracks).filter((t) => !drop.includes(t.key));
        const usedCovers = new Set([...rest.map((c) => c.cover), ...keptTracks.map((t) => t.track.coverUrl)].filter(Boolean) as string[]);
        const staleCovers = Object.entries(get().covers).filter(([url]) => !usedCovers.has(url));
        for (const [, path] of staleCovers) await invoke('offline_delete_file', { path }).catch(() => {});
        set((s) => {
          const next = { ...s.tracks };
          drop.forEach((k) => delete next[k]);
          const covers = { ...s.covers };
          staleCovers.forEach(([url]) => delete covers[url]);
          const jobs = { ...s.jobs };
          delete jobs[id];
          return { collections: rest, tracks: next, covers, jobs };
        });
      },
    }),
    {
      name: 'tonearm.offline',
      partialize: (s) => ({ tracks: s.tracks, covers: s.covers, collections: s.collections }),
    },
  ),
);

const AUDIO_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
};

/**
 * URL the player should load for a saved song, or undefined if it isn't downloaded.
 *
 * Desktop streams straight from the asset protocol. Android can't: Tauri answers each media
 * Range request with at most ~1 MB (206 Partial Content), and Android's WebView doesn't come
 * back for the next range of an intercepted response, so playback stopped after the first
 * chunk. There we read the whole file once (no Range header, so a full 200 response) and play
 * it from a Blob, which seeks normally. The caller owns the returned blob: URL and should
 * `URL.revokeObjectURL` it once another song is loaded.
 */
export async function offlinePlaybackUrl(t: Pick<Track, 'sourceId' | 'id'>): Promise<string | undefined> {
  const hit = useOffline.getState().tracks[trackKey(t)];
  if (!hit) return undefined;
  const url = convertFileSrc(hit.path);
  if (!isAndroid) return url;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't open the downloaded file (${res.status})`);
  const data = await res.arrayBuffer();
  const ext = hit.path.slice(hit.path.lastIndexOf('.') + 1).toLowerCase();
  return URL.createObjectURL(new Blob([data], { type: AUDIO_TYPES[ext] ?? 'audio/mpeg' }));
}

/** Local artwork for a remote cover URL (falls back to the remote one). */
export function offlineCover(url?: string) {
  const p = url ? useOffline.getState().covers[url] : undefined;
  return p ? convertFileSrc(p) : url;
}

/** Saved tracks of a collection, with local artwork, ready to play. */
export function collectionTracks(c: OfflineCollection): Track[] {
  const { tracks } = useOffline.getState();
  return c.keys.map((k) => tracks[k]).filter(Boolean).map((o) => ({ ...o.track, coverUrl: offlineCover(o.track.coverUrl) }));
}
