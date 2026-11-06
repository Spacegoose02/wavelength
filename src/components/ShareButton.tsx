import { useEffect, useRef, useState } from 'react';
import { useCanShare, type ShareWhat } from '../lib/inbox';
import type { HubPerson } from '../sources/hub';
import { useFeature } from '../lib/features';
import { useIsKid } from '../lib/kids';
import { hubClient } from '../store/hub';
import { IconShare } from './Icons';

/**
 * "Share" button: send a playlist, album, song, artist, station or favorites list to someone on the Hub
 * (or everyone). Hidden when not signed in to a Hub.
 */
export function ShareButton({ what, label = 'Share', className = 'btn' }: { what: ShareWhat | (() => ShareWhat); label?: string; className?: string }) {
  const can = useCanShare();
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<HubPerson[]>();
  const [note, setNote] = useState('');
  const [flash, setFlash] = useState<string>();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    hubClient()?.people().then((r) => setPeople(r.people)).catch(() => setPeople([]));
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const publicShares = useFeature('publicShares');
  const kid = useIsKid();
  const publicOn = publicShares && !kid;
  if (!can) return null;

  /** A link anyone can open in a browser (hub/src/publicLinks.ts), copied to the clipboard. */
  const makePublic = async (days?: number) => {
    setOpen(false);
    setFlash('Making a link…');
    try {
      const w = typeof what === 'function' ? what() : what;
      const { url } = await hubClient()!.makePublicLink({ ...w, note: note.trim() || undefined, days });
      setNote('');
      try {
        await navigator.clipboard.writeText(url);
        setFlash('Link copied');
      } catch {
        window.prompt('Your link', url);
        setFlash(undefined);
      }
    } catch (e) {
      setFlash(`Failed: ${(e as Error).message ?? e}`);
    }
    window.setTimeout(() => setFlash(undefined), 2800);
  };
  const kindOf = () => (typeof what === 'function' ? what() : what).kind;

  const send = async (to: HubPerson | null) => {
    setOpen(false);
    setFlash('Sharing…');
    try {
      const w = typeof what === 'function' ? what() : what;
      await hubClient()!.share({ ...w, to: to?.id ?? null, note: note.trim() || undefined });
      setNote('');
      setFlash(`Shared with ${to ? to.displayName : 'everyone'}`);
    } catch (e) {
      setFlash(`Failed: ${(e as Error).message ?? e}`);
    }
    window.setTimeout(() => setFlash(undefined), 2800);
  };

  return (
    <div className={`menu-wrap ${open ? 'open' : ''}`} ref={ref} onDoubleClick={(e) => e.stopPropagation()}>
      <button className={className} onClick={(e) => { e.stopPropagation(); setOpen(!open); }} title="Share with someone on your Hub">
        <IconShare /> {flash ?? label}
      </button>
      {open && (
        <div className="menu" onClick={(e) => e.stopPropagation()}>
          <input placeholder="Add a note (optional)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          <button className="menu-item" onClick={() => send(null)}>Everyone</button>
          {people && people.length > 0 && <div className="menu-group">Just one person</div>}
          {people?.map((p) => (
            <button key={p.id} className="menu-item" onClick={() => send(p)}>
              {p.displayName} {p.kid && <small>kid</small>}
            </button>
          ))}
          {!people && <div className="menu-hint">Loading…</div>}
          {publicOn && ['playlist', 'album', 'track', 'artist'].includes(kindOf()) && <>
            <div className="menu-group">Anyone with the link</div>
            <button className="menu-item" onClick={() => makePublic(7)}>Copy a link for a week</button>
            <button className="menu-item" onClick={() => makePublic()}>Copy a link that lasts</button>
          </>}
        </div>
      )}
    </div>
  );
}
