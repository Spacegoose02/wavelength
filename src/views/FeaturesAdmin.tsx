import { useEffect, useState } from 'react';
import { FEATURE_INFO, type FeatureKey } from '../lib/features';
import { hubClient, useHub } from '../store/hub';
import type { HubSonicStatus, HubTourSettings } from '../sources/hub';

/**
 * Settings → Features (Hub admins): switch each newer feature on or off for the household, and separately
 * for kid profiles (hub/src/features.ts). Devices pick the change up the next time they check in with the Hub.
 */

type Switches = Record<string, { on: boolean; kids: boolean }>;
const errText = (e: unknown) => String((e as Error)?.message ?? e);

/** How far the Hub's sound-alike analysis has got (hub/src/sonic/worker.ts). */
function SonicProgress() {
  const [st, setSt] = useState<HubSonicStatus>();
  useEffect(() => {
    const c = hubClient();
    const load = () => c?.sonicStatus().then(setSt).catch(() => undefined);
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, []);
  if (!st) return null;
  const pct = st.total ? Math.round((st.analysed / st.total) * 100) : 0;
  return (
    <div className="sonic-progress small">
      {st.blocked ? <span className="errors">{st.blocked}</span> : (
        <span className="muted">
          {st.total ? `${st.analysed} of ${st.total} songs analyzed (${pct}%)` : 'Listing the library…'}
          {st.failed ? `, ${st.failed} couldn’t be read` : ''}{st.current ? ` · now: ${st.current}` : ''}
        </span>
      )}
      {' '}<button className="link small" onClick={() => hubClient()?.sonicRescan().then(setSt)}>Look for new songs</button>
    </div>
  );
}

/** Where tour dates come from, and the key (kept on the Hub). */
function TourSetup() {
  const c = hubClient()!;
  const [st, setSt] = useState<HubTourSettings>();
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    c.adminTours().then(setSt).catch((e) => setMsg(errText(e)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!st) return msg ? <div className="errors small">{msg}</div> : null;
  const save = (b: { provider?: string; key?: string }) =>
    c.saveAdminTours(b).then((r) => { setSt(r); setKey(''); setMsg(b.key !== undefined ? (b.key ? 'Key saved' : 'Key removed') : ''); }, (e) => setMsg(errText(e)));
  return (
    <div className="tour-setup small">
      <div className="chips">
        {([['ticketmaster', 'Ticketmaster'], ['bandsintown', 'Bandsintown']] as const).map(([v, label]) => (
          <button key={v} className={`chip ${st.provider === v ? 'on' : ''}`} onClick={() => save({ provider: v })}>{label}</button>
        ))}
      </div>
      <div className="row gap wrap">
        <input type="password" value={key} placeholder={st.keySet ? `Key saved (${st.hint})` : st.provider === 'ticketmaster' ? 'Ticketmaster Consumer Key' : 'Bandsintown app ID'} onChange={(e) => setKey(e.target.value)} />
        <button className="btn small" disabled={!key.trim()} onClick={() => save({ key })}>Save key</button>
        {st.keySet && <button className="btn small" onClick={() => save({ key: '' })}>Remove</button>}
      </div>
      <span className="muted">
        {st.provider === 'ticketmaster'
          ? <>A free key from <a href="https://developer.ticketmaster.com/" target="_blank" rel="noreferrer">developer.ticketmaster.com</a> (My Apps → Consumer Key).</>
          : <>An app ID from <a href="https://help.artists.bandsintown.com/en/articles/9186477-api-documentation" target="_blank" rel="noreferrer">Bandsintown</a>.</>}
        {' '}It stays on the Hub. {msg}
      </span>
    </div>
  );
}

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
                {f.key === 'sonic' && s.on && <SonicProgress />}
                {f.key === 'tourDates' && s.on && <TourSetup />}
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
