/**
 * Wake-up alarm (docs/USER-GUIDE.md "Wake-up alarm"): at a set time, on chosen days, Wavelength starts playing
 * something (DJ mode, today's daylist or another mix, a playlist, your liked songs, a radio station, or where you
 * left off), quietly at first and up to your volume over a minute or so. Snooze waits 9 minutes.
 *
 * On Android the system wakes the app for it (AlarmBridge.kt, an alarm clock alarm that also shows in the status
 * bar), so it goes off with Wavelength closed and the phone locked. On a computer, Wavelength has to be running
 * (it can sit in the tray: Settings → Playback → Mini player, tray and hotkeys). Per device, not synced.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { engine } from '../player/engine';
import { usePlayer } from '../store/player';
import type { Track } from '../sources/types';
import { nextAlarm } from './alarmTime';
import { kidSafe } from './kids';
import { featureOn } from './features';

export interface AlarmPlay {
  /**
   * `dj` DJ mode · `resume` carry on with the queue · `mix:<kind>` a Made for you mix (`mix:daylist`, `mix:onRepeat`…)
   * · otherwise an Android Auto id from lib/carBrowse.ts (`fav`, `pl:…`, `sp:…`, `st:…`)
   */
  id: string;
  name: string;
}

interface AlarmState {
  on: boolean;
  time: string;
  days: number[];
  play: AlarmPlay;
  /** seconds from quiet to your volume */
  fadeIn: number;
  snoozeMinutes: number;
  /** a snoozed alarm goes off again at this time (ms) */
  snoozeUntil?: number;
  /** the time (ms) the alarm last went off for, so it only goes off once (the app and Android both watch) */
  firedFor?: number;
  /** going off now: the banner shows Snooze and Stop */
  ringing: boolean;
  error?: string;
  set(p: Partial<Pick<AlarmState, 'on' | 'time' | 'days' | 'play' | 'fadeIn'>>): void;
}

export const DEFAULT_PLAY: AlarmPlay = { id: 'fav', name: 'Liked songs' };

export const useAlarm = create<AlarmState>()(
  persist(
    (set) => ({
      on: false,
      time: '07:00',
      days: [1, 2, 3, 4, 5],
      play: DEFAULT_PLAY,
      fadeIn: 60,
      snoozeMinutes: 9,
      ringing: false,
      set(p) {
        set({ ...p, snoozeUntil: undefined, error: undefined });
        schedule();
      },
    }),
    {
      name: 'wavelength-alarm',
      partialize: ({ on, time, days, play, fadeIn, snoozeMinutes, snoozeUntil, firedFor }) => ({ on, time, days, play, fadeIn, snoozeMinutes, snoozeUntil, firedFor }),
    },
  ),
);

/** When it goes off next (ms), or undefined when it's off. */
export function alarmAt(now = Date.now()): number | undefined {
  const a = useAlarm.getState();
  if (a.snoozeUntil && a.snoozeUntil > now - 60_000) return a.snoozeUntil;
  return a.on ? nextAlarm(a, now) : undefined;
}

interface NativeAlarm {
  setAlarm?(at: number, label: string): boolean;
  cancelAlarm?(): void;
}
const native = () => (typeof window !== 'undefined' ? (window.WavelengthNative as NativeAlarm | undefined) : undefined);

/** Hand the next time to Android (it wakes the app); the app's own check covers computers and older Android builds. */
export function schedule() {
  const at = alarmAt();
  const n = native();
  try {
    if (at && n?.setAlarm) {
      const { play } = useAlarm.getState();
      if (!n.setAlarm(at, `Wavelength: ${play.name}`)) useAlarm.setState({ error: 'Android didn’t allow an exact alarm. Allow “Alarms & reminders” for Wavelength in Android settings.' });
    } else n?.cancelAlarm?.();
  } catch {
    /* an older app build without alarms: the in-app check still runs while Wavelength is open */
  }
}

/** Android's alarm went off (MediaBridge sends `alarm`), or the app's own check found it's time. */
export function alarmDue(now = Date.now()) {
  const a = useAlarm.getState();
  const at = a.snoozeUntil ?? (a.on ? lastDue(now) : undefined);
  if (!at || a.firedFor === at || at > now + 1000 || now - at > 10 * 60_000) return;
  void fire(at);
}

