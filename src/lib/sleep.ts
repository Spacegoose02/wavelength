/**
 * Sleep timer: stop playback after some minutes, when the current song (or audiobook file) ends, or at the end
 * of the audiobook or podcast chapter that's playing (lib/spoken.ts).
 * The last 20 seconds fade out so it doesn't cut off mid-word. Per device, forgotten on restart.
 */
import { create } from 'zustand';
import { engine } from '../player/engine';
import { setStopAfterTrack, usePlayer } from '../store/player';
import { bookPosition, chapterAt } from './chapters';

const FADE_SECONDS = 20;

export type SleepChoice = number | 'track' | 'chapter';
export const SLEEP_CHOICES: { value: SleepChoice; label: string }[] = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '1 hour' },
  { value: 90, label: '1½ hours' },
  { value: 'track', label: 'End of this song' },
];

interface SleepState {
  /** when playback stops (ms since epoch), for a timed sleep */
  endsAt?: number;
  /** stop when the current song ends */
  endOfTrack: boolean;
  /** stop at this point in the audiobook or episode (the end of the chapter playing when it was set), seconds */
  chapterEnd?: number;
  start(choice: SleepChoice): void;
  cancel(): void;
}

let timer: number | undefined;
let fading = false;

export const useSleep = create<SleepState>()((set) => ({
  endOfTrack: false,
  start(choice) {
    clear();
    if (choice === 'chapter') {
      const t = usePlayer.getState().current();
      const now = t && chapterAt(t.chapters, bookPosition(t, engine.el.currentTime));
      if (!t || !now) return;
      chapterFor = t.bookId ?? t.id;
      set({ chapterEnd: now.chapter.end, endsAt: undefined, endOfTrack: false });
      timer = window.setInterval(chapterTick, 500);
      return;
    }
    if (choice === 'track') {
      setStopAfterTrack(() => {
        set({ endOfTrack: false });
        engine.pause();
      });
      set({ endOfTrack: true, endsAt: undefined, chapterEnd: undefined });
      return;
    }
    const endsAt = Date.now() + choice * 60_000;
    set({ endsAt, endOfTrack: false, chapterEnd: undefined });
    timer = window.setInterval(tick, 1000);
  },
  cancel() {
    clear();
    set({ endsAt: undefined, endOfTrack: false, chapterEnd: undefined });
  },
}));

function clear() {
  window.clearInterval(timer);
  timer = undefined;
  setStopAfterTrack(undefined);
}

/** The book or show the chapter sleep was set in: playing something else ends it. */
let chapterFor: string | undefined;

function chapterTick() {
  const { chapterEnd } = useSleep.getState();
  const t = usePlayer.getState().current();
  if (chapterEnd === undefined || fading) return;
  if (!t || (t.bookId ?? t.id) !== chapterFor) {
    useSleep.getState().cancel();
    return;
  }
  const left = (chapterEnd - bookPosition(t, engine.el.currentTime)) / (engine.speed() || 1);
  if (left > 3) return;
  fading = true;
  clear();
  engine.fadeOut(Math.max(0, left)).finally(() => {
    fading = false;
    useSleep.setState({ chapterEnd: undefined });
  });
}

function tick() {
  const { endsAt } = useSleep.getState();
  if (!endsAt || fading) return;
  if (endsAt - Date.now() > FADE_SECONDS * 1000) return;
  fading = true;
  clear();
  const playing = usePlayer.getState().playing;
  (playing ? engine.fadeOut(Math.max(0, (endsAt - Date.now()) / 1000)) : Promise.resolve()).finally(() => {
    fading = false;
    useSleep.setState({ endsAt: undefined });
  });
}

/** "12:30" left on a timed sleep, for the button. */
export function sleepLeft(endsAt: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((endsAt - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
