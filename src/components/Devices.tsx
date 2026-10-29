import { useEffect, useRef, useState } from 'react';
import { engine } from '../player/engine';
import { fromHub, forHub } from '../lib/librarySync';
import { sendState } from '../lib/remote';
import type { HubRemoteCommand, HubRemoteDevice } from '../sources/hub';
import { hubClient, useHub } from '../store/hub';
import { usePlayer } from '../store/player';
import { useSettings } from '../store/settings';
import { Cover, fmtTime } from './common';
import { IconCast, IconNext, IconPause, IconPlay, IconPrev } from './Icons';

/**
 * Devices: your other signed-in devices, what each is playing, and controls for them (lib/remote.ts,
 * hub/src/routes/remote.ts). "Play here" brings what a device is playing to this one; "Continue there" moves
 * what's playing here to that device.
 */
function DeviceList({ onDone }: { onDone(): void }) {
  const c = hubClient()!;
  const [devices, setDevices] = useState<HubRemoteDevice[]>();
  const [err, setErr] = useState('');
  const here = usePlayer((s) => s.current());
  const allowed = useSettings((s) => s.remoteControl);

  const load = () => c.remoteDevices().then((r) => { setDevices(r.devices); setErr(''); }, (e) => setErr(String((e as Error).message ?? e)));
  useEffect(() => {
    void sendState(true).then(load);
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const send = (d: HubRemoteDevice, cmd: Omit<HubRemoteCommand, 'id' | 'from' | 'at'>) =>
    c.remoteCommand(d.id, cmd).then(() => setTimeout(load, 1500), (e) => setErr(String((e as Error).message ?? e)));

  const continueThere = async (d: HubRemoteDevice) => {
    const { queue, index, position } = usePlayer.getState();
    if (!queue.length) return;
    const from = Math.max(0, index - 50);
    await send(d, { action: 'load', queue: queue.slice(from, from + 300).map(forHub), index: index - from, position });
    engine.pause();
    onDone();
  };
  const playHere = async (d: HubRemoteDevice) => {
    const s = d.state;
    if (!s?.queue.length) return;
    usePlayer.getState().playTracks(s.queue.map(fromHub), Math.max(0, s.index), s.position);
    if (s.playing) await send(d, { action: 'pause' });
    onDone();
  };

  const others = (devices ?? []).filter((d) => !d.current);
  return (
    <div className="devices">
      <h3>Your devices</h3>
      {err && <div className="errors">{err}</div>}
      {!devices ? <p className="muted small">Looking…</p> : !others.length ? (
        <p className="muted small">None of your other devices are open right now. Open Wavelength on them, signed in as you, and they show up here.</p>
      ) : others.map((d) => {
        const s = d.state, t = s && s.index >= 0 ? s.queue[s.index] : undefined;
        return (
          <div key={d.id} className="device-row">
            <div className="device-name"><b>{d.name}</b> <span className="muted small">{d.platform}{!d.listening ? ' · can’t be controlled right now' : ''}</span></div>
            <div className="device-now">
              <Cover src={t ? fromHub(t).coverUrl : undefined} alt={t?.title ?? d.name} className="tiny" />
              <div className="track-main">
                <div className="track-title">{t ? t.title : 'Nothing playing'}</div>
                <div className="track-sub">{t ? `${t.artist}${s?.duration ? ` · ${fmtTime(s.position)} / ${fmtTime(s.duration)}` : ''}${s?.playing ? '' : ' · paused'}` : ' '}</div>
              </div>
            </div>
            {d.listening && (
              <div className="row gap wrap">
                {t && <>
                  <button className="tbtn small" title="Previous" onClick={() => send(d, { action: 'prev' })}><IconPrev /></button>
                  <button className="tbtn small" title={s?.playing ? 'Pause' : 'Play'} onClick={() => send(d, { action: 'toggle' })}>{s?.playing ? <IconPause /> : <IconPlay />}</button>
                  <button className="tbtn small" title="Next" onClick={() => send(d, { action: 'next' })}><IconNext /></button>
                  <RemoteVolume name={d.name} start={s?.volume ?? 1} onChange={(value) => send(d, { action: 'volume', value })} />
                </>}
                {t && <button className="btn small" onClick={() => playHere(d)}>Play here</button>}
                {here && <button className="btn small primary" onClick={() => continueThere(d)}>Continue there</button>}
              </div>
            )}
          </div>
        );
      })}
      {!allowed && <p className="muted small">This device is hidden from your others (Settings → Account).</p>}
    </div>
  );
}

function RemoteVolume({ name, start, onChange }: { name: string; start: number; onChange(v: number): void }) {
  const [v, setV] = useState(start);
  return (
    <input className="vol" type="range" min={0} max={1} step={0.05} value={v} aria-label={`Volume on ${name}`} style={{ ['--pct' as string]: `${v * 100}%` }}
      onChange={(e) => {
        setV(Number(e.target.value));
        onChange(Number(e.target.value));
      }} />
  );
}

export function DevicesButton({ className = 'tbtn small' }: { className?: string }) {
  const signedIn = useHub((s) => !!s.token);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', click);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', click);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  if (!signedIn) return null;
  return (
    <div className="eq-anchor" ref={ref}>
      <button className={`${className} ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} title="Devices" aria-label="Devices"><IconCast /></button>
      {open && (
        <div className="eq-pop devices-pop" role="dialog" aria-label="Devices">
          <DeviceList onDone={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
