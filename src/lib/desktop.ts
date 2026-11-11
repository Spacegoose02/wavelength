/**
 * Desktop extras (src-tauri/src/desktop.rs): the tray icon, Ctrl+Alt+Space / → / ← hotkeys that work from any
 * app, the mini player window, and closing to the tray. Rust sends a `remote` event to this (the main) window,
 * which plays, pauses and skips; this window tells the mini player what's playing with `mini-state` events.
 */
import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';
import { usePlayer } from '../store/player';
import { useSettings } from '../store/settings';
import { trackArt } from './artwork';
import { isTauri } from './http';
import type { MiniState, RemoteAction } from './miniState';
import { isMobileApp } from './platform';

export const canDesktop = isTauri && !isMobileApp;

/** The last problem turning the hotkeys on (another app has them), for Settings. */
export let hotkeyProblem = '';

export const toggleMiniPlayer = () => (canDesktop ? invoke('mini_toggle').catch(() => undefined) : Promise.resolve());

function act(what: RemoteAction) {
  const p = usePlayer.getState();
  if (what === 'toggle') p.toggle();
  else if (what === 'next') p.next();
  else if (what === 'prev') p.prev();
}

function miniState(): MiniState {
  const p = usePlayer.getState();
  const t = p.queue[p.index];
  return { title: t?.title, artist: t?.artist, cover: trackArt(t), playing: p.playing, position: p.position, duration: p.duration };
}

let started = false;

export function startDesktop() {
  if (!canDesktop || started) return;
  started = true;
  void listen<RemoteAction>('remote', (e) => act(e.payload));
  // the mini player asks once it's open, then gets every change (the clock at most once a second)
  const send = () => void emitTo('mini', 'mini-state', miniState()).catch(() => undefined);
  void listen('mini-hello', send);
  let lastClock = 0;
  usePlayer.subscribe((s, prev) => {
    const changed = s.queue[s.index] !== prev.queue[prev.index] || s.playing !== prev.playing || s.duration !== prev.duration;
    if (changed || Math.abs(s.position - lastClock) >= 1) {
      lastClock = s.position;
      send();
    }
  });

  const apply = () => {
    const d = useSettings.getState().desktop;
    void invoke('tray_close_to', { on: d.closeToTray }).catch(() => undefined);
    invoke('hotkeys_set', { on: d.hotkeys })
      .then(() => (hotkeyProblem = ''))
      .catch((e) => (hotkeyProblem = `Couldn't turn the hotkeys on: ${String(e)}. Another app may be using them.`));
  };
  apply();
  useSettings.subscribe((s, prev) => s.desktop !== prev.desktop && apply());
}