/** The alarm time that has just passed (within 10 minutes), if any. */
function lastDue(now: number): number | undefined {
  const a = useAlarm.getState();
  const at = nextAlarm(a, now - 10 * 60_000);
  return at !== undefined && at <= now + 1000 ? at : undefined;
}

let ramp: number | undefined;
/** the person's own volume, put back when the fade-in ends or is stopped */
let fullVolume = 1;

function endRamp() {
  if (ramp === undefined) return;
  window.clearInterval(ramp);
  ramp = undefined;
  engine.setVolume(fullVolume);
}

async function fire(at: number) {
  const a = useAlarm.getState();
  // a one-off alarm turns itself off once it has gone off
  useAlarm.setState({ firedFor: at, snoozeUntil: undefined, ringing: true, error: undefined, ...(!a.days.length && !a.snoozeUntil && { on: false }) });
  schedule();
  endRamp();
  fullVolume = usePlayer.getState().volume;
  engine.setVolume(fullVolume * 0.05);
  const ok = await startPlaying(a.play).catch(() => false);
  if (!ok) {
    engine.setVolume(fullVolume);
    useAlarm.setState({ error: `Couldn’t play ${a.play.name}`, ringing: true });
    return;
  }
  const started = Date.now();
  const { fadeInLevel } = await import('./alarmTime');
  ramp = window.setInterval(() => {
    const k = fadeInLevel((Date.now() - started) / 1000, useAlarm.getState().fadeIn);
    engine.setVolume(fullVolume * k);
    if (k >= 1) endRamp();
  }, 250);
}

/** Start what the alarm plays; falls back to liked songs. */
async function startPlaying(play: AlarmPlay): Promise<boolean> {
  const p = usePlayer.getState();
  if (play.id === 'resume' && p.queue.length) {
    if (!p.playing) p.toggle();
    return true;
  }
  if (play.id === 'dj' && featureOn('djMode')) {
    const { startStation, useStation } = await import('./djStation');
    await startStation({ mix: true });
    if (useStation.getState().on) return true;
  }
  let tracks: Track[] = [];
  if (play.id.startsWith('mix:')) {
    const { loadMixes, mixTracks, useMixes } = await import('./mixes');
    const want = play.id.slice(4);
    const mixes = await loadMixes().catch(() => useMixes.getState().mixes);
    const mix = mixes.find((m) => m.kind === want || m.id === want);
    if (mix) tracks = await mixTracks(mix, 50);
  } else if (!['dj', 'resume'].includes(play.id)) {
    const { carTracks } = await import('./carBrowse');
    tracks = await carTracks(play.id);
  }
  tracks = kidSafe(tracks);
  if (!tracks.length && play.id !== 'fav') return startPlaying(DEFAULT_PLAY);
  if (!tracks.length) return false;
  // a station plays as it is; anything else starts somewhere new each morning
  const start = tracks[0].kind === 'radio' ? 0 : Math.floor(Math.random() * Math.min(tracks.length, 20));
  usePlayer.getState().playTracks(tracks, start);
  return true;
}

/** Banner: snooze for 9 minutes. */
export function snooze() {
  const a = useAlarm.getState();
  endRamp();
  if (usePlayer.getState().playing) usePlayer.getState().toggle();
  useAlarm.setState({ ringing: false, snoozeUntil: Date.now() + a.snoozeMinutes * 60_000 });
  schedule();
}

/** Banner: stop the music. */
export function stopAlarm() {
  endRamp();
  if (usePlayer.getState().playing) usePlayer.getState().toggle();
  useAlarm.setState({ ringing: false, error: undefined });
}

/** Banner: I'm up, keep the music on (at full volume). */
export function keepPlaying() {
  endRamp();
  useAlarm.setState({ ringing: false, error: undefined });
}

let started = false;
export function startAlarm() {
  if (started) return;
  started = true;
  const run = () => {
    schedule();
    // the app's own check, every 15 s: computers, and Android builds from before the system alarm
    window.setInterval(() => alarmDue(), 15_000);
    alarmDue();
  };
  if (useAlarm.persist.hasHydrated()) run();
  else useAlarm.persist.onFinishHydration(run);
  // turning the volume yourself during the fade-in ends it there
  usePlayer.subscribe((s, p) => {
    if (s.volume !== p.volume && ramp !== undefined) {
      fullVolume = s.volume;
      endRamp();
    }
  });
}
