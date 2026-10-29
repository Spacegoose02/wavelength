import { useEffect, useRef, useState } from 'react';
import { joinParty, leaveParty, setRules, startParty, useTogether } from '../lib/together';
import { hubClient, useHub } from '../store/hub';
import { IconParty } from './Icons';

type PartyList = Awaited<ReturnType<NonNullable<ReturnType<typeof hubClient>>['parties']>>['parties'];

/** Listen together (lib/together.ts): start or join a party, and see who's in it and what's coming up. */
function PartyPanel() {
  const party = useTogether((s) => s.party);
  const note = useTogether((s) => s.note);
  const [list, setList] = useState<PartyList>();
  const [form, setForm] = useState({ name: '', guestsAdd: true, guestsControl: false });
  const [err, setErr] = useState('');
  const run = (f: () => Promise<unknown>) => f().then(() => setErr(''), (e) => setErr(String((e as Error).message ?? e)));

  useEffect(() => {
    if (party) return;
    const load = () => hubClient()?.parties().then((r) => setList(r.parties), () => {});
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [party]);

  if (!party) {
    return (
      <div className="devices">
        <h3>Listen together</h3>
        <p className="muted small">Everyone in a party hears the same song at the same moment, on their own device. Anyone signed in to your Hub can join.</p>
        {note && <p className="small ok">{note}</p>}
        {err && <div className="errors">{err}</div>}
        {list?.filter((p) => !p.joined).map((p) => (
          <div key={p.id} className="device-row">
            <div className="row gap" style={{ alignItems: 'center' }}>
              <div className="track-main"><div className="track-title">{p.name}</div><div className="track-sub">{p.host} · {p.members} listening</div></div>
              <button className="btn small primary" onClick={() => run(() => joinParty(p.id))}>Join</button>
            </div>
          </div>
        ))}
        <form className="device-row" onSubmit={(e) => { e.preventDefault(); void run(() => startParty({ ...form, name: form.name || undefined })); }}>
          <b>Start a party</b>
          <input placeholder={`${useHub.getState().user?.displayName ?? 'My'}'s party`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Party name" />
          <label className="check"><input type="checkbox" checked={form.guestsAdd} onChange={(e) => setForm({ ...form, guestsAdd: e.target.checked })} /> Guests can add songs</label>
          <label className="check"><input type="checkbox" checked={form.guestsControl} onChange={(e) => setForm({ ...form, guestsControl: e.target.checked })} /> Guests can skip and pause</label>
          <div><button className="btn small primary">Start</button></div>
        </form>
      </div>
    );
  }

  const s = party.state;
  const now = s.index >= 0 ? s.queue[s.index] : undefined;
  const upNext = s.queue.slice(s.index + 1, s.index + 6);
  return (
    <div className="devices">
      <h3>{party.name}</h3>
      <p className="muted small">
        {party.isHost
          ? 'You’re the host: everyone hears what you play. Others join from their Party button.'
          : `${party.host} is choosing the music${party.guestsAdd ? '. “+ Queue” and “Next” on any song send it to the party' : ''}.`}
      </p>
      {note && <p className="small ok">{note}</p>}
      {err && <div className="errors">{err}</div>}
      <div className="device-row">
        <span className="muted small">Now playing</span>
        <b>{now ? `${now.title} · ${now.artist}` : 'Nothing yet'}{now && !s.playing ? ' (paused)' : ''}</b>
        {upNext.length > 0 && <span className="small muted">Up next: {upNext.map((t) => t.title).join(', ')}</span>}
      </div>
      <div className="device-row">
        <span className="muted small">Listening ({party.members.length})</span>
        <span className="small">{party.members.map((m) => `${m.name}${m.host ? ' (host)' : ''} on ${m.device}`).join(', ')}</span>
      </div>
      {party.isHost && (
        <div className="device-row">
          <label className="check"><input type="checkbox" checked={party.guestsAdd} onChange={(e) => run(() => setRules({ guestsAdd: e.target.checked }))} /> Guests can add songs</label>
          <label className="check"><input type="checkbox" checked={party.guestsControl} onChange={(e) => run(() => setRules({ guestsControl: e.target.checked }))} /> Guests can skip and pause</label>
        </div>
      )}
      <div className="row gap" style={{ marginTop: 8 }}>
        <button className="btn small ghost" onClick={() => (!party.isHost || confirm('End the party for everyone?')) && void leaveParty()}>{party.isHost ? 'End party' : 'Leave'}</button>
      </div>
    </div>
  );
}

export function TogetherButton({ className = 'tbtn small' }: { className?: string }) {
  const signedIn = useHub((s) => !!s.token);
  const inParty = useTogether((s) => !!s.party);
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
      <button className={`${className} ${open || inParty ? 'on' : ''}`} onClick={() => setOpen(!open)} title="Listen together" aria-label="Listen together"><IconParty /></button>
      {open && (
        <div className="eq-pop devices-pop" role="dialog" aria-label="Listen together">
          <PartyPanel />
        </div>
      )}
    </div>
  );
}
