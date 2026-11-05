import { createContext, useContext, type ReactNode } from 'react';
import type { SpeciesInfo } from './species';

/**
 * The four body types from the signed-off body sheet (docs/critters/body-sheet.html, CRITTERS-ROADMAP.md
 * phase 3), in the same "vinyl toy" style as the faces: a dark outline (`.ol`), soft shading from the upper
 * left (`#critter-vinyl` over the flat colour) and no rim light (on bodies it read as a red outline).
 *
 * Each species has a `Figure`: where its (smaller) head sits, its top's silhouette, its shoulders and how
 * thick its arms are, and what is drawn behind the top (legs, feet, neck, tail). Acts draw the clothes'
 * prints, the instrument and the arms; `Body`, `Legs`, `Head` and `Arm` (parts.tsx) fit them to the figure.
 *
 * The rig and the acts still turn the arms about the old shoulders (138,268 and 262,268), the tail about
 * 268,292 and the country boot about 236,362: each of those parts is drawn inside an offset (`Pivot`) so the
 * old pivot lands on this figure's shoulder, tail root or foot.
 */
export interface Figure {
  /** head centre y and scale against the old skeleton (head 160 wide on 200,178) */
  head: [y: number, s: number];
  /** the top's silhouette: the act colours it (`.top`) and its prints are clipped to it */
  torso: string;
  /** left and right shoulder, where the arms join */
  shoulders: [[number, number], [number, number]];
  /** sleeve width at the shoulder and hand (paw) radius */
  arm: number;
  paw: number;
  /** how far a hand reaches from the shoulder; the acts' hands are brought in to it */
  reach: number;
  /** the shadow the head casts on the top, just under the chin */
  chin: [cy: number, rx: number];
  /** drawn behind the top: legs and feet (`legs` and `shoe` are the act's classes), neck, tail */
  Under: (p: LegsStyle) => ReactNode;
  /** drawn on the top before the act's prints (the shark's belly and vest) */
  Skin?: () => ReactNode;
  /** the top itself; default: the silhouette in the act's `.top` */
  Top?: () => ReactNode;
}

export interface LegsStyle {
  /** trousers class (`legs`, or `bare` for fur) */
  legs: string;
  /** shoe class (`sneaker`, `boot`, …), or none for bare feet */
  shoe?: string;
}

/** The species being drawn, for parts that need its figure (arms, which the acts draw without it). */
export const SpeciesContext = createContext<SpeciesInfo | null>(null);
export const useSpecies = () => useContext(SpeciesContext)!;

/** Shift a group so that the old pivot `from` lands on `to`; draw the contents as if at `from`. */
export function Pivot({ from, to, part, children }: { from: [number, number]; to: [number, number]; part: string; children: ReactNode }) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  return (
    <g transform={dx || dy ? `translate(${dx} ${dy})` : undefined}>
      <g data-part={part}>
        <g transform={dx || dy ? `translate(${-dx} ${-dy})` : undefined}>{children}</g>
      </g>
    </g>
  );
}

type P = [number, number];

/** A tapered limb along a quadratic curve p0 → (p1) → p2, `w0` wide at the root and `w1` at the end, as a filled outline. */
export function tube(p0: P, p1: P, p2: P, w0: number, w1: number, n = 16) {
  const l: string[] = [];
  const r: string[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0];
    const y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1];
    const dx = 2 * (1 - t) * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]);
    const dy = 2 * (1 - t) * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]);
    const len = Math.hypot(dx, dy) || 1;
    const w = (w0 + (w1 - w0) * t) / 2;
    l.push(`${(x - (dy / len) * w).toFixed(1)} ${(y + (dx / len) * w).toFixed(1)}`);
    r.unshift(`${(x + (dy / len) * w).toFixed(1)} ${(y - (dx / len) * w).toFixed(1)}`);
  }
  const end = (w1 / 2).toFixed(1);
  const start = (w0 / 2).toFixed(1);
  return `M${l[0]} L${l.join(' L')} A${end} ${end} 0 0 0 ${r[0]} L${r.join(' L')} A${start} ${start} 0 0 0 ${l[0]} Z`;
}

