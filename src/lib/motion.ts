import { useSettings } from '../store/settings';

/**
 * "Reduce motion" (Settings → Themes → Motion): `system` follows the device's own setting, `reduce` always calms
 * things down, `full` never does. While reduced, html gets the `reduce-motion` class: CSS stops animations and
 * transitions (the scrolling song name, pulses, slides), and the critters and visualizers draw a couple of still
 * frames a second instead of moving (lib/framePace.ts).
 */
export type MotionPref = 'system' | 'reduce' | 'full';

const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : undefined;

export const motionReduced = (pref: MotionPref = useSettings.getState().motion) => pref === 'reduce' || (pref === 'system' && !!media?.matches);

function apply() {
  document.documentElement.classList.toggle('reduce-motion', motionReduced());
}

export function startMotion() {
  apply();
  media?.addEventListener?.('change', apply);
  useSettings.subscribe((s, prev) => s.motion !== prev.motion && apply());
}
