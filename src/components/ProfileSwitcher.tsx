import { useState } from 'react';
import { checkPin, useKidTime } from '../lib/kidTime';
import { profilePinHash, useHub, type SavedProfile } from '../store/hub';
import { PinDialog } from './KidLock';

/**
 * Everyone signed in on this device (a TV the household shares): tap a name to switch to them without
 * signing in again. Leaving a kid profile takes the grown-up PIN; a profile with its own PIN asks for that.
 */
export function ProfileSwitcher({ onAdd }: { onAdd?: () => void }) {
  const { user, profiles, switchProfile, removeProfile, setProfilePin, pin } = useHub();
  const pinSet = useKidTime((s) => s.pinSet);
  const [asking, setAsking] = useState<{ to: SavedProfile; step: 'grown-up' | 'profile' }>();
  const [settingPin, setSettingPin] = useState(false);
  const [draft, setDraft] = useState('');
  if (!user) return null;
  const kid = user.role === 'kid';

  const go = (to: SavedProfile, from: 'start' | 'grown-up' = 'start') => {
    if (from === 'start' && kid) return setAsking({ to, step: 'grown-up' });
    if (to.pin) return setAsking({ to, step: 'profile' });
    setAsking(undefined);
    switchProfile(to.user.id);
  };

  return (
    <div className="editor">
      <h3>People on this device</h3>
      <p className="muted small">
        Sign in more than one person here (a TV or a shared tablet) and switch between them in a tap. Each person's settings, playlists and requests stay their own.
      </p>
      <div className="row gap wrap">
        <span className="chip">{user.displayName} · now</span>
        {profiles.map((p) => (
          <span key={p.user.id} className="row gap">
            <button className="btn small" disabled={kid && !pinSet} onClick={() => go(p)}>{p.user.displayName}{p.pin ? ' 🔒' : ''}</button>
            {!kid && <button className="btn small ghost" title={`Sign ${p.user.displayName} out of this device`}
              onClick={() => confirm(`Sign ${p.user.displayName} out of this device?`) && removeProfile(p.user.id)}>✕</button>}
          </span>
        ))}
        {!kid && onAdd && <button className="btn small ghost" onClick={onAdd}>+ Add someone</button>}
      </div>
      {kid && profiles.length > 0 && !pinSet && <p className="muted small">A grown-up needs to set a PIN under Settings → Users before this profile can switch.</p>}
      {!kid && profiles.length > 0 && (
        settingPin ? (
          <form className="row gap" onSubmit={async (e) => { e.preventDefault(); await setProfilePin(user.id, draft); setDraft(''); setSettingPin(false); }}>
            <input type="password" inputMode="numeric" maxLength={8} placeholder="New PIN (blank for none)" value={draft} onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))} />
            <button className="btn small" disabled={draft.length > 0 && draft.length < 4}>Save</button>
            <button type="button" className="btn small ghost" onClick={() => setSettingPin(false)}>Cancel</button>
          </form>
        ) : (
          <button className="btn small ghost" onClick={() => setSettingPin(true)}>{pin ? 'Change or remove my PIN' : 'Ask for a PIN before switching to me'}</button>
        )
      )}
      {asking?.step === 'grown-up' && (
        <PinDialog title="Grown-up PIN" note={`Switches to ${asking.to.user.displayName}.`} check={checkPin}
          onDone={() => go(asking.to, 'grown-up')} onCancel={() => setAsking(undefined)} />
      )}
      {asking?.step === 'profile' && (
        <PinDialog title={`${asking.to.user.displayName}'s PIN`}
          check={async (p) => {
            if ((await profilePinHash(asking.to.user.id, p)) !== asking.to.pin) throw new Error("That's not the PIN");
          }}
          onDone={() => { setAsking(undefined); switchProfile(asking.to.user.id); }} onCancel={() => setAsking(undefined)} />
      )}
    </div>
  );
}
