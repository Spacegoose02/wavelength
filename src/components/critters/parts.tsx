import { forwardRef, useContext, type ReactNode } from 'react';
import type { Viseme } from '../../player/visemes';
import { Pivot, SpeciesContext, useSpecies, type LegsStyle } from './bodies';
import { Bow, GirlContext } from './faces';
import type { SpeciesInfo } from './species';

/**
 * Pieces every critter shares (inline SVG, 400×400). Colours come from CSS (`.critter …` in styles.css):
 * fur and skin are fixed, clothes and lights take the skin's `--accent` / `--viz-*`, and the outfit layers
 * below are all in the SVG but hidden until `data-skin-group` (set in App.tsx) or `data-skin` asks for one.
 *
 * Faces, hats and glasses are drawn on one head skeleton: centred on 200,178 (about 160 wide, 130 tall, top
 * near y 112 where the hats sit), eyes on y 166, mouth on y 212. `Head` then scales and places it for the
 * species' figure (bodies.tsx), which also gives the top, shoulders, legs and tail.
 */

/** The <svg> with the shared defs and the backlight. `kind` is the act (`critter-<act>` class), `species` who plays it. */
export const CritterFrame = forwardRef<SVGSVGElement, { kind: string; species: SpeciesInfo; label: string; children: ReactNode }>(function CritterFrame({ kind, species, label, children }, ref) {
  return (
    <SpeciesContext.Provider value={species}>
    <svg ref={ref} className={`np-scene-canvas critter critter-${kind} species-${species.id}`} viewBox="0 0 400 400" role="img" aria-label={label}>
      <defs>
        <radialGradient id="critter-spot">
          <stop offset="0" className="spot-stop" />
          <stop offset="1" className="spot-stop" stopOpacity="0" />
        </radialGradient>
        <filter id="critter-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        {/* soft edges for contact shadows */}
        <filter id="critter-soft" x="-20%" y="-100%" width="140%" height="300%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
        <clipPath id="critter-torso">
          <path d={species.figure.torso} />
        </clipPath>
        {/* the vinyl shading laid over a flat colour: lit at the upper left, darker away from it */}
        <radialGradient id="critter-vinyl" cx="0.35" cy="0.25" r="0.9">
          <stop offset="0" stopColor="#fff" stopOpacity="0.28" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.3" />
        </radialGradient>
        <filter id="critter-blur" x="-30%" y="-60%" width="160%" height="220%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>
      <ellipse data-part="spot" cx="200" cy="200" rx="190" ry="170" fill="url(#critter-spot)" />
      {children}
    </svg>
    </SpeciesContext.Provider>
  );
});

/**
 * A soft contact shadow on the ground (an ellipse centred on `cx`,`cy`), so feet, stands and props sit on the
 * floor instead of floating over it. Draw it before what stands on it.
 */
export function Shadow({ cx, cy, rx, ry = 6 }: { cx: number; cy: number; rx: number; ry?: number }) {
  return <ellipse className="contact-shadow" cx={cx} cy={cy} rx={rx} ry={ry} filter="url(#critter-soft)" />;
}

/**
 * The body (`body` part, which the rig bobs): the species' top in the act's `.top` colour (or the shark's
 * skin and vest), then the act's prints (`children`) clipped to it, the shadow the head casts under the chin
 * and the vinyl shading.
 */
export function Body({ species, children }: { species: SpeciesInfo; children: ReactNode }) {
  const { torso, Top, Skin, chin, shoulders } = species.figure;
  const girl = useContext(GirlContext);
  return (
    <g data-part="body">
      {Top ? <Top /> : <path className="top ol" d={torso} />}
      <g clipPath="url(#critter-torso)">
        {Skin && <Skin />}
        {girl && <Bust shoulders={shoulders} />}
        {children}
        <ellipse className="chin-shadow" cx="200" cy={chin[0]} rx={chin[1]} ry="16" filter="url(#critter-blur)" />
        <path d={torso} fill="url(#critter-vinyl)" />
      </g>
      <path d={torso} fill="none" className="ol" />
    </g>
  );
}

