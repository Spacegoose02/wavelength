import { useEffect, useState } from 'react';
import { FEATURE_INFO, type FeatureKey } from '../lib/features';
import { hubClient, useHub } from '../store/hub';

/**
 * Settings → Features (Hub admins): switch each newer feature on or off for the household, and separately
 * for kid profiles (hub/src/features.ts). Devices pick the change up the next time they check in with the Hub.
 */

type Switches = Record<string, { on: boolean; kids: boolean }>;
const errText = (e: unknown) => String((e as Error)?.message ?? e);

export function FeaturesAdminTab() {
  const c = hubClient();
  const [features, setFeatures] = useState<Switches | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    c?.adminFeatures()
      .then((r) => setFeatures(r.features))
      .catch((e) => setErr(errText(e)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (key: FeatureKey, patch: { on?: boolean; kids?: boolean }) => {
    if (!c || !features) return;
    // show it straight away; put it back if the Hub says no
    const before = features;
    setFeatures({ ...features, [key]: { ...features[key], ...patch } });
    try {
      setFeatures((await c.saveAdminFeatures({ [key]: patch })).features);
      setErr('');
      useHub.getState().refresh();
    } catch (e) {
      setFeatures(before);
      setErr(errText(e));
    }
  };

  return (
    <section>
      <h2>Features</h2>
      <p className="muted small">
        Turn features on or off for everyone on this Hub. <b>Kids</b> turns one off for kid profiles only. Phones, PCs and
        TVs pick up a change the next time they check in with the Hub (within a few minutes, or when the app opens).
      </p>
      {err && <div className="errors">{err}</div>}
      {!features && !err && <p className="muted">Loading…</p>}
      {features && (
        <div className="feature-list">
          {FEATURE_INFO.map((f) => {
            const s = features[f.key] ?? { on: false, kids: false };
            return (
              <div key={f.key} className="feature-row">
                <label className="check">
                  <span className="switch"><input type="checkbox" checked={s.on} onChange={(e) => save(f.key, { on: e.target.checked })} /><span /></span>
                  <span>
                    <b>{f.label}</b>
                    <br />
                    <small className="muted">{f.help}</small>
                  </span>
                </label>
                <label className="check feature-kids" title="Also on for kid profiles">
                  <input type="checkbox" checked={s.on && s.kids} disabled={!s.on} onChange={(e) => save(f.key, { kids: e.target.checked })} />
                  <small>Kids</small>
                </label>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
