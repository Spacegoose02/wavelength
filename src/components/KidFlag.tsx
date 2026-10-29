import { useEffect, useRef, useState } from 'react';
import { flagOn, setFlag, useFlags } from '../lib/kids';
import type { HubFlag } from '../sources/hub';
import { useHub } from '../store/hub';

/**
 * Admin button: hide a song, album or artist from kid profiles, or let something marked explicit through.
 * Only shown to Hub admins (`library.edit`); the Hub refuses the change from anyone else.
 */
export function KidFlagButton({ kind, artist, title = '', explicit, className = 'btn' }: { kind: HubFlag['kind']; artist: string; title?: string; explicit?: boolean; className?: string }) {
  const can = useHub((s) => !!s.token && s.permissions.includes('library.edit'));
  useFlags((s) => s.flags);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  if (!can || !artist) return null;

  const flag = flagOn(kind, artist, title);
  const state = flag ? (flag.verdict === 'block' ? 'Hidden from kids' : 'OK for kids') : explicit ? 'Explicit: hidden from kids' : 'Kids: shown';
  const pick = async (v: HubFlag['verdict'] | null) => {
    setOpen(false);
    setBusy(true);
    try {
      await setFlag(kind, artist, title, v);
    } catch (e) {
      alert(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };
  const what = kind === 'track' ? 'song' : kind;

  return (
    <div className={`menu-wrap ${open ? 'open' : ''}`} ref={ref} onDoubleClick={(e) => e.stopPropagation()}>
      <button className={`${className} ${flag?.verdict === 'block' || (!flag && explicit) ? 'kid-blocked' : ''}`} disabled={busy}
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }} title="Who can see this on kid profiles">
        {busy ? '…' : state}
      </button>
      {open && (
        <div className="menu" onClick={(e) => e.stopPropagation()}>
          <button className="menu-item" onClick={() => pick('block')}>Hide this {what} from kids</button>
          <button className="menu-item" onClick={() => pick('allow')}>OK for kids{explicit ? ' (even though explicit)' : ''}</button>
          {flag && <button className="menu-item" onClick={() => pick(null)}>Clear{explicit ? ' (explicit: hidden)' : ''}</button>}
          <div className="menu-hint">Applies on every kid profile on your Hub.</div>
        </div>
      )}
    </div>
  );
}
