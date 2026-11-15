import { useEffect, useState, type FormEvent } from 'react';
import { HubClient, HubError, type HubPickProfile, type HubPickResponse } from '../sources/hub';
import { thisDevice, useHub } from '../store/hub';
import { stopWebSso } from '../lib/webHub';

/**
 * "Who's listening?" after a family sign-in (hub/src/familyLogins.ts, docs/HUB.md "Family sign-ins"): pick a
 * profile, with its PIN when it has one. "Stay signed in" keeps that profile on this device; without it the app
 * opens on this picker again next time. The family sign-in itself stays until "Use a different sign-in".
 */
export function FamilyPicker({ client, pick, onCancel }: { client: HubClient; pick?: HubPickResponse['pick']; onCancel?: () => void }) {
  const family = useHub((s) => s.family);
  const [data, setData] = useState(pick);
  const [err, setErr] = useState('');
  const [chosen, setChosen] = useState<HubPickProfile>();
  const [pin, setPin] = useState('');
  const [stay, setStay] = useState(true);
  const [busy, setBusy] = useState(false);

  // remember the family sign-in so the picker can come back
  useEffect(() => {
    if (pick) useHub.getState().setFamily({ token: pick.familyToken, id: pick.family.id, name: pick.family.name });
  }, [pick]);

  // the picker again, from the saved family sign-in
  useEffect(() => {
    if (pick || !family) return;
    client.family(family.token).then(
      (r) => setData(r.pick),
      (e) => {
        if (e instanceof HubError && e.status === 401) {
          useHub.getState().setFamily(null);
          onCancel?.();
        } else setErr(String((e as Error)?.message ?? e));
      },
    );
  }, [client, pick, family?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = async (p: HubPickProfile, e?: FormEvent) => {
    e?.preventDefault();
    if (!data) return;
    setErr('');
    setBusy(true);
    try {
      const s = await client.pick({ familyToken: data.familyToken, userId: p.id, ...(pin && { pin }), ...thisDevice() });
      useHub.getState().picked(s, stay);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  const forget = () => {
    stopWebSso();
    useHub.getState().setFamily(null);
    onCancel?.();
  };

  if (!data) return err ? <div className="errors">{err}</div> : <p className="muted">Getting your family's profiles…</p>;
  return (
    <div className="editor family-picker">
      <h3>Who's listening?</h3>
      <p className="muted small">Signed in for {data.family.name ? `the ${data.family.name} family` : 'your family'}. Pick your profile.</p>
      {!data.profiles.length && <p className="small">No profiles can be picked with this sign-in yet. Ask your admin to add people to the family.</p>}
      <div className="row gap wrap">
        {data.profiles.map((p) => (
          <button key={p.id} type="button" className={`btn ${chosen?.id === p.id ? 'primary' : ''}`} disabled={busy} onClick={() => {
            setPin('');
            if (p.needsPin) setChosen(p);
            else void go(p);
          }}>
            {p.displayName}{p.needsPin ? ' 🔒' : ''}{p.role === 'kid' ? ' · kid' : ''}
          </button>
        ))}
      </div>
      {chosen?.needsPin && (
        <form onSubmit={(e) => void go(chosen, e)}>
          <div className="editor-grid">
            <label>{chosen.displayName}'s PIN<input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} autoFocus required /></label>
          </div>
          <div className="row gap" style={{ marginTop: 12 }}><button className="btn primary" disabled={busy}>Continue</button></div>
        </form>
      )}
      <label className="check" style={{ marginTop: 12 }}>
        <span className="switch"><input type="checkbox" checked={stay} onChange={(e) => setStay(e.target.checked)} /><span /></span>
        Stay signed in on this device
      </label>
      <p className="muted small">{stay ? 'Wavelength opens straight into this profile until you sign out.' : 'Next time Wavelength opens, it asks who’s listening again.'}</p>
      {err && <div className="errors">{err}</div>}
      <button type="button" className="btn small ghost" onClick={forget}>Use a different sign-in</button>
    </div>
  );
}
