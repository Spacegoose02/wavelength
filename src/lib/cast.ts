/**
 * Casting: play to a Chromecast, Google/Nest speaker or a DLNA/UPnP renderer on the same network
 * (src-tauri/src/cast.rs does the talking). While casting, the engine hands every load/play/pause/seek/volume
 * to the speaker (engine.setRemote) and this file polls the speaker once a second, feeding its state back
 * so the player bar, queue and scrobbling carry on as normal. Desktop and Android app only.
 */
import { invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';
import { engine, type RemoteMeta, type RemoteOutput } from '../player/engine';
import { reloadCurrent, usePlayer } from '../store/player';
import { localOutput } from './hifi';
import { isTauri } from './http';

export interface CastTarget {
  kind: 'chromecast' | 'dlna';
  id: string;
  name: string;
  host?: string | null;
  port?: number | null;
  control?: string | null;
  rendering?: string | null;
}
interface CastStatus {
  state: string;
  position: number;
  duration: number;
  volume?: number | null;
}

interface CastState {
  targets: CastTarget[];
  searching: boolean;
  active?: CastTarget;
  connecting: boolean;
  error: string;
}
export const useCast = create<CastState>(() => ({ targets: [], searching: false, connecting: false, error: '' }));

export const canCast = isTauri;

const msg = (e: unknown) => String((e as Error)?.message ?? e);

export async function discover() {
  if (!canCast || useCast.getState().searching) return;
  useCast.setState({ searching: true, error: '' });
  window.WavelengthNative?.multicast?.(true);
  try {
    const targets = await invoke<CastTarget[]>('cast_discover', { seconds: 4 });
    useCast.setState({ targets });
  } catch (e) {
    useCast.setState({ error: msg(e) });
  } finally {
    window.WavelengthNative?.multicast?.(false);
    useCast.setState({ searching: false });
  }
}

let poll: ReturnType<typeof setInterval> | undefined;
let polling = false;

function output(target: CastTarget): RemoteOutput {
  const cmd = (cmd: string, value?: number) => invoke<void>('cast_command', { target, cmd, value: value ?? null });
  return {
    load: (url: string, startAt: number, meta: RemoteMeta) =>
      invoke<void>('cast_load', {
        target,
        url,
        meta: { title: meta.title, artist: meta.artist ?? null, album: meta.album ?? null, cover: meta.cover ?? null, contentType: null, duration: meta.duration ?? null },
        start: startAt,
      }).catch((e) => {
        useCast.setState({ error: msg(e) });
        engine.remoteUpdate({ state: 'error', position: 0, duration: 0 });
      }),
    play: () => cmd('play'),
    pause: () => cmd('pause'),
    seek: (t: number) => cmd('seek', t),
    setVolume: (v: number) => cmd('volume', v),
  };
}

/** Move what's playing to a speaker (or start sending the next song there). */
export async function startCasting(target: CastTarget) {
  if (useCast.getState().active) await stopCasting(false);
  const p = usePlayer.getState();
  const at = p.position, wasPlaying = p.playing;
  useCast.setState({ active: target, connecting: true, error: '' });
  // bit-perfect output (lib/hifi.ts) goes quiet while a speaker plays
  await localOutput()?.pause().catch(() => undefined);
  engine.setRemote(output(target));
  if (p.current()) reloadCurrent(at, wasPlaying);
  useCast.setState({ connecting: false });
  clearInterval(poll);
  poll = setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      const st = await invoke<CastStatus>('cast_status', { target });
      if (useCast.getState().active?.id === target.id) engine.remoteUpdate(st);
    } catch {
      /* speaker briefly unreachable: try again next tick */
    } finally {
      polling = false;
    }
  }, 1000);
}

/** Bring playback back to this device, carrying on where the speaker was. */
export async function stopCasting(resumeHere = true) {
  const target = useCast.getState().active;
  if (!target) return;
  clearInterval(poll);
  poll = undefined;
  const { position: at, playing: wasPlaying } = usePlayer.getState();
  useCast.setState({ active: undefined });
  engine.setRemote(localOutput());
  await invoke('cast_disconnect', { target }).catch(() => {});
  if (resumeHere && usePlayer.getState().current()) reloadCurrent(at, wasPlaying);
}
