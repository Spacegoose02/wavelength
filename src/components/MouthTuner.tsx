import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_TUNE, type MouthTune } from '../player/voice';
import { offsetKey, singingReading } from '../player/singing';
import { usePlayer } from '../store/player';
import { useSettings } from '../store/settings';

/**
 * The critter mouth tuner: sliders for every knob of the vocal detector and the lyrics gate (player/voice.ts,
 * player/singing.ts), a live graph of what the detector hears against what the mouth does, and a lyrics nudge
 * for the song that's playing. Open it from Now Playing (Tune mouth, beside the critter) to watch the critter
 * while tuning, or in Settings → Playback. Everything is saved to the person's synced settings.
 */

const HISTORY = 6; // seconds shown in the graph

function Slider({ label, hint, value, min, max, step, fmt, onChange }: { label: string; hint: string; value: number; min: number; max: number; step: number; fmt(v: number): string; onChange(v: number): void }) {
  return (
    <label className="range-field tuner-field" title={hint}>
      <span>
        {label} <b>{fmt(value)}</b>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ ['--pct' as string]: `${((value - min) / (max - min)) * 100}%` }} />
      <small className="muted">{hint}</small>
    </label>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="tuner-group">
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

/** detector (thin line), mouth (filled), sung lyric lines (band along the bottom), drum hits (ticks) */
function Graph() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [now, setNow] = useState({ ...singingReading });
  useEffect(() => {
    const pts: { t: number; d: number; m: number; line: string; hit: boolean }[] = [];
    let raf = 0;
    let lastText = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const r = singingReading;
      const t = performance.now() / 1000;
      pts.push({ t, d: r.detector, m: r.mouth, line: r.line, hit: r.hit });
      while (pts.length && pts[0].t < t - HISTORY) pts.shift();
      const c = canvas.current;
      const g = c?.getContext('2d');
      if (!c || !g) return;
      const w = (c.width = c.clientWidth * devicePixelRatio);
      const h = (c.height = c.clientHeight * devicePixelRatio);
      const x = (pt: number) => w - ((t - pt) / HISTORY) * w;
      const css = getComputedStyle(c);
      const accent = css.getPropertyValue('--accent').trim() || '#ff3ea5';
      const text = css.getPropertyValue('--muted').trim() || '#999';
      g.clearRect(0, 0, w, h);
      // sung lyric lines along the bottom
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i];
        if (p.line === 'none') continue;
        g.fillStyle = p.line === 'sung' ? accent : text;
        g.globalAlpha = p.line === 'sung' ? 0.35 : 0.12;
        g.fillRect(x(pts[i - 1].t), h - 6 * devicePixelRatio, x(p.t) - x(pts[i - 1].t) + 1, 6 * devicePixelRatio);
      }
      g.globalAlpha = 1;
      // mouth, filled
      g.beginPath();
      g.moveTo(x(pts[0]?.t ?? t), h);
      for (const p of pts) g.lineTo(x(p.t), h - 8 * devicePixelRatio - p.m * (h - 12 * devicePixelRatio));
      g.lineTo(w, h);
      g.closePath();
      g.fillStyle = accent;
      g.globalAlpha = 0.45;
      g.fill();
      g.globalAlpha = 1;
      // detector, a line
      g.beginPath();
      pts.forEach((p, i) => {
        const y = h - 8 * devicePixelRatio - p.d * (h - 12 * devicePixelRatio);
        if (i) g.lineTo(x(p.t), y);
        else g.moveTo(x(p.t), y);
      });
      g.strokeStyle = text;
      g.lineWidth = 1.5 * devicePixelRatio;
      g.stroke();
      // drum hits
      g.fillStyle = text;
      for (const p of pts) if (p.hit) g.fillRect(x(p.t), 0, devicePixelRatio, 6 * devicePixelRatio);
      if (t - lastText > 0.25) {
        lastText = t;
        setNow({ ...r });
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const mode: Record<string, string> = {
    voice: 'Following the voice',
    lyrics: 'Mouthing the lyrics’ syllables',
    chatter: 'Chattering (nothing to follow)',
    quiet: 'Mouth shut',
  };
  const line: Record<string, string> = { sung: 'in a sung line', gap: 'between lines', none: 'no synced lyrics' };
  return (
    <div className="tuner-graph">
      <canvas ref={canvas} aria-label="Graph of the detected voice and the mouth over the last few seconds" />
      <div className="tuner-legend small">
        <span><i className="sw mouth" /> mouth</span>
        <span><i className="sw det" /> voice detector</span>
        <span><i className="sw line" /> sung lyric lines</span>
        <span>▮ drum hits</span>
      </div>
      <p className="small muted tuner-now">
        {!usePlayer.getState().playing ? 'Play a song to see the mouth at work' : <>{mode[now.mode]} · {line[now.line]} · {!now.live ? 'can’t read this stream’s audio' : now.mono ? 'mono song' : 'stereo'}</>}
        {now.live && <> · center {Math.round(now.centred * 100)}% · tonal {Math.round(now.tonal * 100)}% · level {Math.round(now.level - now.loud)} dB</>}
      </p>
    </div>
  );
}

