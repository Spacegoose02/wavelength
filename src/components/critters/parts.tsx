import { forwardRef, type ReactNode } from 'react';
import type { SpeciesInfo } from './species';

/**
 * Pieces every critter shares (inline SVG, 400×400). Colours come from CSS (`.critter …` in styles.css):
 * fur and skin are fixed, clothes and lights take the skin's `--accent` / `--viz-*`, and the outfit layers
 * below are all in the SVG but hidden until `data-skin-group` (set in App.tsx) or `data-skin` asks for one.
 *
 * Every critter is drawn on the same skeleton so the rig and the outfits fit all of them: head centred
 * on 200,178 (about 160 wide, 130 tall, top near y 112 where the hats sit), eyes on y 166, mouth on
 * y 212, shoulders at 138,268 and 262,268, tail root at 268,292, torso `TORSO`.
 */

/** The <svg> with the shared defs and the backlight. `kind` is the act (`critter-<act>` class), `species` who plays it. */
export const CritterFrame = forwardRef<SVGSVGElement, { kind: string; species: string; label: string; children: ReactNode }>(function CritterFrame({ kind, species, label, children }, ref) {
  return (
    <svg ref={ref} className={`np-scene-canvas critter critter-${kind} species-${species}`} viewBox="0 0 400 400" role="img" aria-label={label}>
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
        <clipPath id="critter-torso">
          <path d={TORSO} />
        </clipPath>
      </defs>
      <ellipse data-part="spot" cx="200" cy="200" rx="190" ry="170" fill="url(#critter-spot)" />
      {children}
    </svg>
  );
});

export function Tail() {
  return (
    <g data-part="tail">
      <path d="M268 292 C 330 292, 352 244, 330 196" className="fur-mid" fill="none" strokeWidth="26" strokeLinecap="round" />
      <path d="M268 292 C 330 292, 352 244, 330 196" className="fur-dark" fill="none" strokeWidth="26" strokeDasharray="13 13" strokeDashoffset="6" />
    </g>
  );
}

/** The usual torso outline (hoodie, shirt, jacket, hazmat suit). */
export const TORSO = 'M116 304 C 116 262, 150 244, 200 244 C 250 244, 284 262, 284 304 Z';

/** `translate(200 0) scale(k 1) translate(-200 0)`: squeeze about the middle of the picture. */
const narrow = (k: number) => (k === 1 ? undefined : `translate(200 0) scale(${k} 1) translate(-200 0)`);

/**
 * The body (`body` part, which the rig bobs): the act's top and anything printed on it, narrowed for slim
 * species (`build`), with the shadow the head casts just under the chin. Draw the top on `TORSO`.
 */
export function Body({ species, children }: { species: SpeciesInfo; children: ReactNode }) {
  const k = species.build ?? 1;
  const { rx, ry, cy } = species.shadow ?? { rx: 70, ry: 62, cy: 190 };
  return (
    <g data-part="body">
      <g transform={narrow(k)}>
        {children}
        <ellipse className="chin-shadow" cx="200" cy={cy} rx={rx / k} ry={ry} clipPath="url(#critter-torso)" />
      </g>
    </g>
  );
}

/** The act's trousers and shoes, or the species' own lower half where it has one (the shark's tail end). */
export function Legs({ species, children }: { species: SpeciesInfo; children: ReactNode }) {
  const { Lower } = species;
  return Lower ? <Lower /> : <>{children}</>;
}

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
        <path className="hazmat" d={TORSO} />
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

/**
 * The raccoon's face: ears, mask, eyes, nose and mouth. Every species' face (species.tsx) has the same
 * named parts: `eyes` (blinks, scaled about y 166), `smile` (hidden while the mouth is
 * open) and `yawn` (the open mouth, scaled from y 212).
 */
