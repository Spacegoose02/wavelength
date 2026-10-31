import { useEffect, useRef, useState } from 'react';
import { createAudioReader } from '../player/analysis';
import { useSettings, type NpScene } from '../store/settings';
import { Cover } from './common';
import { Critter, critterLabel, nextAct, nextSpecies } from './critters/Critter';

/**
 * Now Playing "scenes": tap the artwork to cycle through full-size visualizers that react to the
 * music. Every canvas scene draws on one square canvas from the same analyser data (see `player/analysis.ts`);
 * streams without CORS give no data, so scenes then run on a gentle synthetic signal instead.
 */
export const SCENES: { id: NpScene; label: string }[] = [
  { id: 'art', label: 'Artwork' },
  { id: 'radial', label: 'Halo' },
  { id: 'scope', label: 'Oscilloscope' },
  { id: 'stars', label: 'Starfield' },
  { id: 'mirror', label: 'Mirror spectrum' },
  { id: 'rings', label: 'Pulse rings' },
  { id: 'raccoon', label: 'Critters' },
];

interface Frame {
  w: number;
  h: number;
  /** frequency bins 0..1 (low → high) */
  freq: Float32Array;
  /** waveform -1..1 */
  wave: Float32Array;
  bass: number;
  mid: number;
  treble: number;
  /** bass jumped well above its recent average */
  beat: boolean;
  colors: { low: string; mid: string; high: string; peak: string };
  art: HTMLImageElement | null;
  t: number;
}

type Draw = (g: CanvasRenderingContext2D, f: Frame) => void;

/** Fade what's already drawn instead of clearing, for motion trails. */
function fade(g: CanvasRenderingContext2D, f: Frame, amount: number) {
  g.save();
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = `rgb(0 0 0 / ${amount})`;
  g.fillRect(0, 0, f.w, f.h);
  g.restore();
}

function drawArt(g: CanvasRenderingContext2D, f: Frame, cx: number, cy: number, r: number) {
  g.save();
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.clip();
  if (f.art?.complete && f.art.naturalWidth) g.drawImage(f.art, cx - r, cy - r, r * 2, r * 2);
  else {
    g.fillStyle = f.colors.mid;
    g.fill();
  }
  g.restore();
}

const radial: Draw = (g, f) => {
  g.clearRect(0, 0, f.w, f.h);
  const cx = f.w / 2;
  const cy = f.h / 2;
  const base = Math.min(f.w, f.h) * 0.24 * (1 + f.bass * 0.12);
  const n = 120;
  g.lineCap = 'round';
  g.lineWidth = Math.max(2, (Math.PI * 2 * base) / n - 2);
  for (let i = 0; i < n; i++) {
    // mirror left/right so the halo is symmetrical
    const k = i < n / 2 ? i : n - 1 - i;
    const v = f.freq[Math.floor((k / (n / 2)) * f.freq.length * 0.75)] ?? 0;
    const len = 6 + v * Math.min(f.w, f.h) * 0.22;
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    g.strokeStyle = v > 0.66 ? f.colors.high : v > 0.33 ? f.colors.mid : f.colors.low;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * (base + 6), cy + Math.sin(a) * (base + 6));
    g.lineTo(cx + Math.cos(a) * (base + 6 + len), cy + Math.sin(a) * (base + 6 + len));
    g.stroke();
  }
  drawArt(g, f, cx, cy, base);
};

