/**
 * Sleep timer: stop playback after some minutes, or when the current song (or audiobook chapter file) ends.
 * The last 20 seconds fade out so it doesn't cut off mid-word. Per device, forgotten on restart.
 */
import { create } from 'zustand';
import { engine } from '../player/engine';
import { setStopAfterTrack, usePlayer } from '../store/player';

const FADE_SECONDS = 20;

export type SleepChoice = number | 'track';
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
  start(choice: SleepChoice): void;
  cancel(): void;
}

let timer: number | undefined;
let fading = false;

export const useSleep = create<SleepState>()((set) => ({
  endOfTrack: false,
  start(choice) {
    clear();
    if (choice === 'track') {
      setStopAfterTrack(() => {
        set({ endOfTrack: false });
        engine.pause();
      });
      set({ endOfTrack: true, endsAt: undefined });
      return;
    }
    const endsAt = Date.now() + choice * 60_000;
    set({ endsAt, endOfTrack: false });
    timer = window.setInterval(tick, 1000);
  },
  cancel() {
    clear();
    set({ endsAt: undefined, endOfTrack: false });
  },
}));

function clear() {
  window.clearInterval(timer);
  timer = undefined;
  setStopAfterTrack(undefined);
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
