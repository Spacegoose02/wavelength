import { useState } from 'react';
import { SEGMENT_LABELS, startStation, stopStation, useStation } from '../lib/djStation';
import { useDjAvailable } from '../lib/djStatus';
import { useFeature } from '../lib/features';
import type { HubStationKind } from '../sources/hub';
import { IconX } from './Icons';
import { DJ_NAME, TrashPanda } from './TrashPanda';

/** Whether this person can use DJ mode (the feature is on and the AI DJ is on for them). */
export function useDjMode(): boolean {
  const feature = useFeature('djMode');
  const dj = useDjAvailable();
  return feature && dj;
}

/** The DJ button in the player: starts DJ mode, or opens its panel when it's running. */
export function DjModeButton({ className = 'tbtn small' }: { className?: string }) {
  const can = useDjMode();
  const on = useStation((s) => s.on);
  const busy = useStation((s) => s.busy);
  if (!can) return null;
  return (
    <button
      className={`${className} dj-mode-btn ${on ? 'on' : ''}`}
      title={on ? `${DJ_NAME} is on air` : `DJ mode: let ${DJ_NAME} run a station for you`}
      onClick={(e) => {
        e.stopPropagation();
        if (on) useStation.setState({ open: true });
        else void startStation();
      }}
    >
      <TrashPanda busy={busy} />
    </button>
  );
}

/** What's on air, the segments to jump to, and a box to tell the DJ what you want. */
export function DjStationPanel({ inline = false }: { inline?: boolean }) {
  const s = useStation();
  const [ask, setAsk] = useState('');
  if (!s.on && !s.error && !s.busy) return null;
  if (!s.open) {
    return (
      <button className={`dj-station-pill ${inline ? 'inline' : ''}`} onClick={() => useStation.setState({ open: true })}>
        <TrashPanda busy={s.busy} /> <span>{s.title || 'DJ mode'}</span>
      </button>
    );
  }
  const send = () => {
    const t = ask.trim();
    if (!t) return;
    setAsk('');
    void startStation({ ask: t });
  };
  return (
    <div className={`dj-station ${inline ? 'inline' : 'floating'}`} role="region" aria-label="DJ mode">
      <div className="dj-station-head">
        <TrashPanda busy={s.busy} />
        <div className="dj-station-now">
          <small>{s.on ? `${DJ_NAME} · on air` : DJ_NAME}</small>
          <b>{s.busy && !s.title ? 'Picking songs…' : s.title || 'DJ mode'}</b>
        </div>
        <button className="tbtn small" title="Fold away" onClick={() => useStation.setState({ open: false })}>–</button>
        <button className="tbtn small" title="Stop DJ mode" onClick={stopStation}><IconX /></button>
      </div>
      {s.intro && <p className="dj-station-intro">“{s.intro}”</p>}
      {s.error && <p className="errors small">{s.error}</p>}
      <div className="chips">
        {(Object.keys(SEGMENT_LABELS) as Exclude<HubStationKind, 'ask'>[]).map((k) => (
          <button key={k} className={`chip ${s.kind === k ? 'on' : ''}`} disabled={s.busy} onClick={() => void startStation({ kind: k })}>{SEGMENT_LABELS[k]}</button>
        ))}
      </div>
      <form className="dj-station-ask" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input value={ask} maxLength={300} placeholder="Tell the DJ what you want: “90s house”, “chill for cooking”…" onChange={(e) => setAsk(e.target.value)} disabled={s.busy} />
        <button className="btn small" disabled={s.busy || !ask.trim()}>Go</button>
      </form>
      <label className="check small">
        <span className="switch"><input type="checkbox" checked={s.talk} onChange={(e) => useStation.setState({ talk: e.target.checked })} /><span /></span>
        <span>The DJ talks between segments</span>
      </label>
    </div>
  );
}