/** The girl look on the top: a soft fold under each side of the chest, between the shoulders. */
function Bust({ shoulders: [[lx, y], [rx]] }: { shoulders: [number, number][] }) {
  const half = (rx - lx) / 2;
  const r = half * 0.42;
  const cy = y + 6;
  const fold = (cx: number) => `M${(cx - r).toFixed(1)} ${cy} Q ${cx.toFixed(1)} ${(cy + r * 1.1).toFixed(1)} ${(cx + r).toFixed(1)} ${cy}`;
  const at = [200 - half * 0.5, 200 + half * 0.5];
  return (
    <g className="bust">
      {at.map((cx) => <ellipse key={cx} cx={cx} cy={cy - r * 0.15} rx={r * 0.8} ry={r * 0.5} fill="rgb(255 255 255 / 0.18)" />)}
      <path d={at.map(fold).join(' ')} fill="none" stroke="rgb(0 0 0 / 0.38)" strokeWidth="2.4" strokeLinecap="round" />
    </g>
  );
}

/** Everything the species has behind its top: legs and feet in the act's trousers (`legs`) and shoes (`shoe`), neck, tail. */
export function Legs({ species, legs = 'legs', shoe }: { species: SpeciesInfo } & Partial<LegsStyle>) {
  const { Under } = species.figure;
  return <>{Under({ legs, shoe })}</>;
}

/** `translate(200 0) scale(k 1) translate(-200 0)`: squeeze about the middle of the picture. */
const narrow = (k: number) => (k === 1 ? undefined : `translate(200 0) scale(${k} 1) translate(-200 0)`);

/** A radiation trefoil: three 60° blades round a dot. */
function trefoil(cx: number, cy: number, r: number) {
  const ri = r * 0.32;
  const p = (rad: number, deg: number) => `${(cx + rad * Math.cos((deg * Math.PI) / 180)).toFixed(1)} ${(cy + rad * Math.sin((deg * Math.PI) / 180)).toFixed(1)}`;
  const blades = [-150, -30, 90].map((c) => {
    const a1 = c - 30;
    const a2 = c + 30;
    return `M${p(ri, a1)} L${p(r, a1)} A${r} ${r} 0 0 1 ${p(r, a2)} L${p(ri, a2)} A${ri} ${ri} 0 0 0 ${p(ri, a1)} Z`;
  });
  return blades.join(' ');
}

/** Outfit pieces worn on the body, drawn over the critter's own clothes. */
export function BodyOutfits() {
  return (
    <>
      <g className="outfit outfit-nuclear">
        <rect className="hazmat" x="100" y="200" width="200" height="200" />
        <path d="M200 252 L200 304" stroke="#8a6d00" strokeWidth="2.5" />
        <circle cx="236" cy="282" r="14" fill="#1b1b1f" />
        <circle cx="236" cy="282" r="12" className="hazmat" />
        <path d={trefoil(236, 282, 11)} fill="#1b1b1f" />
        <circle cx="236" cy="282" r="2.4" fill="#1b1b1f" />
      </g>
      <g className="outfit outfit-neon">
        <path data-glow="" d="M150 250 Q 200 292 250 250" className="glow-a" fill="none" strokeWidth="5" strokeLinecap="round" filter="url(#critter-glow)" />
        <path data-glow="" d="M160 252 Q 200 280 240 252" className="glow-b" fill="none" strokeWidth="4" strokeLinecap="round" filter="url(#critter-glow)" />
      </g>
    </>
  );
}

