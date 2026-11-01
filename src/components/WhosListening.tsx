import { useEffect, useState } from 'react';
import { checkPin, useKidTime } from '../lib/kidTime';
import type { HubFamilyPerson } from '../sources/hub';
import { hubClient, profilePinHash, thisDevice, useHub, type SavedProfile } from '../store/hub';
import { PinDialog } from './KidLock';

/**
 * "Who's listening?" (docs/USER-GUIDE.md "Switching profiles"): everyone in your family on the Hub, plus anyone
 * else signed in on this device, a tap away. Someone already on this device switches at once (with their PIN on
 * this device, if they set one). Someone in your family who isn't signs in here through the Hub with their
 * switching PIN (POST /api/me/switch), no pairing needed. A grown-up can switch to a kid without one; leaving a
 * kid profile always takes a PIN.
 */

interface Person {
  id: number;
  displayName: string;
  role: string;
  /** Signed in on this device already. */
  saved?: SavedProfile;
  /** In the family on the Hub, with a switching PIN. */
  hubPin?: boolean;
}

/** The family's people from the Hub, refreshed when the profile changes. */
function useFamily() {
  const userId = useHub((s) => s.user?.id);
  const token = useHub((s) => s.token);
  const [people, setPeople] = useState<HubFamilyPerson[]>([]);
  useEffect(() => {
    setPeople([]);
    hubClient()?.myFamily().then((r) => setPeople(r.people ?? []), () => undefined);
  }, [userId, token]);
  return people;
}

