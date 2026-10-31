import { useEffect, type RefObject } from 'react';
import { createAudioReader, type AudioSample } from '../../player/analysis';

/** What each critter's own animation gets every frame. */
export interface RigFrame {
  /** seconds since the scene mounted */
  t: number;
  a: AudioSample;
  idle: boolean;
  /** 1 on a detected beat, easing back to 0 */
  bob: number;
  /** a strong high-frequency hit happened in the last ~0.45 s */
  hit: boolean;
  /** -1..1 fast wobble while `hit` is true (scratching, strumming), else 0 */
  rock: number;
  /** look up a `data-part` element */
  $: (name: string) => SVGElement;
}

export interface RigOptions {
  /** how far the head nods on a beat (DJ 10, rocker headbangs harder) */
  nod?: number;
  /** open the mouth with the vocals (`AudioSample.voice`) while playing; on for every act unless turned off */
  talk?: boolean;
  /** draw one frame and stop: Settings previews */
  still?: boolean;
}

/**
 * The animation every critter shares, written straight to SVG attributes from requestAnimationFrame
 * (no React re-render per frame):
 *
 * - `head` bobs on beats and sways; `body` follows a little.
 * - `eyes` blink; the mouth (`yawn`, hiding `smile`) sings along with the vocals. Paused, they yawn
 *   and now and then lift `adjust`
 *   (headphones, hat, cap, hair or beanie) as if setting it straight.
 * - `tail` wags, `spot` (the backlight) breathes with the bass, `[data-glow]` parts (neon and laser
 *   outfits) pulse with the bass.
 *
 * Each critter passes `frame` for its own hands and instrument. Parts a critter doesn't have are skipped.
 */
export function useCritterRig(root: RefObject<SVGSVGElement | null>, frame: (f: RigFrame) => void, opts: RigOptions = {}) {
  const { nod: nodScale = 10, talk = true, still = false } = opts;
  useEffect(() => {
    const svg = root.current!;
    const cache = new Map<string, SVGElement | null>();
    const find = (name: string) => {
      if (!cache.has(name)) cache.set(name, svg.querySelector<SVGElement>(`[data-part="${name}"]`));
      return cache.get(name) ?? null;
    };
    const $ = (name: string) => find(name)!;
    const set = (name: string, transform: string) => find(name)?.setAttribute('transform', transform);
    const glows = [...svg.querySelectorAll<SVGElement>('[data-glow]')];

    const read = createAudioReader();
    let t = 0;
    let raf = 0;
    let bob = 0;
    let hitUntil = -1;
    let nextBlink = 2;
    let nextYawn = 6;
    let nextAdjust = 11;
    let singing = 0;

    const loop = () => {
      if (!still) raf = requestAnimationFrame(loop);
      t += 1 / 60;
      const a = read(t);
      const idle = !a.playing;

      if (a.beat && a.live) bob = 1;
      bob *= 0.86;
      const sway = idle ? Math.sin(t * 0.8) * 2.5 : a.live ? Math.sin(t * 2.2) * 1.5 : Math.sin(t * 2) * 4;
      const nod = a.live ? bob * nodScale : idle ? 0 : (Math.sin(t * 4) + 1) * 1.5;
      set('head', `translate(0 ${nod.toFixed(2)}) rotate(${sway.toFixed(2)} 200 240)`);
      set('body', `translate(0 ${(nod * 0.3).toFixed(2)})`);

      if (a.transient) hitUntil = t + 0.45;
      const hit = t < hitUntil;
      const rock = hit ? Math.sin(t * 38) : 0;

      if (t > nextBlink) nextBlink = t + 2.5 + Math.random() * 3.5;
      let lids = nextBlink - t < 0.12 ? 0.1 : 1;
      let yawn = 0;
      if (idle) {
        if (t > nextYawn + 1.8) nextYawn = t + 8 + Math.random() * 6;
        const y = t - nextYawn;
        if (y > 0) {
          yawn = Math.sin((Math.min(y, 1.8) / 1.8) * Math.PI);
          lids = Math.min(lids, 1 - yawn * 0.85);
        }
        if (t > nextAdjust + 1.2) nextAdjust = t + 10 + Math.random() * 8;
      }
      const adj = idle && t > nextAdjust ? Math.sin(((t - nextAdjust) / 1.2) * Math.PI) : 0;
      // sing along: open quickly on a syllable, close a little slower
      const sing = talk && a.playing ? a.voice * 0.85 : 0;
      singing += (sing - singing) * (sing > singing ? 0.55 : 0.3);
      const mouth = Math.max(yawn, singing);
      set('eyes', `translate(0 166) scale(1 ${lids.toFixed(2)}) translate(0 -166)`);
      set('yawn', `translate(0 212) scale(1 ${mouth.toFixed(2)}) translate(0 -212)`);
      const smile = find('smile');
      if (smile) smile.style.opacity = mouth > 0.15 ? '0' : '1';
      set('adjust', `translate(0 ${(-6 * adj).toFixed(2)})`);
      set('tail', `rotate(${(Math.sin(t * (idle ? 0.9 : 1.8)) * 7 + bob * 4).toFixed(2)} 268 292)`);
      const spot = find('spot');
      if (spot) spot.style.opacity = (0.18 + a.bass * 0.55).toFixed(2);
      for (const g of glows) g.style.opacity = (0.55 + a.bass * 0.45 + bob * 0.2).toFixed(2);

      frame({ t, a, idle, bob, hit, rock, $ });
    };
    loop();
    return () => cancelAnimationFrame(raf);
    // `frame` is a new function each render; re-running on it would restart the scene
  }, [still]);
}