/** One mouth shape's outline, in the mouth's own frame (centre `x`, top `y`, half-width `w`, depth `h`). */
function mouthPath(shape: Viseme, x: number, y: number, w: number, h: number) {
  const f = (n: number) => n.toFixed(1);
  switch (shape) {
    case 'ah': // jaw dropped: a deep rounded D
      return `M${f(x - w)} ${f(y)} Q${f(x)} ${f(y + h * 0.12)} ${f(x + w)} ${f(y)} C${f(x + w * 1.05)} ${f(y + h * 1.05)} ${f(x - w * 1.05)} ${f(y + h * 1.05)} ${f(x - w)} ${f(y)} Z`;
    case 'oh': // small and round
      return `M${f(x)} ${f(y)} C${f(x + w * 0.8)} ${f(y)} ${f(x + w * 0.8)} ${f(y + h * 0.85)} ${f(x)} ${f(y + h * 0.85)} C${f(x - w * 0.8)} ${f(y + h * 0.85)} ${f(x - w * 0.8)} ${f(y)} ${f(x)} ${f(y)} Z`;
    case 'ee': // wide and short
      return `M${f(x - w * 1.35)} ${f(y)} Q${f(x)} ${f(y + h * 0.1)} ${f(x + w * 1.35)} ${f(y)} Q${f(x + w * 1.1)} ${f(y + h * 0.5)} ${f(x)} ${f(y + h * 0.52)} Q${f(x - w * 1.1)} ${f(y + h * 0.5)} ${f(x - w * 1.35)} ${f(y)} Z`;
    case 'smile': // open grin, corners up
      return `M${f(x - w * 1.55)} ${f(y - 3)} Q${f(x)} ${f(y + h * 0.08)} ${f(x + w * 1.55)} ${f(y - 3)} Q${f(x + w * 1.25)} ${f(y + h * 0.85)} ${f(x)} ${f(y + h * 0.9)} Q${f(x - w * 1.25)} ${f(y + h * 0.85)} ${f(x - w * 1.55)} ${f(y - 3)} Z`;
    default:
      return '';
  }
}

/** A row of `n` triangular teeth between x0 and x1 on line y, pointing down (dir 1) or up (dir -1). */
function teethRow(x0: number, x1: number, y: number, n: number, size: number, dir: 1 | -1) {
  const step = (x1 - x0) / n;
  let d = `M${x0.toFixed(1)} ${y.toFixed(1)}`;
  for (let i = 0; i < n; i++) d += ` L${(x0 + step * (i + 0.5)).toFixed(1)} ${(y + dir * size).toFixed(1)} L${(x0 + step * (i + 1)).toFixed(1)} ${y.toFixed(1)}`;
  return `${d} Z`;
}

export interface MouthProps {
  /** names the clip paths: one per species, so cards for different critters on one page don't share them */
  id: string;
  /** centre and top of the mouth, where the closed smile sits */
  x: number;
  y: number;
  /** half-width and how deep the open "ah" drops */
  w: number;
  h: number;
  /** inside of the mouth */
  fill: string;
  /** lips-pressed line colour, for `mm` */
  line: string;
  /** `rows`: top and bottom rows of pointed teeth (the shark); default a band of upper teeth */
  teeth?: 'band' | 'rows' | 'none';
}

/**
 * The singing mouth (`yawn` part): every shape in `player/visemes.ts`, one `<g data-mouth>` each. The rig
 * (rig.ts) shows the one `face.ts` picks and scales it open from its top edge; `mm` is shown at full size
 * (it's a closed mouth). Drawn in its own frame around (`x`, `y`) so a redrawn face can reuse it.
 */
export function Mouth({ id, x, y, w, h, fill, line, teeth = 'band' }: MouthProps) {
  return (
    <g data-part="yawn" style={{ transform: 'scaleY(0)' }}>
      {(['ah', 'oh', 'ee', 'smile'] as const).map((shape) => {
        const d = mouthPath(shape, x, y, w, h);
        const clip = `mouth-${id}-${shape}`;
        const depth = shape === 'ah' ? h * 0.82 : shape === 'oh' ? h * 0.85 : shape === 'ee' ? h * 0.5 : h * 0.86;
        const half = shape === 'ee' ? w * 1.35 : shape === 'smile' ? w * 1.55 : w;
        return (
          <g key={shape} data-mouth={shape} style={{ display: 'none' }}>
            <clipPath id={clip}>
              <path d={d} />
            </clipPath>
            <path d={d} fill={fill} />
            <g clipPath={`url(#${clip})`}>
              {/* tongue */}
              {shape !== 'ee' && <ellipse cx={x} cy={y + depth} rx={half * 0.6} ry={depth * 0.32} fill="#d86a78" />}
              {teeth === 'band' && shape !== 'oh' && <rect x={x - half * 1.2} y={y - 4} width={half * 2.4} height={4 + depth * 0.16} rx="2" fill="#fff" />}
              {teeth === 'rows' && (
                <>
                  <path d={teethRow(x - half * 1.1, x + half * 1.1, y - 1, shape === 'oh' ? 4 : 8, depth * 0.24 + 2, 1)} fill="#fff" />
                  <path d={teethRow(x - half * 1.1, x + half * 1.1, y + depth + 1, shape === 'oh' ? 3 : 7, depth * 0.2 + 2, -1)} fill="#fff" />
                </>
              )}
            </g>
          </g>
        );
      })}
      {/* lips pressed together (m, b, p): a closed line with the lower lip pushed out a little */}
      <g data-mouth="mm" style={{ display: 'none' }}>
        <path d={`M${x - w * 1.1} ${y + 2} Q${x} ${y + 5} ${x + w * 1.1} ${y + 2}`} fill="none" stroke={line} strokeWidth="3.5" strokeLinecap="round" />
        <path d={`M${x - w * 0.6} ${y + 7} Q${x} ${y + 10} ${x + w * 0.6} ${y + 7}`} fill="none" stroke={line} strokeWidth="2" strokeLinecap="round" opacity="0.5" />
      </g>
    </g>
  );
}

