import { useEffect, useRef, useState } from 'react';
import { deemixClient } from '../lib/hubServices';
import { mustRequest, requestMusic } from '../lib/inbox';
import { albumRating, flagOn, setFlag, useFlags, useRatings } from '../lib/kids';
import type { HubFlag } from '../sources/hub';
import { useHub } from '../store/hub';
import { useSettings } from '../store/settings';

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

/**
 * "Get clean version": shown on an explicit album when the library check found its clean version on Deezer.
 * Downloads it with deemix, or requests it for people without Autodownload.
 */
export function CleanVersionButton({ artist, album }: { artist: string; album: string }) {
  const can = useHub((s) => !!s.token && (s.permissions.includes('downloads.run') || s.permissions.includes('requests.create')));
  useRatings((s) => s.ratings);
  const [status, setStatus] = useState<string>();
  const link = albumRating(artist, album)?.cleanLink;
  if (!can || !link) return null;
  const request = mustRequest();
  const get = async () => {
    setStatus('…');
    try {
      if (request) await requestMusic({ link, kind: 'album', title: `${album} (clean)`, artist });
      else await deemixClient().addToQueue(link, useSettings.getState().deemix.bitrate);
      setStatus(request ? 'Clean version requested' : 'Clean version queued');
    } catch (e) {
      setStatus(String((e as Error).message ?? e));
    }
  };
  return (
    <button className="btn" disabled={status === '…'} onClick={get} title="Deezer has a clean version of this album">
      {status ?? (request ? 'Request clean version' : 'Get clean version')}
    </button>
  );
}