export function MouthTuner({ onClose }: { onClose?: () => void }) {
  const tune = useSettings((s) => s.mouthTune);
  const setTune = useSettings((s) => s.setMouthTune);
  const offsets = useSettings((s) => s.mouthOffsets);
  const setOffset = useSettings((s) => s.setMouthOffset);
  const track = usePlayer((s) => s.current());
  const key = offsetKey(track);
  const songOffset = offsets[key] ?? 0;
  const set = (p: Partial<MouthTune>) => setTune(p);
  const s1 = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)} s`;
  const changed = JSON.stringify(tune) !== JSON.stringify(DEFAULT_TUNE);

  return (
    <div className="mouth-tuner">
      <div className="tuner-head">
        <h3>Tune mouths</h3>
        {onClose && <button className="btn ghost" onClick={onClose} aria-label="Close the tuner">✕</button>}
      </div>
      <p className="muted small">
        Play a song with clear singing and watch the graph: the filled shape is the mouth, the line is what the voice detector hears.
        If the mouth opens on drums or guitar, raise <b>Center</b> or <b>Noise rejection</b>. If it stays shut while someone sings,
        raise <b>Sensitivity</b>. If it moves before or after the words, nudge the lyrics.
      </p>
      <Graph />

      <Group title="This song">
        {track ? (
          <>
            <Slider label="Lyrics timing" hint="Move the lyrics for this song only. + if the mouth starts before the singing." value={songOffset} min={-3} max={3} step={0.05} fmt={s1} onChange={(v) => setOffset(key, v)} />
            <div className="chips">
              <button className="chip" onClick={() => setOffset(key, songOffset - 0.1)}>Mouth is late (−0.1 s)</button>
              <button className="chip" onClick={() => setOffset(key, songOffset + 0.1)}>Mouth is early (+0.1 s)</button>
              {songOffset !== 0 && <button className="chip" onClick={() => setOffset(key, 0)}>Reset song</button>}
            </div>
          </>
        ) : (
          <p className="muted small">Play a song to nudge its lyrics.</p>
        )}
      </Group>

      <Group title="When the mouth opens">
        <Slider label="Sensitivity" hint="How quiet singing can be and still open the mouth." value={tune.sensitivity} min={8} max={48} step={1} fmt={(v) => `${v} dB`} onChange={(v) => set({ sensitivity: v })} />
        <Slider label="Center" hint="How much of the sound must come from the middle of the mix, where lead vocals usually are. Higher ignores more instruments." value={tune.centre} min={0.05} max={0.9} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ centre: v })} />
        <Slider label="Noise rejection" hint="Lower ignores more drums, hi-hats and hiss, but may miss breathy or shouted vocals." value={tune.noise} min={0.2} max={0.9} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ noise: v })} />
        <Slider label="Voice range from" hint="Lowest pitch that counts as voice. Raise for bass-heavy songs." value={tune.lowHz} min={60} max={600} step={10} fmt={(v) => `${v} Hz`} onChange={(v) => set({ lowHz: v })} />
        <Slider label="Voice range to" hint="Highest pitch that counts. Lower to ignore cymbals and bright guitars." value={tune.highHz} min={1500} max={8000} step={100} fmt={(v) => `${(v / 1000).toFixed(1)} kHz`} onChange={(v) => set({ highHz: v })} />
        <Slider label="Ignore after a drum hit" hint="Stops the mouth snapping open on each kick and snare." value={tune.drumHoldMs} min={0} max={300} step={10} fmt={(v) => `${v} ms`} onChange={(v) => set({ drumHoldMs: v })} />
      </Group>

      <Group title="Lyrics">
        <label className="check">
          <span className="switch"><input type="checkbox" checked={tune.useLyrics} onChange={(e) => set({ useLyrics: e.target.checked })} /><span /></span>
          <span>Keep the mouth shut between sung lines (when a song has synced lyrics)</span>
        </label>
        <label className="check">
          <span className="switch"><input type="checkbox" checked={tune.monoFallback} onChange={(e) => set({ monoFallback: e.target.checked })} /><span /></span>
          <span>On mono songs, mouth the lyrics instead of listening</span>
        </label>
        <Slider label="All songs’ lyrics timing" hint="For every song. + if mouths generally start before the singing." value={tune.lyricsOffset} min={-2} max={2} step={0.05} fmt={s1} onChange={(v) => set({ lyricsOffset: v })} />
        <Slider label="Syllable length" hint="How long each sung syllable lasts when mouthing the lyrics. Lower for fast rap, higher for ballads." value={tune.syllable} min={0.12} max={0.7} step={0.02} fmt={(v) => `${v.toFixed(2)} s`} onChange={(v) => set({ syllable: v })} />
      </Group>

      <Group title="Movement">
        <Slider label="Opens" hint="How quickly the mouth opens on a syllable." value={tune.attack} min={0.1} max={1} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ attack: v })} />
        <Slider label="Closes" hint="How quickly it closes again. Lower looks smoother, higher looks snappier." value={tune.release} min={0.05} max={1} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ release: v })} />
        <Slider label="Widest" hint="How wide the mouth opens at most." value={tune.gain} min={0.3} max={1} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ gain: v })} />
      </Group>

      <div className="chips">
        <button className="chip" disabled={!changed} onClick={() => setTune(null)}>Reset to defaults</button>
      </div>
    </div>
  );
}
