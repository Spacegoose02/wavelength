/** The saved queue for lib/resume.ts: pure helpers (tested in test/resume.test.ts). */
import type { Track } from '../sources/types';

export interface SavedQueue {
  v: 1;
  /** who was listening (Hub user id), so a profile switch doesn't hand one person's queue to another */
  who: string;
  queue: Track[];
  index: number;
  /** seconds into the song */
  at: number;
  savedAt: number;
}

export const RESUME_KEY = 'wavelength.resume';
/** Most of a long queue is kept, centred on the song playing. */
const MAX = 300;
/** Older than this, a fresh start is more likely what you want. */
const MAX_AGE = 30 * 86_400_000;

/** A track as it's saved: no one-off listening session, and no stream link where the server makes a new one per play. */
export function storable(t: Track, regenerates: (t: Track) => boolean): Track {
  const { sessionId: _s, ...rest } = t;
  return regenerates(t) ? { ...rest, streamUrl: undefined } : rest;
}

/** The part of the queue kept: up to MAX songs around the one playing. Returns the slice and the index in it. */
export function trimQueue<T>(queue: T[], index: number, max = MAX): { queue: T[]; index: number } {
  if (queue.length <= max) return { queue, index };
  const from = Math.max(0, Math.min(index - Math.floor(max / 6), queue.length - max));
  return { queue: queue.slice(from, from + max), index: index - from };
}

/** What to put back on launch, or undefined (nothing saved, someone else's, too old, broken). */
export function usable(saved: SavedQueue | null | undefined, who: string, now = Date.now()): SavedQueue | undefined {
  if (!saved || saved.v !== 1 || saved.who !== who || !Array.isArray(saved.queue)) return undefined;
  if (now - saved.savedAt > MAX_AGE) return undefined;
  if (saved.index < 0 || saved.index >= saved.queue.length) return undefined;
  return saved;
}