/** Flat colour (`className`) with the vinyl shading over it, outlined. */
function Shaded({ d, className, outline = 'ol', part }: { d: string; className: string; outline?: string; part?: string }) {
  return (
    <g data-part={part}>
      <path d={d} className={`${className} ${outline}`} />
      <path d={d} fill="url(#critter-vinyl)" />
    </g>
  );
}

/** A foot: the act's shoe, or a bare foot in the species' dark skin. The right one is `boot`, which the country act taps. */
function Foot({ at, rx, ry, shoe, right, tilt = 0 }: { at: P; rx: number; ry: number; shoe?: string; right?: boolean; tilt?: number }) {
  const foot = (
    <g transform={tilt ? `rotate(${tilt} ${at[0]} ${at[1]})` : undefined}>
      <ellipse cx={at[0]} cy={at[1]} rx={rx} ry={ry} className={`${shoe ?? 'foot'} ol-thin`} />
      <path d={`M${at[0] - rx * 0.8} ${at[1] + ry * 0.45} H${at[0] + rx * 0.8}`} stroke="rgb(0 0 0 / 0.25)" strokeWidth="3" />
    </g>
  );
  return right ? <Pivot from={[236, 362]} to={at} part="boot">{foot}</Pivot> : foot;
}

const RACCOON_TAIL = 'M236 340 C 316 344, 350 300, 344 250 C 340 214, 312 200, 298 218 C 318 240, 316 284, 262 304 Z';

/** Raccoon: a short chunky top over stout furry legs, a pale belly between them, big feet and a big striped tail. */
const raccoon: Figure = {
  head: [196, 0.86],
  torso: 'M178 258 Q 200 250 222 258 Q 242 280 242 312 Q 222 324 200 324 Q 178 324 158 312 Q 158 280 178 258 Z',
  shoulders: [[180, 270], [220, 270]],
  arm: 20,
  paw: 10,
  reach: 62,
  chin: [254, 40],
  Under: ({ shoe }) => (
    <>
      <Pivot from={[268, 292]} to={[234, 334]} part="tail">
        <g transform="translate(220 334) scale(1.02) translate(-240 -338)">
          <defs>
            <clipPath id="critter-raccoon-tail">
              <path d={RACCOON_TAIL} />
            </clipPath>
          </defs>
          <path d={RACCOON_TAIL} className="fur-mid ol" />
          <g clipPath="url(#critter-raccoon-tail)">
            <path d="M248 336 C 306 336, 336 296, 332 254 C 330 230, 316 214, 304 218" fill="none" className="fur-dark" strokeWidth="40" strokeDasharray="14 16" />
          </g>
          <path d={RACCOON_TAIL} fill="url(#critter-vinyl)" />
        </g>
      </Pivot>
      <Shaded d="M168 306 Q 152 330 162 358 L 192 358 Q 196 334 200 314 Z" className="fur-mid" />
      <Shaded d="M200 314 Q 206 336 208 358 L 238 358 Q 248 330 232 306 Z" className="fur-mid" />
      <path d="M184 312 Q 200 306 216 312 Q 214 340 200 348 Q 186 340 184 312 Z" className="fur-light" />
      <Foot at={[170, 363]} rx={21} ry={9} shoe={shoe} />
      <Foot at={[230, 365]} rx={21} ry={9} shoe={shoe} right />
    </>
  ),
};

/** Bears: a puffy jacket, baggy trousers with cuffs and big round feet, mid-stride. */
const bear: Figure = {
  head: [190, 0.86],
  torso: 'M174 256 Q 200 248 226 256 Q 250 264 254 290 Q 257 314 250 326 Q 200 338 150 326 Q 143 314 146 290 Q 150 264 174 256 Z',
  shoulders: [[176, 272], [224, 272]],
  arm: 25,
  paw: 13,
  reach: 66,
  chin: [252, 50],
  Under: ({ legs, shoe }) => (
    <>
      <Shaded d="M162 318 Q 156 338 162 354 L 198 354 Q 201 336 202 324 Z" className={legs} />
      <Shaded d="M198 324 Q 204 340 212 352 L 246 345 Q 248 330 238 318 Z" className={legs} />
      <path d="M161 348 H 199 V 357 H 161 Z" className={`${legs} ol-thin`} />
      <path d="M161 348 H 199 V 357 H 161 Z" fill="rgb(0 0 0 / 0.22)" />
      <path d="M211 349 L 246 342 L 248 351 L 213 358 Z" className={`${legs} ol-thin`} />
      <path d="M211 349 L 246 342 L 248 351 L 213 358 Z" fill="rgb(0 0 0 / 0.22)" />
      <Foot at={[178, 365]} rx={21} ry={10} shoe={shoe} />
      <Foot at={[234, 360]} rx={21} ry={10} shoe={shoe} tilt={-12} right />
    </>
  ),
};