export function useSwitchablePeople(): Person[] {
  const { user, profiles } = useHub();
  const family = useFamily();
  if (!user) return [];
  const byId = new Map<number, Person>();
  for (const p of profiles) byId.set(p.user.id, { id: p.user.id, displayName: p.user.displayName, role: p.user.role, saved: p });
  for (const f of family) {
    if (f.id === user.id) continue;
    const had = byId.get(f.id);
    byId.set(f.id, { ...had, id: f.id, displayName: f.displayName, role: f.role, hubPin: f.hasSwitchPin });
  }
  return [...byId.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** The sidebar's (and the phone's Library page's) button: who's listening now, and a tap to switch. */
export function ProfileButton({ compact }: { compact?: boolean }) {
  const user = useHub((s) => s.user);
  const people = useSwitchablePeople();
  const [open, setOpen] = useState(false);
  if (!user || !people.length) return null;
  return (
    <>
      <button className={`profile-button ${compact ? 'compact' : ''}`} title="Who's listening? Switch profile" onClick={() => setOpen(true)}>
        <span className="hub-avatar">{user.displayName.slice(0, 1).toUpperCase()}</span>
        {!compact && <span className="profile-button-name">{user.displayName}</span>}
      </button>
      {open && <WhosListening onClose={() => setOpen(false)} />}
    </>
  );
}

export function WhosListening({ onClose }: { onClose(): void }) {
  const { user, switchProfile, addProfile } = useHub();
  const people = useSwitchablePeople();
  const pinSet = useKidTime((s) => s.pinSet);
  const [asking, setAsking] = useState<{ to: Person; step: 'grown-up' | 'device' | 'hub' }>();
  const [err, setErr] = useState('');
  if (!user) return null;
  const kid = user.role === 'kid';

  /** Through the Hub: someone in the family who isn't signed in on this device yet. */
  const viaHub = async (to: Person, pin?: string) => {
    const s = await hubClient()!.switchTo(to.id, pin, thisDevice());
    addProfile(s);
    onClose();
  };

  const pick = async (to: Person, from: 'start' | 'grown-up' = 'start') => {
    setErr('');
    if (to.saved) {
      if (from === 'start' && kid) return setAsking({ to, step: 'grown-up' });
      if (to.saved.pin) return setAsking({ to, step: 'device' });
      switchProfile(to.id);
      return onClose();
    }
    // a kid always needs the other person's PIN; a grown-up needs it unless switching to a kid without one
    if (to.hubPin || kid) return setAsking({ to, step: 'hub' });
    try {
      await viaHub(to);
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    }
  };

  const reachable = (p: Person) => !!p.saved || p.hubPin || (p.role === 'kid' && !kid);

  return (
    <div className="pin-backdrop" onClick={onClose}>
      <div className="pin-dialog whos-listening" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Who's listening?">
        <h3>Who's listening?</h3>
        <div className="whos-listening-grid">
          <button className="whos-listening-person on" onClick={onClose}>
            <span className="hub-avatar">{user.displayName.slice(0, 1).toUpperCase()}</span>
            <span>{user.displayName}</span><small className="muted">now</small>
          </button>
          {people.map((p) => (
            <button key={p.id} className="whos-listening-person" disabled={!reachable(p) || (kid && !!p.saved && !pinSet)}
              title={reachable(p) ? '' : `${p.displayName} hasn't set a switching PIN yet (Settings → Account)`}
              onClick={() => pick(p)}>
              <span className="hub-avatar">{p.displayName.slice(0, 1).toUpperCase()}</span>
              <span>{p.displayName}</span>
              <small className="muted">{(p.saved?.pin || p.hubPin) ? '🔒' : ''}{p.role === 'kid' ? ' kid' : ''}{!reachable(p) ? ' no PIN yet' : ''}</small>
            </button>
          ))}
        </div>
        {err && <div className="card-err small">{err}</div>}
        <p className="muted small">Set the PIN your family switches to you with under Settings → Account.</p>
        <button className="btn ghost" onClick={onClose}>Close</button>
      </div>
      {asking?.step === 'grown-up' && (
        <PinDialog title="Grown-up PIN" note={`Switches to ${asking.to.displayName}.`} check={checkPin}
          onDone={() => pick(asking.to, 'grown-up')} onCancel={() => setAsking(undefined)} />
      )}
      {asking?.step === 'device' && (
        <PinDialog title={`${asking.to.displayName}'s PIN`}
          check={async (p) => {
            if ((await profilePinHash(asking.to.id, p)) !== asking.to.saved?.pin) throw new Error("That's not the PIN");
          }}
          onDone={() => { setAsking(undefined); switchProfile(asking.to.id); onClose(); }} onCancel={() => setAsking(undefined)} />
      )}
      {asking?.step === 'hub' && (
        <PinDialog title={`${asking.to.displayName}'s PIN`} note="Their switching PIN, checked by your Hub."
          check={(p) => viaHub(asking.to, p)} onDone={() => setAsking(undefined)} onCancel={() => setAsking(undefined)} />
      )}
    </div>
  );
}

/** Settings → Account: the PIN your family switches to you with (kept hashed on the Hub). */
export function SwitchPinSetting() {
  const user = useHub((s) => s.user);
  const refresh = useHub((s) => s.refresh);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState('');
  if (!user || !user.familyId) return null;
  const save = async (pin: string | null) => {
    try {
      await hubClient()!.setSwitchPin(pin);
      await refresh();
      setEditing(false);
      setDraft('');
      setErr('');
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    }
  };
  return (
    <div className="editor">
      <h3>Switching PIN</h3>
      <p className="muted small">
        People in your family can switch to your profile on a shared device (the button with your initial, top left) by typing
        this PIN, without signing in again. {user.role === 'kid' ? '' : 'Without one, nobody can switch to you.'}
      </p>
      {editing ? (
        <form className="row gap" onSubmit={(e) => { e.preventDefault(); save(draft); }}>
          <input type="password" inputMode="numeric" maxLength={8} placeholder="4 to 8 digits" value={draft} onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))} />
          <button className="btn small" disabled={draft.length < 4}>Save</button>
          <button type="button" className="btn small ghost" onClick={() => setEditing(false)}>Cancel</button>
        </form>
      ) : (
        <div className="row gap">
          <button className="btn small" onClick={() => setEditing(true)}>{user.hasSwitchPin ? 'Change my PIN' : 'Set a PIN'}</button>
          {user.hasSwitchPin && <button className="btn small ghost" onClick={() => save(null)}>Remove</button>}
        </div>
      )}
      {err && <div className="errors">{err}</div>}
    </div>
  );
}
