/**
 * Bit-perfect output (Windows app): songs play through src-tauri/src/hifi.rs, which decodes them itself and
 * takes the sound device in exclusive mode at the file's own sample rate and bit depth. The engine treats it
 * like a cast speaker (engine.setRemote), so the queue, seeking and scrobbling work as usual; the EQ, ReplayGain,
 * crossfade, sing mode and visualizers don't, since those would change the sound.
 */
import { invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { engine, type RemoteOutput } from '../player/engine';
import { reloadCurrent, usePlayer } from '../store/player';
import { useHub } from '../store/hub';
import { featureOn } from './features';
import { isTauri } from './http';

interface HifiStatus {
  state: string;
  position: number;
  duration: number;
  format?: string | null;
  error?: string | null;
}

interface HifiState {
  on: boolean;
  set(on: boolean): void;
  /** What the device is playing ("96000 Hz · 24-bit"), and the last problem. */
  format: string;
  error: string;
  available: boolean;
}

export const useHifi = create<HifiState>()(
  persist((set) => ({ on: false, set: (on) => set({ on }), format: '', error: '', available: false }), {
    name: 'wavelength-hifi',
    partialize: (s) => ({ on: s.on }),
  }),
);

/** Navidrome sends the original file only when asked (a player's transcoding setting may say otherwise). */
const original = (url: string) => (/\/rest\/stream(\.view)?\?/.test(url) && !/[?&]format=/.test(url) ? `${url}&format=raw` : url);

const output: RemoteOutput = {
  load: (url, startAt) =>
    invoke<void>('hifi_load', { url: original(url), start: startAt }).catch((e) => {
      useHifi.setState({ error: String((e as Error)?.message ?? e) });
      engine.remoteUpdate({ state: 'error', position: 0, duration: 0 });
    }),
  play: () => invoke('hifi_command', { cmd: 'play', value: null }),
  pause: () => invoke('hifi_command', { cmd: 'pause', value: null }),
  seek: (t) => invoke('hifi_command', { cmd: 'seek', value: t }),
  setVolume: (v) => invoke('hifi_command', { cmd: 'volume', value: v }),
};

let active = false;
let poll: ReturnType<typeof setInterval> | undefined;

/** The output this device should use when it isn't casting: bit-perfect when it's on, else the browser's. */
export function localOutput(): RemoteOutput | null {
  return active ? output : null;
}

function want() {
  return useHifi.getState().on && useHifi.getState().available && featureOn('exclusiveAudio');
}

async function apply() {
  const on = want();
  if (on === active) return;
  // casting wins; lib/cast.ts hands back to localOutput() when it stops
  const casting = engine.isRemote() && !active;
  const { position, playing } = usePlayer.getState();
  active = on;
  clearInterval(poll);
  poll = undefined;
  if (on) {
    poll = setInterval(async () => {
      try {
        const st = await invoke<HifiStatus>('hifi_status');
        useHifi.setState({ format: st.format ?? '', ...(st.error && { error: st.error }) });
        if (engine.remoteIs(output)) engine.remoteUpdate(st);
      } catch {
        /* next time */
      }
    }, 500);
  } else {
    await invoke('hifi_command', { cmd: 'stop', value: null }).catch(() => undefined);
    useHifi.setState({ format: '' });
  }
  if (casting) return;
  engine.setRemote(localOutput());
  if (usePlayer.getState().current()) reloadCurrent(position, playing);
}

export async function startHifi() {
  if (!isTauri) return;
  const available = await invoke<boolean>('hifi_available').catch(() => false);
  useHifi.setState({ available });
  if (!available) return;
  void apply();
  useHifi.subscribe((s, prev) => s.on !== prev.on && void apply());
  useHub.subscribe((h, prev) => (h.features !== prev.features || h.token !== prev.token) && void apply());
}