/**
 * Two brows (`brow-l`, `brow-r`), raised and tilted by the rig (face.ts: up on a crescendo or a held note, down
 * at the inner end on a squint). `l` is the left brow's path; the right one is its mirror about x 200, drawn in a
 * mirrored group, so the rig gives both the same rotation and they tilt as a pair.
 */
export function Brows({ l, className, stroke, width = 4 }: { l: string; className?: string; stroke?: string; width?: number }) {
  return (
    <g className="brows">
      <path data-part="brow-l" d={l} fill="none" className={className} stroke={stroke} strokeWidth={width} strokeLinecap="round" />
      {/* mirrored in a group: the rig's CSS transform on the path would replace a transform attribute on it */}
      <g transform="translate(400 0) scale(-1 1)">
        <path data-part="brow-r" d={l} fill="none" className={className} stroke={stroke} strokeWidth={width} strokeLinecap="round" />
      </g>
    </g>
  );
}

/**
 * The head: the species' face, then the act's own headwear (`hat`, `eyewear`), the skin-group outfit,
 * anything that goes over the outfit (`over`, e.g. the DJ's headphones) and the holiday hats. Hats,
 * headphones and hoods are sized for the usual head and refitted with the species' `fit`; glasses are
 * stretched to cover bigger eyes. Give own headwear `className="own-hat"` and own glasses
 * `className="own-eyewear"` so outfits that replace them can hide them. Girls wear a bow instead of the act's
 * hat, unless `girlHat` (the beanie) keeps it, when the bow goes on the hat in another colour.
 */
