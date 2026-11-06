/**
 * Frame pacing for the animation loops (components/Visualizer.tsx, components/Scenes.tsx,
 * components/critters/rig.ts). While music plays they draw every frame; paused, nothing reacts to the
 * audio, so they slow to IDLE_FPS, which is plenty for a blink or a slow sway and costs a third of the work.
 *
 * Call the returned function with the requestAnimationFrame timestamp. It returns 0 when this frame
 * should be skipped, else the seconds since the last drawn frame (capped, so a tab coming back from the
 * background doesn't jump the clock).
 */
export const IDLE_FPS = 20;
/** With "Reduce motion" (lib/motion.ts): a couple of calm frames a second, playing or not. */
export const REDUCED_FPS = 2;

/** Set by lib/motion.ts: the person asked for less motion (their setting, or their system's). */
const reducedNow = () => typeof document !== 'undefined' && document.documentElement.classList.contains('reduce-motion');

export function createPacer(idleFps = IDLE_FPS, reduced: () => boolean = reducedNow) {
  let last = -1;
  const gap = 1000 / idleFps - 2; // a little slack, so 60 Hz frames land on every third one
  const slowGap = 1000 / REDUCED_FPS - 2;
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
    if (!busy && now - last < gap) return 0;
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