export function RaccoonFace() {
  return (
    <>
      <ellipse className="fur-mid" cx="138" cy="122" rx="22" ry="28" transform="rotate(-20 138 122)" />
      <ellipse className="fur-dark" cx="140" cy="125" rx="11" ry="16" transform="rotate(-20 140 125)" />
      <ellipse className="fur-mid" cx="262" cy="122" rx="22" ry="28" transform="rotate(20 262 122)" />
      <ellipse className="fur-dark" cx="260" cy="125" rx="11" ry="16" transform="rotate(20 260 125)" />
      <ellipse className="fur-mid" cx="200" cy="178" rx="80" ry="66" />
      <path className="fur-light" d="M122 196 Q 140 236 196 242 Q 150 214 122 196 Z M278 196 Q 260 236 204 242 Q 250 214 278 196 Z" />
      <path className="fur-dark-soft" d="M192 114 Q 200 110 208 114 L 204 156 L 196 156 Z" />
      <path className="fur-dark" d="M134 166 Q 150 140 184 154 Q 200 160 216 154 Q 250 140 266 166 Q 254 190 228 186 Q 210 182 200 176 Q 190 182 172 186 Q 146 190 134 166 Z" />
      <ellipse className="fur-light" cx="200" cy="208" rx="34" ry="24" />
      <g data-part="eyes">
        <circle cx="170" cy="166" r="9" fill="#fff" />
        <circle cx="230" cy="166" r="9" fill="#fff" />
        <circle cx="171" cy="167" r="5" fill="#111" />
        <circle cx="229" cy="167" r="5" fill="#111" />
        <circle cx="173" cy="164" r="1.6" fill="#fff" />
        <circle cx="231" cy="164" r="1.6" fill="#fff" />
      </g>
      <ellipse cx="200" cy="194" rx="10" ry="7" fill="#111" />
      <path data-part="smile" d="M186 212 Q 200 224 214 212" fill="none" stroke="#2b2b31" strokeWidth="3" strokeLinecap="round" />
      <ellipse data-part="yawn" cx="200" cy="220" rx="10" ry="11" fill="#5a1a24" transform="scale(1 0)" />
    </>
  );
}

/**
 * The head: the species' face, then the act's own headwear (`hat`, `eyewear`), the skin-group outfit,
 * anything that goes over the outfit (`over`, e.g. the DJ's headphones) and the holiday hats. Hats,
 * headphones and hoods are sized for the usual head and refitted with the species' `fit`; glasses are
 * stretched to cover bigger eyes. Give own headwear `className="own-hat"` and own glasses
 * `className="own-eyewear"` so outfits that replace them can hide them.
 */
export function Head({ species, hat, eyewear, over }: { species: SpeciesInfo; hat?: ReactNode; eyewear?: ReactNode; over?: ReactNode }) {
  const { Face, fit = {} } = species;
  const w = fit.w ?? 1;
  const lift = fit.lift ?? 0;
  const [ex, ey] = fit.eyes ?? [1, 1];
  const onTop = w === 1 && !lift ? undefined : `translate(0 ${lift}) ${narrow(w) ?? ''}`.trim();
  const onEyes = ex === 1 && ey === 1 ? undefined : `translate(200 166) scale(${ex} ${ey}) translate(-200 -166)`;
  return (
    <g data-part="head">
      <Face />

      <g transform={onEyes}>{eyewear}</g>
      <g transform={onTop}>{hat}</g>

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
    </g>
  );
}

/**
 * An arm from the shoulder to a hand, with the sleeve and hand coloured by CSS. `children` (a drumstick,
 * say) are drawn under the hand and move with the arm.
 */
export function Arm({ part, d, hand, thumb, children }: { part: string; d: string; hand: [number, number]; thumb: [number, number]; children?: ReactNode }) {
  return (
    <g data-part={part}>
      <path className="sleeve" d={d} fill="none" strokeWidth="20" strokeLinecap="round" />
      {children}
      <circle className="hand" cx={hand[0]} cy={hand[1]} r="11" />
      <circle className="fur-dark thumb" cx={thumb[0]} cy={thumb[1]} r="3.5" />
    </g>
  );
}
