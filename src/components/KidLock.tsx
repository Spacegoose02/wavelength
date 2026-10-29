import { useState, type FormEvent } from 'react';
import { checkPin, unlockKidTime, useKidTime } from '../lib/kidTime';
import { useIsKid } from '../lib/kids';
import { useHub } from '../store/hub';

/** Ask for the grown-up PIN. `check` throws with the Hub's message when the PIN is wrong. */
export function PinDialog({ title, note, check, onDone, onCancel }: { title: string; note?: string; check(pin: string): Promise<void>; onDone(): void; onCancel(): void }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await check(pin);
      onDone();
    } catch (x) {
      setErr(String((x as Error).message ?? x));
      setPin('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="pin-backdrop" onClick={onCancel}>
      <form className="pin-dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>{title}</h3>
        {note && <p className="muted small">{note}</p>}
        <input autoFocus type="password" inputMode="numeric" autoComplete="off" maxLength={8} placeholder="PIN"
          value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
        {err && <div className="card-err small">{err}</div>}
        <div className="row gap">
          <button className="btn primary" disabled={busy || pin.length < 4}>{busy ? '…' : 'OK'}</button>
          <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

/** Covers the app at bedtime or when today's listening time is used up, until a grown-up types the PIN. */
export function KidLockScreen() {
  const lock = useKidTime((s) => s.lock);
  const rules = useKidTime((s) => s.rules);
  const pinSet = useKidTime((s) => s.pinSet);
  const name = useHub((s) => s.user?.displayName);
  const [asking, setAsking] = useState(false);
  if (!lock) return null;
  return (
    <div className="kid-lock">
      <div className="kid-lock-moon" aria-hidden />
      <h1>{lock === 'bedtime' ? `Time for bed, ${name}` : `That's all the music for today, ${name}`}</h1>
      <p className="muted">
        {lock === 'bedtime'
          ? `Music is back at ${rules?.bedtimeTo ?? 'wake-up time'}.`
          : `You listened for ${rules?.dailyMinutes ?? ''} minutes today. More tomorrow!`}
      </p>
      {pinSet && <button className="btn" onClick={() => setAsking(true)}>A grown-up can unlock</button>}
      {asking && (
        <PinDialog title="Grown-up PIN" note="Unlocks 30 more minutes." check={unlockKidTime} onDone={() => setAsking(false)} onCancel={() => setAsking(false)} />
      )}
    </div>
  );
}

/** Kid profiles: Settings is replaced by this. Signing out (to switch profile) needs the grown-up PIN. */
export function KidSettings() {
  const isKid = useIsKid();
  const name = useHub((s) => s.user?.displayName);
  const used = useKidTime((s) => s.used);
  const rules = useKidTime((s) => s.rules);
  const pinSet = useKidTime((s) => s.pinSet);
  const [asking, setAsking] = useState(false);
  if (!isKid) return null;
  return (
    <div className="page">
      <header className="page-head"><h1>Hi {name}</h1></header>
      <section className="kid-panel">
        <p>You've listened for <b>{Math.round(used / 60)} minutes</b> today{rules?.dailyMinutes ? ` out of ${rules.dailyMinutes}` : ''}.</p>
        {rules?.bedtimeFrom && <p>Bedtime is <b>{rules.bedtimeFrom}</b> to <b>{rules.bedtimeTo}</b>.</p>}
      </section>
      <section>
        <h2>Switch profile</h2>
        <p className="muted small">{pinSet ? 'A grown-up types the PIN to sign out of this kid profile.' : 'Ask a grown-up to set a PIN under Settings → Users before this profile can be signed out.'}</p>
        <button className="btn" disabled={!pinSet} onClick={() => setAsking(true)}>Sign out</button>
      </section>
      {asking && (
        <PinDialog title="Grown-up PIN" note={`Signs ${name} out of this device.`} check={checkPin}
          onDone={() => {
            setAsking(false);
            useHub.getState().signOut();
          }}
          onCancel={() => setAsking(false)} />
      )}
    </div>
  );
}
