/**
 * Frame pacing for the animation loops (components/Visualizer.tsx, components/Scenes.tsx,
 * components/critters/rig.ts). While music plays they draw every frame; paused, nothing reacts to the
 * audio, so they slow to IDLE_FPS, which is plenty for a blink or a slow sway and costs a third of the work.
 * Playing, they never go past MAX_FPS, even on a faster screen.
 *
 * Call the returned function with the requestAnimationFrame timestamp. It returns 0 when this frame
 * should be skipped, else the seconds since the last drawn frame (capped, so a tab coming back from the
 * background doesn't jump the clock).
 */
import { isAndroid } from './platform';

export const IDLE_FPS = 20;
/** Playing, at most this many: a 120 or 144 Hz screen would otherwise draw twice the frames for no visible gain. */
export const MAX_FPS = 60;
/**
 * On Android (phones, tablets, TV boxes) the visualizers stop at this while playing. Their WebView often draws
 * canvases on the CPU, and a cheap TV box can't keep up with 60 a second while the audio graph also runs; 30 still
 * reads as smooth motion for bars and scenes.
 */
export const LOW_POWER_FPS = 30;
/** The frame cap the visualizers use on this device. */
export const VIZ_MAX_FPS = isAndroid ? LOW_POWER_FPS : MAX_FPS;
/** On Android, canvases render at most 2× their CSS size: a 3× phone screen would otherwise fill 2.25× the pixels for no visible gain. */
export const VIZ_MAX_DPR = isAndroid ? 2 : 4;
/** With "Reduce motion" (lib/motion.ts): a couple of calm frames a second, playing or not. */
export const REDUCED_FPS = 2;

/** Set by lib/motion.ts: the person asked for less motion (their setting, or their system's). */
const reducedNow = () => typeof document !== 'undefined' && document.documentElement.classList.contains('reduce-motion');

export function createPacer(idleFps = IDLE_FPS, reduced: () => boolean = reducedNow, maxFps = MAX_FPS) {
  let last = -1;
  const gap = 1000 / idleFps - 2; // a little slack, so 60 Hz frames land on every third one
  const slowGap = 1000 / REDUCED_FPS - 2;
  const fastGap = 1000 / maxFps - 2;
  return (now: number, busy: boolean): number => {
    if (last < 0) {
      last = now;
      return 1 / 60;
    }
    if (reduced()) {
      if (now - last < slowGap) return 0;
      last = now;
      return 1 / 60; // the clock barely moves: a sway or a bounce stays nearly still
    }
    if (now - last < (busy ? fastGap : gap)) return 0;
    const dt = Math.min(0.1, Math.max(0.001, (now - last) / 1000));
    last = now;
    return dt;
  };
}

/**
 * Reads CSS custom properties off an element, at most every `everyMs`: getComputedStyle each frame forces
 * a style recalculation on top of the one the browser does anyway. Skins change rarely, so a half-second
 * old colour is fine.
 */
export function createCssVars(el: Element, everyMs = 500) {
  let at = -Infinity;
  const cache = new Map<string, string>();
  let styles: CSSStyleDeclaration | null = null;
  return (name: string, fallback: string, now: number): string => {
    if (now - at > everyMs) {
      at = now;
      cache.clear();
      styles = getComputedStyle(el);
    }
    let v = cache.get(name);
    if (v === undefined) {
      v = styles!.getPropertyValue(name).trim();
      cache.set(name, v);
    }
    return v || fallback;
  };
}

/**
 * Keeps a canvas's backing store matched to its CSS size × the screen's pixel ratio (capped at `maxDpr`).
 * The CSS size comes from a ResizeObserver, so the draw loop never reads layout. Returns the CSS size and the
 * scale to draw at, and `resized` on frames where the canvas was just resized (and so cleared).
 *
 * The backing size is rounded: Android screens have pixel ratios like 2.625 or 2.75, and comparing a canvas's
 * whole-number width with an unrounded `w * dpr` never matches, which used to resize (reallocate and clear) the
 * canvas on every single frame.
 */
export function createCanvasFit(canvas: HTMLCanvasElement, maxDpr = VIZ_MAX_DPR) {
  let w = canvas.clientWidth;
  let h = canvas.clientHeight;
  const ro = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(([e]) => {
        w = e.contentRect.width;
        h = e.contentRect.height;
      })
    : null;
  ro?.observe(canvas);
  return {
    fit() {
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
      const bw = Math.round(w * dpr);
      const bh = Math.round(h * dpr);
      const resized = canvas.width !== bw || canvas.height !== bh;
      if (resized) {
        canvas.width = bw;
        canvas.height = bh;
      }
      // scale by what the rounding actually gave, so drawing fills the canvas edge to edge
      return { w, h, sx: w ? bw / w : dpr, sy: h ? bh / h : dpr, resized };
    },
    stop() {
      ro?.disconnect();
    },
  };
}
