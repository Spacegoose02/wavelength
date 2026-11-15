import type { ReactNode } from 'react';
import { beatClock } from './arm';
import type { RigFrame } from './rig';

/**
 * Light, beat-synced scene effects shared by the acts (docs/CRITTERS-ROADMAP.md, phase 5): small pools of
 * particles thrown out on a beat or a hit (`Burst` / `burst`), and a one-shot flash (`Flash` / `flash`). They
 * add no filters and move only a handful of shapes per frame, writing transforms and opacity straight onto
 * their elements like the rest of the rig. With `prefers-reduced-motion` the flash is hidden (styles.css).
 *
 * A scene keeps one `FxState` (`newFx()` in a ref) and calls `burst` / `flash` from its own `frame`.
 */

type P = [number, number];

interface Particle {
  t0: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
}

interface Pool {
  els: SVGElement[];
  parts: Particle[];
  next: number;
}

export interface FxState {
  pools: Map<string, Pool>;
  flashes: Map<string, { el: SVGElement | null; v: number; was: boolean }>;
  /** the beat count seen last frame, and that frame's time and answer (`onBeat`) */
  beat: number;
  t: number;
  on: boolean;
}

export const newFx = (): FxState => ({ pools: new Map(), flashes: new Map(), beat: -1, t: -1, on: false });

/** `n` copies of `children` (drawn about 0,0), hidden until `burst` throws them. */
export function Burst({ name, n, className, children }: { name: string; n: number; className?: string; children: ReactNode }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <g key={i} data-burst={name} className={className} style={{ opacity: 0 }}>
          {children}
        </g>
      ))}
    </>
  );
}

export interface BurstSpec {
  /** where they're thrown from, and how far either side (x) they can start */
  at: P;
  spread?: number;
  /** starting speed ranges, units/s (negative y is up) */
  vx: P;
  vy: P;
  /** pull downwards, units/s² (negative floats them up) */
  g?: number;
  /** how long each one lasts, s */
  life: number;
  /** how much bigger each grows over its life (smoke), 0 for none */
  grow?: number;
  /** turn rate range, degrees/s (petals) */
  spin?: P;
}

const rnd = ([a, b]: P) => a + Math.random() * (b - a);

/**
 * Throws `count` particles of the `name` pool this frame (0 just moves the ones in flight), and draws them.
 * Each fades out over its life.
 */
export function burst({ t }: RigFrame, svg: SVGSVGElement, fx: FxState, name: string, spec: BurstSpec, count = 0) {
  let pool = fx.pools.get(name);
  if (!pool) {
    const els = [...svg.querySelectorAll<SVGElement>(`[data-burst="${name}"]`)];
    pool = { els, parts: els.map(() => ({ t0: -99, x: 0, y: 0, vx: 0, vy: 0, spin: 0 })), next: 0 };
    fx.pools.set(name, pool);
  }
  const { els, parts } = pool;
  if (!els.length) return;
  for (let k = 0; k < count; k++) {
    const p = parts[pool.next];
    pool.next = (pool.next + 1) % parts.length;
    p.t0 = t;
    p.x = spec.at[0] + (spec.spread ? (Math.random() * 2 - 1) * spec.spread : 0);
    p.y = spec.at[1];
    p.vx = rnd(spec.vx);
    p.vy = rnd(spec.vy);
    p.spin = spec.spin ? rnd(spec.spin) : 0;
  }
  const g = spec.g ?? 0;
  for (let i = 0; i < els.length; i++) {
    const p = parts[i];
    const age = t - p.t0;
    const el = els[i];
    if (age < 0 || age > spec.life) {
      if (el.style.opacity !== '0') el.style.opacity = '0';
      continue;
    }
    const k = age / spec.life;
    const x = p.x + p.vx * age;
    const y = p.y + p.vy * age + 0.5 * g * age * age;
    const s = 1 + (spec.grow ?? 0) * k;
    el.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(p.spin * age).toFixed(0)}) scale(${s.toFixed(2)})`);
    el.style.opacity = (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85).toFixed(2);
  }
}

/** A full-scene flash (a strobe, lightning) for `flash` to fire. */
export function Flash({ name, className }: { name: string; className: string }) {
  return <rect data-flash={name} className={`fx-flash ${className}`} x="0" y="0" width="400" height="400" style={{ opacity: 0 }} />;
}

/**
 * Fires the `name` flash once when `on` turns true (not again until it has been false), up to `max` opacity,
 * fading over about a fifth of a second. A gentle strobe: one flash per hit, never a flicker.
 */
export function flash(svg: SVGSVGElement, fx: FxState, name: string, on: boolean, max = 0.25) {
  let f = fx.flashes.get(name);
  if (!f) {
    f = { el: svg.querySelector<SVGElement>(`[data-flash="${name}"]`), v: 0, was: false };
    fx.flashes.set(name, f);
  }
  if (on && !f.was) f.v = 1;
  f.was = on;
  f.v *= 0.78;
  if (f.el) f.el.style.opacity = f.v < 0.02 ? '0' : (f.v * max).toFixed(2);
}

/**
 * True on the first frame of each beat while playing: the tempo grid's once it's locked on, else a steady
 * 120 BPM (`beatClock`). Asking twice in one frame gives the same answer.
 */
export function onBeat(f: RigFrame, fx: FxState) {
  if (f.t === fx.t) return fx.on;
  const { index } = beatClock(f);
  fx.on = f.a.playing && index !== fx.beat && fx.beat !== -1;
  fx.beat = index;
  fx.t = f.t;
  return fx.on;
}
