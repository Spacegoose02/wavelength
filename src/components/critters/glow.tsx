import type { CSSProperties } from 'react';

/**
 * A soft round glow: a circle (`r`) or ellipse (`rx`, `ry`) in `color` (any CSS colour, `var(--viz-low)` too) whose
 * edge fades out over `soft` units either side, as a shape under a blur of a quarter that width would. It looks the
 * same as the blur but costs a plain fill: a blur filter (or a CSS `filter: blur()`) is re-run every frame the
 * scene repaints, and these glows pulse every frame. `className` still sets its opacity (styles.css) and the rig
 * can fade it (`data-part`, `data-glow`, …); give it an `id` of its own.
 */
export function Glow({
  id,
  color,
  cx,
  cy,
  r = 0,
  rx = r,
  ry = r,
  soft = 8,
  className,
  style,
  ...data
}: { id: string; color: string; cx: number; cy: number; r?: number; rx?: number; ry?: number; soft?: number; className?: string; style?: CSSProperties } & Record<`data-${string}`, string>) {
  // solid out to `soft` inside the shape's edge, clear by `soft` outside it (the gradient spans the drawn ellipse)
  const inner = Math.max(0, Math.min(rx, ry) - soft) / (Math.min(rx, ry) + soft);
  return (
    <>
      <defs>
        <radialGradient id={id}>
          <stop offset="0" style={{ stopColor: color }} />
          <stop offset={inner.toFixed(3)} style={{ stopColor: color }} />
          <stop offset="1" style={{ stopColor: color, stopOpacity: 0 }} />
        </radialGradient>
      </defs>
      <ellipse {...data} className={className} cx={cx} cy={cy} rx={rx + soft} ry={ry + soft} style={{ ...style, fill: `url(#${id})` }} />
    </>
  );
}