export function Head({ species, hat, eyewear, over, girlHat }: { species: SpeciesInfo; hat?: ReactNode; eyewear?: ReactNode; over?: ReactNode; girlHat?: boolean }) {
  const { Face, fit = {} } = species;
  const girl = useContext(GirlContext);
  const w = fit.w ?? 1;
  const lift = fit.lift ?? 0;
  const [ex, ey] = fit.eyes ?? [1, 1];
  const onTop = w === 1 && !lift ? undefined : `translate(0 ${lift}) ${narrow(w) ?? ''}`.trim();
  const eyeY = fit.eyeY ?? 166;
  const onEyes = ex === 1 && ey === 1 && eyeY === 166 ? undefined : `translate(200 ${eyeY}) scale(${ex} ${ey}) translate(-200 -166)`;
  const [y, s] = species.figure.head;
  return (
    <g data-part="head">
      <g transform={`translate(200 ${y}) scale(${s}) translate(-200 -178)`}>
      <Face />

      <g transform={onEyes}>{eyewear}</g>
      {/* hidden rather than left out, so the rig still finds the hat's parts (`adjust`) */}
      <g transform={onTop} display={girl && hat && !girlHat ? 'none' : undefined}>{hat}</g>

      {/* skin-group outfits: hidden unless <html data-skin-group> matches (styles.css) */}
      <g className="outfit outfit-nuclear" transform={narrow(w)}>
        <path className="hazmat" fillRule="evenodd" d="M100 168 A100 96 0 1 1 300 168 A100 96 0 1 1 100 168 Z M134 184 A66 58 0 1 0 266 184 A66 58 0 1 0 134 184 Z" />
        <ellipse cx="200" cy="184" rx="67" ry="59" fill="rgb(160 220 255 / 0.14)" stroke="#8a6d00" strokeWidth="4" />
        <path d="M164 196 Q 200 186 236 196 L 232 226 Q 200 244 168 226 Z" fill="#3b3b42" />
        <circle cx="200" cy="218" r="10" fill="#26262c" />
        <path d="M193 214 L207 214 M192 218 L208 218 M193 222 L207 222" stroke="#55555e" strokeWidth="1.6" />
        <circle cx="160" cy="224" r="13" fill="#4a4a52" stroke="#f4c20d" strokeWidth="3" />
        <circle cx="240" cy="224" r="13" fill="#4a4a52" stroke="#f4c20d" strokeWidth="3" />
        <circle cx="160" cy="224" r="5" fill="#2a2a30" />
        <circle cx="240" cy="224" r="5" fill="#2a2a30" />
      </g>
      <g className="outfit outfit-lasers" transform={onEyes}>
        <path d="M128 166 L 140 164 M272 166 L 260 164" className="visor-strap" strokeWidth="6" strokeLinecap="round" />
        <rect x="138" y="152" width="124" height="26" rx="13" fill="rgb(10 10 16 / 0.82)" />
        <rect data-glow="" x="144" y="161" width="112" height="7" rx="3.5" className="visor-beam" filter="url(#critter-glow)" />
        <rect x="138" y="152" width="124" height="26" rx="13" fill="none" className="visor-rim" strokeWidth="2.5" />
      </g>
      <g className="outfit outfit-neon" transform={onTop}>
        <path data-glow="" d="M136 140 Q 200 112 264 140" className="glow-b" fill="none" strokeWidth="5" strokeLinecap="round" filter="url(#critter-glow)" />
      </g>
      <g className="outfit outfit-retro" transform={onEyes}>
        {/* 8-bit shades */}
        <path d="M146 156 H254 V164 H246 V172 H238 V180 H214 V172 H206 V164 H194 V172 H186 V180 H162 V172 H154 V164 H146 Z" fill="#0b0b0d" />
        <path d="M158 164 H166 V168 H158 Z M218 164 H226 V168 H218 Z" fill="#fff" />
      </g>
      <g className="outfit outfit-editor" transform={onEyes}>
        {/* coder glasses */}
        <circle cx="170" cy="166" r="15" fill="rgb(255 255 255 / 0.18)" className="coder-frame" strokeWidth="4.5" />
        <circle cx="230" cy="166" r="15" fill="rgb(255 255 255 / 0.18)" className="coder-frame" strokeWidth="4.5" />
        <path d="M185 164 Q 200 156 215 164 M155 162 L 134 156 M245 162 L 266 156" fill="none" className="coder-frame" strokeWidth="4.5" strokeLinecap="round" />
      </g>

      <g transform={onTop}>
        {over}

        {/* holiday hats: hidden unless the skin shows one (styles.css) */}
      <g className="hat hat-witch">
        <path d="M150 112 L 214 18 Q 222 10 226 22 L 250 112 Z" fill="#2a1638" />
        <rect x="160" y="96" width="84" height="12" fill="#ff7a1a" />
        <ellipse cx="200" cy="112" rx="72" ry="12" fill="#1b0f24" />
      </g>
      <g className="hat hat-pilgrim">
        <path d="M160 112 L 170 40 L 230 40 L 240 112 Z" fill="#1d1a17" />
        <rect x="166" y="92" width="68" height="14" fill="#3a2a1a" />
        <rect x="190" y="90" width="20" height="18" rx="2" fill="none" stroke="#e8c15a" strokeWidth="4" />
        <ellipse cx="200" cy="112" rx="66" ry="10" fill="#141210" />
      </g>
      <g className="hat hat-santa">
        <path d="M146 112 Q 170 30 236 40 Q 270 50 282 92 L 254 104 Q 244 70 226 66 L 254 112 Z" fill="#d42a2a" />
        <rect x="140" y="100" width="120" height="20" rx="10" fill="#fff" />
        <circle cx="282" cy="96" r="12" fill="#fff" />
      </g>
      <g className="hat hat-sam">
        <path d="M166 112 L 172 30 L 228 30 L 234 112 Z" fill="#fff" />
        <path d="M170 36 L 230 36 M169 52 L 231 52 M168 68 L 232 68 M167 84 L 233 84" stroke="#e63946" strokeWidth="8" />
        <rect x="164" y="90" width="72" height="16" fill="#1d3b8f" />
        <circle cx="182" cy="98" r="3" fill="#fff" /><circle cx="200" cy="98" r="3" fill="#fff" /><circle cx="218" cy="98" r="3" fill="#fff" />
        <ellipse cx="200" cy="112" rx="64" ry="10" fill="#1d3b8f" />
      </g>
      <g className="hat hat-hearts">
        <path d="M176 112 Q 168 76 160 52 M224 112 Q 232 76 240 52" fill="none" stroke="#3d0f1f" strokeWidth="3" />
        <path d="M160 58 C 146 44, 146 28, 160 32 C 174 28, 174 44, 160 58 Z" fill="#e0245e" />
        <path d="M240 58 C 226 44, 226 28, 240 32 C 254 28, 254 44, 240 58 Z" fill="#ff5c8a" />
      </g>
      </g>
      {girl && fit.bow && <Bow x={fit.bow[0]} y={fit.bow[1]} rot={fit.bow[2]} s={hat && girlHat ? 0.85 : 1} alt={!!(hat && girlHat)} />}
      </g>
    </g>
  );
}

