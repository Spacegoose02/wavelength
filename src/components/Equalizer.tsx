import { useEffect, useMemo, useRef, useState } from 'react';
import { engine } from '../player/engine';
import { autoPreamp, EQ_BANDS, EQ_MAX, EQ_MIN, EQ_PRESETS, fmtHz } from '../player/eq';
import { usePlayer } from '../store/player';
import { useSettings } from '../store/settings';

const CURVE_W = 300;
const CURVE_H = 80;
const CURVE_POINTS = 120;
/** Throwaway context, only used to ask the browser for the filters' frequency response. */
let probe: OfflineAudioContext | null = null;

/** Combined response of preamp + all bands in dB, at log-spaced frequencies from 20 Hz to 20 kHz. */
function responseCurve(gains: number[], preamp: number): number[] {
  probe ??= new OfflineAudioContext(1, 1, 44100);
  const freqs = new Float32Array(CURVE_POINTS).map((_, i) => 20 * Math.pow(1000, i / (CURVE_POINTS - 1)));
  const total = new Float32Array(CURVE_POINTS).fill(preamp);
  const mag = new Float32Array(CURVE_POINTS);
  const phase = new Float32Array(CURVE_POINTS);
  EQ_BANDS.forEach((hz, i) => {
    const f = probe!.createBiquadFilter();
    f.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
    f.frequency.value = hz;
    f.Q.value = 1.41;
    f.gain.value = gains[i] ?? 0;
    f.getFrequencyResponse(freqs, mag, phase);
    for (let k = 0; k < CURVE_POINTS; k++) total[k] += 20 * Math.log10(mag[k]);
  });
  return Array.from(total);
}

/** The equalizer controls: on/off, presets, response curve, preamp and 10 band sliders. */
export function Equalizer() {
  const eq = useSettings((s) => s.eq);
  const setEq = useSettings((s) => s.setEq);
  // re-render when the track changes so the "can't equalise this stream" note stays current
  const playing = usePlayer((s) => s.playing);
  usePlayer((s) => s.index);
  const unavailable = playing && !engine.eqAvailable();

  const curve = useMemo(() => {
    const db = responseCurve(eq.gains, eq.preamp);
    const y = (v: number) => CURVE_H / 2 - (Math.max(EQ_MIN, Math.min(EQ_MAX, v)) / EQ_MAX) * (CURVE_H / 2 - 4);
    return db.map((v, i) => `${i ? 'L' : 'M'}${((i / (db.length - 1)) * CURVE_W).toFixed(1)},${y(v).toFixed(1)}`).join('');
  }, [eq.gains, eq.preamp]);

  const pickPreset = (id: string) => {
    const p = EQ_PRESETS.find((x) => x.id === id)!;
    setEq({ preset: id, gains: [...p.gains], preamp: autoPreamp(p.gains), enabled: true });
  };
  const setBand = (i: number, v: number) => {
    const gains = [...eq.gains];
    gains[i] = v;
    setEq({ gains, preset: 'custom', enabled: true });
  };

  return (
    <div className={`eq ${eq.enabled ? '' : 'off'}`}>
      <div className="eq-head">
        <label className="eq-toggle">
          <input type="checkbox" checked={eq.enabled} onChange={(e) => setEq({ enabled: e.target.checked })} />
          <span>{eq.enabled ? 'Equalizer on' : 'Equalizer off'}</span>
        </label>
        <button className="btn small ghost" onClick={() => pickPreset('flat')}>Reset</button>
      </div>
      {unavailable && (
        <p className="eq-note">This stream's server doesn't allow the app to process its audio (no CORS headers), so the EQ can't change it. It still works on your other sources and on downloaded songs.</p>
      )}
      <div className="chips eq-presets">
        {EQ_PRESETS.map((p) => (
          <button key={p.id} className={`chip ${eq.preset === p.id ? 'on' : ''}`} onClick={() => pickPreset(p.id)}>{p.label}</button>
        ))}
        {eq.preset === 'custom' && <span className="chip on">Custom</span>}
      </div>
      <svg className="eq-curve" viewBox={`0 0 ${CURVE_W} ${CURVE_H}`} preserveAspectRatio="none" aria-hidden>
        <line x1={0} x2={CURVE_W} y1={CURVE_H / 2} y2={CURVE_H / 2} />
        <path d={curve} />
      </svg>
      <div className="eq-sliders">
        <Slider label="Pre" value={eq.preamp} min={EQ_MIN} max={6} onChange={(v) => setEq({ preamp: v, enabled: true })} />
        <span className="eq-sep" />
        {EQ_BANDS.map((hz, i) => (
          <Slider key={hz} label={fmtHz(hz)} value={eq.gains[i] ?? 0} min={EQ_MIN} max={EQ_MAX} onChange={(v) => setBand(i, v)} />
        ))}
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange(v: number): void }) {
  return (
    <label className="eq-band">
      <span className="eq-db">{value > 0 ? `+${value}` : value}</span>
      <input type="range" min={min} max={max} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(0)} aria-label={`${label} ${value} dB`} />
      <span className="eq-hz">{label}</span>
    </label>
  );
}

/** "EQ" button that opens the equalizer in a pop-over (player bar, Now Playing). */
export function EqButton({ className = 'tbtn small' }: { className?: string }) {
  const enabled = useSettings((s) => s.eq.enabled);
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

  return (
    <div className="eq-anchor" ref={ref}>
      <button className={`${className} eq-btn ${enabled ? 'on' : ''}`} onClick={() => setOpen(!open)} title="Equalizer">EQ</button>
      {open && (
        <div className="eq-pop" role="dialog" aria-label="Equalizer">
          <Equalizer />
        </div>
      )}
    </div>
  );
}
