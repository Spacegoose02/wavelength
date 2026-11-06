import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';
import type { MiniState, RemoteAction } from '../lib/miniState';
import { IconNext, IconPause, IconPlay, IconPrev } from './Icons';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * The mini player window (src-tauri/src/desktop.rs opens it): cover, song, play/pause, next and previous, always
 * on top. It plays nothing itself: the main window does, and tells it what's playing (lib/desktop.ts).
 * Kept free of the app's stores so the window stays light.
 */
export function MiniPlayer() {
  const [s, setS] = useState<MiniState>({ playing: false, position: 0, duration: 0 });
  useEffect(() => {
    const off = listen<MiniState>('mini-state', (e) => setS(e.payload));
    void off.then(() => emitTo('main', 'mini-hello'));
    return () => void off.then((f) => f());
  }, []);
  const send = (what: RemoteAction) => () => void emitTo('main', 'remote', what);
  const pct = s.duration ? Math.min(100, (s.position / s.duration) * 100) : 0;
  return (
    <div className="mini-player" data-tauri-drag-region>
      {s.cover ? <img className="mini-cover" src={s.cover} alt="" data-tauri-drag-region /> : <div className="mini-cover" data-tauri-drag-region />}
      <div className="mini-main" data-tauri-drag-region>
        <button type="button" className="mini-title" title="Show Wavelength" onClick={() => void invoke('main_show')}>
          {s.title ?? 'Nothing playing'}
        </button>
        <div className="mini-sub" data-tauri-drag-region>{s.artist ?? ''}</div>
        <div className="mini-row">
          <button type="button" className="tbtn small" onClick={send('prev')} aria-label="Previous"><IconPrev /></button>
          <button type="button" className="tbtn play small" onClick={send('toggle')} aria-label={s.playing ? 'Pause' : 'Play'}>{s.playing ? <IconPause /> : <IconPlay />}</button>
          <button type="button" className="tbtn small" onClick={send('next')} aria-label="Next"><IconNext /></button>
          {s.duration > 0 && <span className="mini-time">{clock(s.position)} / {clock(s.duration)}</span>}
        </div>
        <div className="mini-bar"><div style={{ width: `${pct}%` }} /></div>
      </div>
    </div>
  );
}
