import { useEffect, useRef, useState } from 'react';
import { getClean, offerStatus, useCleanVersions, type CleanOffer } from '../lib/cleanVersions';
import { mustRequest } from '../lib/inbox';
import { albumRating, flagOn, setFlag, useFlags, useRatings } from '../lib/kids';
import type { FlagVersion, HubFlag } from '../sources/hub';
import { useHub } from '../store/hub';

/**
 * Admin button: hide a song, album or artist from kid profiles, or let something marked explicit through.
 * Only shown to Hub admins (`library.edit`); the Hub refuses the change from anyone else. A song or album is
 * flagged for the version on screen (`version`, from lib/kids.ts `trackVersion` / `albumVersion`), so marking
 * the clean version doesn't touch the explicit one; "Hide every version" covers both.
 */
export function KidFlagButton({ kind, artist, title = '', version = '', explicit, className = 'btn' }: { kind: HubFlag['kind']; artist: string; title?: string; version?: '' | 'clean'; explicit?: boolean; className?: string }) {
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

  const mine = kind === 'artist' ? 'any' : version;
  const own = flagOn(kind, artist, title, mine);
  const every = kind === 'artist' ? undefined : flagOn(kind, artist, title, 'any');
  const flag = own ?? every;
  const state = flag ? (flag.verdict === 'block' ? 'Hidden from kids' : 'OK for kids') : explicit ? 'Explicit: hidden from kids' : 'Kids: shown';
  const pick = async (v: HubFlag['verdict'] | null, which: FlagVersion = mine) => {
    setOpen(false);
    setBusy(true);
    try {
      await setFlag(kind, artist, title, which, v);
    } catch (e) {
      alert(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };
  const what = kind === 'track' ? 'song' : kind;
  const which = kind === 'artist' ? '' : version === 'clean' ? ' (clean version)' : '';

  return (
    <div className={`menu-wrap ${open ? 'open' : ''}`} ref={ref} onDoubleClick={(e) => e.stopPropagation()}>
      <button className={`${className} ${flag?.verdict === 'block' || (!flag && explicit) ? 'kid-blocked' : ''}`} disabled={busy}
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }} title="Who can see this on kid profiles">
        {busy ? '…' : state}
      </button>
      {open && (
        <div className="menu" onClick={(e) => e.stopPropagation()}>
          <button className="menu-item" onClick={() => pick('block')}>Hide this {what}{which} from kids</button>
          {kind !== 'artist' && <button className="menu-item" onClick={() => pick('block', 'any')}>Hide every version of this {what} from kids</button>}
          <button className="menu-item" onClick={() => pick('allow')}>OK for kids{which}{explicit ? ' (even though explicit)' : ''}</button>
          {own && <button className="menu-item" onClick={() => pick(null)}>Clear{explicit ? ' (explicit: hidden)' : ''}</button>}
          {every && <button className="menu-item" onClick={() => pick(null, 'any')}>Clear “every version”</button>}
          <div className="menu-hint">Applies on every kid profile on your Hub{kind === 'artist' ? '' : ', to this version only unless it says every version'}.</div>
        </div>
      )}
    </div>
  );
}

/**
 * "Get clean version": shown on an explicit album when the library check found its clean version on Deezer.
 * Downloads it with deemix (into its own folder when the Hub runs deemix), or requests it for people without
 * Autodownload. Same as Inbox → Clean versions (lib/cleanVersions.ts).
 */
export function CleanVersionButton({ artist, album }: { artist: string; album: string }) {
  const can = useHub((s) => !!s.token && (s.permissions.includes('downloads.run') || s.permissions.includes('requests.create')));
  useRatings((s) => s.ratings);
  const state = useCleanVersions();
  const link = albumRating(artist, album)?.cleanLink;
  if (!can || !link) return null;
  const request = mustRequest();
  const offer: CleanOffer = { artist, album, link, have: false };
  const st = offerStatus(offer, state);
  return (
    <button className="btn" disabled={st.kind === 'busy'} onClick={() => getClean(offer)} title={st.kind === 'error' ? st.label : 'Deezer has a clean version of this album'}>
      {st.kind === 'new' ? (request ? 'Request clean version' : 'Get clean version') : st.kind === 'error' ? 'Clean version: failed, try again' : `Clean version: ${st.label}`}
    </button>
  );
}
