/**
 * Audiobooks and podcasts (docs/USER-GUIDE.md "Audiobooks and podcasts"): playback speed, remembered for each
 * book and each show, and chapters. Music always plays at normal speed.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { engine } from '../player/engine';
import { setSpokenSpeed, usePlayer } from '../store/player';
import type { Track } from '../sources/types';

export { bookPosition, chapterAt } from './chapters';

export const SPEEDS = [0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
export const SKIP_BACK = 15;
export const SKIP_FORWARD = 30;

export const isSpoken = (t?: Track) => t?.kind === 'book' || t?.kind === 'episode';

interface SpokenState {
  /** speed for books and shows you haven't set one for */
  fallback: number;
  /** by book id, or by show id for a podcast's episodes */
  speeds: Record<string, number>;
  setSpeed(t: Track, speed: number): void;
}

/** Book or show: what a speed is remembered for. */
const keyOf = (t: Track) => t.bookId ?? t.id;

export const useSpoken = create<SpokenState>()(
  persist(
    (set) => ({
      fallback: 1,
      speeds: {},
      setSpeed(t, speed) {
        // the latest speed you picked also becomes the one new books and shows start at
        set((s) => ({ fallback: speed, speeds: { ...s.speeds, [keyOf(t)]: speed } }));
        const cur = usePlayer.getState().current();
        if (cur && isSpoken(cur) && keyOf(cur) === keyOf(t)) engine.setSpeed(speed);
      },
    }),
    { name: 'wavelength-spoken', partialize: (s) => ({ fallback: s.fallback, speeds: s.speeds }) },
  ),
);

export function speedFor(t: Track): number {
  if (!isSpoken(t)) return 1;
  const { speeds, fallback } = useSpoken.getState();
  return speeds[keyOf(t)] ?? fallback ?? 1;
}
setSpokenSpeed(speedFor);

/** "1.25×" */
export const speedLabel = (n: number) => `${Number(n.toFixed(2))}×`;

/** Real time left until `abs` reaches `end` at the current speed. */
export const realSeconds = (seconds: number, speed: number) => seconds / (speed || 1);
