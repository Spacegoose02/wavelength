import { useEffect, useRef, useState } from 'react';
import { canCast, discover, startCasting, stopCasting, useCast } from '../lib/cast';
import { useFeature } from '../lib/features';
import { IconSpeaker } from './Icons';

/** Cast to a speaker on this network: Chromecast, Google/Nest speakers, DLNA/UPnP renderers (lib/cast.ts). */
export function CastButton({ className = 'tbtn small' }: { className?: string }) {
  const on = useFeature('cast');
  const { targets, searching, active, error } = useCast();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    if (!targets.length) void discover();
    const click = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', click);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', click);
      document.removeEventListener('keydown', key);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!canCast || (!on && !active)) return null;
  const label = active ? `Casting to ${active.name}` : 'Cast to a speaker';
  return (
    <div className="eq-anchor" ref={ref}>
      <button className={`${className} ${open || active ? 'on' : ''}`} onClick={() => setOpen(!open)} title={label} aria-label={label}><IconSpeaker /></button>
      {open && (
        <div className="eq-pop devices-pop" role="dialog" aria-label="Cast">
          <div className="devices">
            <h3>Play on a speaker</h3>
            {error && <div className="errors">{error}</div>}
            {active && (
              <div className="device-row">
                <div className="device-name"><b>{active.name}</b> <span className="muted small">playing here now</span></div>
                <button className="btn small primary" onClick={() => { void stopCasting(); setOpen(false); }}>Play on this device instead</button>
              </div>
            )}
            {targets.filter((t) => t.id !== active?.id).map((t) => (
              <div key={t.id} className="device-row">
                <div className="device-name"><b>{t.name}</b> <span className="muted small">{t.kind === 'chromecast' ? 'Chromecast' : 'DLNA speaker'}</span></div>
                <button className="btn small" onClick={() => { void startCasting(t); setOpen(false); }}>Play here</button>
              </div>
            ))}
            {searching ? <p className="muted small">Looking for speakers…</p> : !targets.length && (
              <p className="muted small">No speakers found. They need to be on the same Wi-Fi as this device.</p>
            )}
            <button className="btn small" disabled={searching} onClick={() => void discover()}>Look again</button>
            <p className="muted small">Songs you downloaded play from the server while casting, since the speaker can’t reach this device’s files.</p>
          </div>
        </div>
      )}
    </div>
  );
}