const SHARK_BODY = 'M155.5 232 C 151 256 161.2 280 173.8 302 C 182.9 318 192 344 196.6 372 L 204.6 372 C 209.1 344 218.2 318 227.4 302 C 239.9 280 250.2 256 245.6 232 Z';
const SHARK_TAIL = 'M200.6 368 C 189.7 356 174.9 348 160.1 348 C 171.5 364 186.3 378 200.6 386 C 214.8 378 229.6 364 241 348 C 226.2 348 211.4 356 200.6 368 Z';

/**
 * Shark: one slim torpedo from the head down to a crescent tail, a white belly, no legs and no dorsal fin.
 * The arms are its pectoral fins, high on the sides; clothes are an open vest.
 */
const shark: Figure = {
  head: [207, 0.69],
  torso: SHARK_BODY,
  shoulders: [[172, 258], [228, 258]],
  arm: 16,
  paw: 8,
  reach: 60,
  chin: [244, 34],
  Under: () => (
    <>
      <Pivot from={[268, 292]} to={[200, 368]} part="tail">
        <Shaded d={SHARK_TAIL} className="shark-skin" />
      </Pivot>
      <g data-part="boot" />
    </>
  ),
  Top: () => <Shaded d={SHARK_BODY} className="shark-skin" />,
  Skin: () => (
    <>
      <path className="shark-belly" d="M173.8 236 Q 200 262 226.2 236 Q 225.1 290 212.5 326 Q 204.6 350 200.6 370 Q 196.6 350 188.6 326 Q 174.9 290 173.8 236 Z" />
      <path className="top ol" d="M162.4 238 C 160.1 266 164.7 290 172.6 304 L 186.3 294 L 182.9 252 Z" />
      <path className="top ol" d="M237.6 238 C 239.9 266 235.3 290 227.4 304 L 213.7 294 L 217.1 252 Z" />
    </>
  ),
};

const ALIEN_TOP = 'M178 256 Q 200 248 222 256 Q 232 290 220 322 Q 200 330 180 322 Q 168 290 178 256 Z';

/** Aliens: spindly arms and legs, a slim top, hovering over a soft glow. The green one has a short thick neck. */
const alien = (headY: number, neck: [top: number, bottom: number, width: number]): Figure => ({
  head: [headY, 0.85],
  torso: ALIEN_TOP,
  shoulders: [[186, 264], [214, 264]],
  arm: 10,
  paw: 7,
  reach: 62,
  chin: [252, 40],
  Under: ({ legs, shoe }) => (
    <>
      <ellipse cx="200" cy="376" rx="56" ry="9" className="hover-glow" filter="url(#critter-soft)" />
      <path d={tube([192, 318], [188, 336], [182, 350], 11, 8)} className={`${legs} ol`} />
      <path d={tube([208, 318], [214, 336], [220, 350], 11, 8)} className={`${legs} ol`} />
      <Foot at={[180, 354]} rx={10} ry={6} shoe={shoe} />
      <Foot at={[222, 354]} rx={10} ry={6} shoe={shoe} right />
      <path d={tube([200, neck[0]], [200, (neck[0] + neck[1]) / 2], [200, neck[1]], neck[2], neck[2] + 4)} className="hand ol" />
    </>
  ),
});

export const FIGURES = {
  raccoon,
  bear,
  shark,
  alien: alien(202, [226, 262, 30]),
  grey: alien(186, [226, 254, 12]),
} satisfies Record<string, Figure>;