const scope: Draw = (g, f) => {
  fade(g, f, 0.22);
  const mid = f.h / 2;
  const draw = (color: string, amp: number, width: number) => {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.beginPath();
    for (let i = 0; i < f.wave.length; i++) {
      const x = (i / (f.wave.length - 1)) * f.w;
      const y = mid + f.wave[i] * f.h * amp;
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.stroke();
  };
  g.shadowBlur = 18;
  g.shadowColor = f.colors.mid;
  draw(f.colors.low, 0.45, 4);
  g.shadowBlur = 0;
  draw(f.colors.peak, 0.45, 1.5);
};

interface Star { x: number; y: number; z: number }
let stars: Star[] = [];
const newStar = (): Star => ({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: Math.random() });

const starfield: Draw = (g, f) => {
  fade(g, f, 0.35);
  if (stars.length === 0) stars = Array.from({ length: 360 }, newStar);
  const cx = f.w / 2;
  const cy = f.h / 2;
  const speed = 0.004 + f.bass * 0.03 + (f.beat ? 0.02 : 0);
  for (const s of stars) {
    const pz = s.z;
    s.z -= speed;
    if (s.z <= 0.02) {
      Object.assign(s, newStar(), { z: 1 });
      continue;
    }
    const sx = cx + (s.x / s.z) * cx;
    const sy = cy + (s.y / s.z) * cy;
    const px = cx + (s.x / pz) * cx;
    const py = cy + (s.y / pz) * cy;
    g.strokeStyle = s.z < 0.3 ? f.colors.peak : s.z < 0.6 ? f.colors.high : f.colors.low;
    g.lineWidth = (1 - s.z) * 3;
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(sx, sy);
    g.stroke();
  }
};

const mirror: Draw = (g, f) => {
  g.clearRect(0, 0, f.w, f.h);
  // bass in the middle, highs toward both edges
  const bars = 48;
  const half = bars / 2;
  const gap = 3;
  const bw = (f.w - gap * (bars - 1)) / bars;
  const mid = f.h / 2;
  const grad = g.createLinearGradient(0, 0, 0, f.h);
  grad.addColorStop(0, f.colors.high);
  grad.addColorStop(0.35, f.colors.mid);
  grad.addColorStop(0.5, f.colors.low);
  grad.addColorStop(0.65, f.colors.mid);
  grad.addColorStop(1, f.colors.high);
  g.fillStyle = grad;
  for (let k = 0; k < half; k++) {
    const lo = Math.floor(Math.pow(k / half, 1.8) * f.freq.length * 0.6);
    const hi = Math.max(lo + 1, Math.floor(Math.pow((k + 1) / half, 1.8) * f.freq.length * 0.6));
    let v = 0;
    for (let j = lo; j < hi; j++) v += f.freq[j];
    v /= hi - lo;
    const bh = Math.max(2, v * mid * 0.95);
    const r = Math.min(bw / 2, 5);
    for (const i of [half - 1 - k, half + k]) {
      g.beginPath();
      g.roundRect(i * (bw + gap), mid - bh, bw, bh * 2, r);
      g.fill();
    }
  }
};

interface Ring { r: number; life: number; color: string }
let rings: Ring[] = [];

const pulseRings: Draw = (g, f) => {
  g.clearRect(0, 0, f.w, f.h);
  const cx = f.w / 2;
  const cy = f.h / 2;
  const size = Math.min(f.w, f.h);
  if (f.beat || (rings.length === 0 && f.bass > 0.05)) {
    rings.push({ r: size * 0.16, life: 1, color: [f.colors.low, f.colors.mid, f.colors.high][rings.length % 3] });
  }
  rings = rings.filter((r) => r.life > 0);
  for (const ring of rings) {
    ring.r += size * 0.006 * (1 + f.bass);
    ring.life -= 0.012;
    g.strokeStyle = ring.color;
    g.globalAlpha = Math.max(0, ring.life);
    g.lineWidth = 2 + ring.life * 6;
    g.beginPath();
    g.arc(cx, cy, ring.r, 0, Math.PI * 2);
    g.stroke();
  }
  g.globalAlpha = 1;
  drawArt(g, f, cx, cy, size * 0.15 * (1 + f.bass * 0.15));
};

const DRAW: Record<Exclude<NpScene, 'art' | 'raccoon'>, Draw> = { radial, scope, stars: starfield, mirror, rings: pulseRings };

function SceneCanvas({ scene, art }: { scene: Exclude<NpScene, 'art' | 'raccoon'>; art?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const g = canvas.getContext('2d')!;
    stars = [];
    rings = [];
    let img: HTMLImageElement | null = null;
    if (art) {
      img = new Image();
      img.src = art;
    }
    const read = createAudioReader();
    let t = 0;
    let raf = 0;

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      t += 1 / 60;
      const { freq, wave, bass, mid, treble, beat } = read(t);

      const css = getComputedStyle(canvas);
      const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
      DRAW[scene](g, {
        w,
        h,
        freq,
        wave,
        bass,
        mid,
        treble,
        beat,
        colors: { low: v('--viz-low', '#22d3ee'), mid: v('--viz-mid', '#3dff9a'), high: v('--viz-high', '#ff4fd8'), peak: v('--viz-peak', '#ffffff') },
        art: img,
        t,
      });
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [scene, art]);

  return <canvas ref={ref} className="np-scene-canvas" />;
}

/**
 * The artwork slot of Now Playing. Tap (or Enter) to move to the next scene; the choice is remembered.
 * On the critter scene two small buttons in the corner switch to the next critter (raccoon, shark, aliens, bears)
 * and to the next act (DJ, country, rapper, rocker, drums, theremin, synth, accordion).
 */
export function NowPlayingStage({ art, alt }: { art?: string; alt: string }) {
  const scene = useSettings((s) => s.npScene);
  const setScene = useSettings((s) => s.setNpScene);
  const critter = useSettings((s) => s.critter);
  const setCritter = useSettings((s) => s.setCritter);
  const act = useSettings((s) => s.act);
  const setAct = useSettings((s) => s.setAct);
  const [hint, setHint] = useState<string>();
  const sceneLabel = (id: NpScene) => (id === 'raccoon' ? critterLabel(critter, act) : SCENES.find((s) => s.id === id)?.label ?? 'Artwork');
  const label = sceneLabel(scene);

  useEffect(() => {
    if (!hint) return;
    const id = window.setTimeout(() => setHint(undefined), 1600);
    return () => window.clearTimeout(id);
  }, [hint]);

  const next = () => {
    const i = SCENES.findIndex((s) => s.id === scene);
    const n = SCENES[(i + 1) % SCENES.length];
    setScene(n.id);
    setHint(sceneLabel(n.id));
  };

  const switchCritter = () => {
    const n = nextSpecies(critter);
    setCritter(n.id);
    setHint(critterLabel(n.id, act));
  };

  const switchAct = () => {
    const n = nextAct(act);
    setAct(n.id);
    setHint(critterLabel(critter, n.id));
  };

  return (
    <div className="np-stage-wrap">
      <button className={`np-stage ${scene === 'art' ? '' : 'scene'}`} onClick={next} title={`${label}: tap for the next visualizer`} aria-label={`Visualizer: ${label}. Tap for the next one.`}>
        {scene === 'art' ? <Cover key={art} src={art} alt={alt} className="np-art" /> : scene === 'raccoon' ? <Critter species={critter} act={act} /> : <SceneCanvas scene={scene} art={art} />}
        {hint && <span className="np-stage-hint">{hint}</span>}
      </button>
      {scene === 'raccoon' && (
        <div className="np-critter-switch">
          <button onClick={switchCritter} title="Switch critter" aria-label={`${label}. Switch to the next critter.`}>
            Switch critter
          </button>
          <button onClick={switchAct} title="Switch act" aria-label={`${label}. Switch to the next act.`}>
            Switch act
          </button>
        </div>
      )}
    </div>
  );
}