/**
 * An arm from the species' shoulder to a hand at `hand`, bending through the act's `d` (drawn from the old
 * shoulder, `M138 268 Q cx cy …` or `M262 268 …`), with the sleeve and hand coloured by CSS. The acts turn
 * it about the old shoulder, which `Pivot` puts on the species' own. `children` (a drumstick, say) are drawn
 * under the hand and move with the arm.
 */
export function Arm({ part, d, hand, handLater, children }: { part: string; d: string; hand: [number, number]; handLater?: boolean; children?: ReactNode }) {
  const g = useArm(part, d, hand);
  return (
    <Pivot from={g.base} to={g.sh} part={part}>
      <path className="limb-outline" d={g.path} fill="none" strokeWidth={g.arm + 5} strokeLinecap="round" />
      <path className="sleeve" d={g.path} fill="none" strokeWidth={g.arm} strokeLinecap="round" />
      <g transform={g.held}>{children}</g>
      {!handLater && <circle className="hand ol-thin" cx={g.hx} cy={g.hy} r={g.paw} />}
    </Pivot>
  );
}

/**
 * The hand of an `Arm` drawn with `handLater`, for an arm that goes behind an instrument with only the hand in
 * front (the guitar acts): draw the arm before the instrument and this after it, with the same `part`, `d` and
 * `hand`. The rig copies the arm's transform onto it every frame (`data-follow`).
 */
export function ArmHand({ part, d, hand }: { part: string; d: string; hand: [number, number] }) {
  const g = useArm(part, d, hand);
  return (
    <Pivot from={g.base} to={g.sh} follow={part}>
      <circle className="hand ol-thin" cx={g.hx} cy={g.hy} r={g.paw} />
    </Pivot>
  );
}

/** Where an arm goes on this species: from its shoulder, bending through the act's control point, to the hand (brought within reach). */
function useArm(part: string, d: string, hand: [number, number]) {
  const { shoulders, arm, paw, reach } = useSpecies().figure;
  const right = part === 'arm-r';
  const base: [number, number] = right ? [262, 268] : [138, 268];
  const sh = shoulders[right ? 1 : 0];
  const [, , cx, cy] = d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  // out of reach for this body: bring the hand (and what it holds) in towards the shoulder, keeping the bend
  const k = Math.min(1, reach / Math.hypot(hand[0] - sh[0], hand[1] - sh[1]));
  const at = (p: [number, number]) => [sh[0] + (p[0] - sh[0]) * k, sh[1] + (p[1] - sh[1]) * k];
  const [hx, hy] = at(hand);
  const [qx, qy] = at([cx, cy]);
  return {
    base,
    sh,
    arm,
    paw,
    hx: hx.toFixed(1),
    hy: hy.toFixed(1),
    held: k < 1 ? `translate(${(hx - hand[0]).toFixed(1)} ${(hy - hand[1]).toFixed(1)})` : undefined,
    path: `M${sh[0]} ${sh[1]} Q ${qx.toFixed(1)} ${qy.toFixed(1)} ${hx.toFixed(1)} ${hy.toFixed(1)}`,
  };
}
