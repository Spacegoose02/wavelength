import { useEffect, useState } from 'react';
import { checkPin, useKidTime } from '../lib/kidTime';
import type { HubFamilyPerson } from '../sources/hub';
import { hubClient, mustSetPinFirst, profilePinHash, sameFamily, thisDevice, useHub, type SavedProfile } from '../store/hub';
import { PinDialog } from './KidLock';

/**
 * "Who's listening?" (docs/USER-GUIDE.md "Switching profiles"): everyone in your family on the Hub, plus anyone
 * else signed in on this device, a tap away. Someone already on this device switches at once (with their PIN on
 * this device, if they set one). Someone in your family who isn't signs in here through the Hub with their
 * switching PIN (POST /api/me/switch), no pairing needed. A grown-up can switch to a kid without one, and a parent
 * to their own kids always (listed even in a Hub without families); leaving a kid profile always takes a PIN: the
 * grown-up PIN or one of the kid's parents' switching PINs. A parent with neither set is asked to set their PIN
 * before the first switch, so the device can't end up stuck in the kid's profile.
 */

interface Person {
  id: number;
  displayName: string;
  role: string;
  /** Signed in on this device already. */
  saved?: SavedProfile;
  /** In the family on the Hub, with a switching PIN. */
  hubPin?: boolean;
  /** The Hub lets you switch to them without their PIN (your kid, or a kid in your family without one). */
  noPinNeeded?: boolean;
  /** You're this kid's parent. */
  parent?: boolean;
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
  // only people in your own family: never another family's profile, even one signed in on this device
  for (const p of profiles) if (sameFamily(user, p.user)) byId.set(p.user.id, { id: p.user.id, displayName: p.user.displayName, role: p.user.role, saved: p });
  for (const f of family) {
    if (f.id === user.id) continue;
    const had = byId.get(f.id);
    byId.set(f.id, { ...had, id: f.id, displayName: f.displayName, role: f.role, hubPin: f.hasSwitchPin, noPinNeeded: f.noPinNeeded, parent: f.parent });
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
  const { user, switchProfile, addProfile, kids: myKids } = useHub();
  const people = useSwitchablePeople();
  const pinSet = useKidTime((s) => s.pinSet);
  const [asking, setAsking] = useState<{ to: Person; step: 'grown-up' | 'device' | 'hub' | 'new-pin' | 'confirm-pin'; draft?: string }>();
  const [err, setErr] = useState('');
  if (!user) return null;
  const kid = user.role === 'kid';

  /** Through the Hub: someone in the family who isn't signed in on this device yet. */
  const viaHub = async (to: Person, pin?: string) => {
    const s = await hubClient()!.switchTo(to.id, pin, thisDevice());
    addProfile(s);
    onClose();
  };

  const pick = async (to: Person, from: 'start' | 'grown-up' | 'pin-ready' = 'start') => {
    setErr('');
    // a parent handing the device to their kid: make sure there's a PIN to get back with first
    const isParent = to.parent || myKids.some((k) => k.id === to.id);
    if (from === 'start' && mustSetPinFirst({ viewerIsKid: kid, toRole: to.role, isParent, grownUpPinSet: pinSet, hasSwitchPin: !!user.hasSwitchPin })) return setAsking({ to, step: 'new-pin' });
    if (to.saved) {
      if (from === 'start' && kid) return setAsking({ to, step: 'grown-up' });
      if (to.saved.pin) return setAsking({ to, step: 'device' });
      switchProfile(to.id);
      return onClose();
    }
    // a kid always needs the other person's PIN; a grown-up needs it unless switching to their own kid or a kid without one
    if (kid || (to.hubPin && !to.noPinNeeded)) return setAsking({ to, step: 'hub' });
    try {
      await viaHub(to);
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    }
  };

  const reachable = (p: Person) => !!p.saved || p.hubPin || p.noPinNeeded || (p.role === 'kid' && !kid);

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
              <small className="muted">{(p.saved?.pin || (p.hubPin && !p.noPinNeeded && !kid) || (kid && (p.saved || p.hubPin))) ? '🔒' : ''}{p.role === 'kid' ? ' kid' : ''}{!reachable(p) ? ' no PIN yet' : ''}</small>
            </button>
          ))}
        </div>
        {err && <div className="card-err small">{err}</div>}
        <p className="muted small">Set the PIN your family switches to you with under Settings → Account.</p>
        <button className="btn ghost" onClick={onClose}>Close</button>
      </div>
      {asking?.step === 'new-pin' && (
        <PinDialog title="Set your PIN first" submitLabel="Next"
          note={`So ${asking.to.displayName} can't get into your profile: you'll type this PIN to switch back to you. It's also your switching PIN (Settings → Account).`}
          check={async () => undefined} onDone={(p) => setAsking({ to: asking.to, step: 'confirm-pin', draft: p })} onCancel={() => setAsking(undefined)} />
      )}
      {asking?.step === 'confirm-pin' && (
        <PinDialog title="Type it again" note={`Then Wavelength switches to ${asking.to.displayName}.`}
          check={async (p) => {
            if (p !== asking.draft) throw new Error("The PINs don't match");
            await hubClient()!.setSwitchPin(p);
            await useHub.getState().refresh();
          }}
          onDone={() => { const to = asking.to; setAsking(undefined); void pick(to, 'pin-ready'); }}
          onCancel={() => setAsking(undefined)} />
      )}
      {asking?.step === 'grown-up' && (
        <PinDialog title="Grown-up PIN" note={`A parent's PIN or the grown-up PIN. Switches to ${asking.to.displayName}.`} check={checkPin}
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
  const hasKids = useHub((s) => s.kids.length > 0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState('');
  if (!user || (!user.familyId && !hasKids)) return null;
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
        {hasKids && ' It also gets you back from your kids\' profiles, so they can\'t switch into yours without it.'}
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
