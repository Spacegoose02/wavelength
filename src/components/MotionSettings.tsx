import type { MotionPref } from '../lib/motion';
import { useSettings } from '../store/settings';

const OPTIONS: { id: MotionPref; label: string }[] = [
  { id: 'system', label: 'Like my device' },
  { id: 'reduce', label: 'Less motion' },
  { id: 'full', label: 'Full motion' },
];

/** Settings → Themes → Motion (lib/motion.ts). */
export function MotionSettings() {
  const motion = useSettings((s) => s.motion);
  const set = useSettings((s) => s.setMotion);
  return (
    <section>
      <h2>Motion</h2>
      <p className="muted">
        Less motion stops the scrolling song name and other animations, and the critters and visualizers barely move. "Like my device" follows
        your system's reduce-motion setting.
      </p>
      <div className="chips" role="radiogroup" aria-label="Motion">
        {OPTIONS.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={motion === o.id} className={`chip ${motion === o.id ? 'on' : ''}`} onClick={() => set(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
    </section>
  );
}
