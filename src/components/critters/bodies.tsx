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
  /** where a girl's skirt hangs from: waist y, half-width there, and the skirt's length */
  waist: [y: number, w: number, len: number];
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

/**
 * Shift a group so that the old pivot `from` lands on `to`; draw the contents as if at `from`. The inner group is
 * the moving `part`, or with `follow` a copy that the rig keeps moving with that part (`ArmHand`).
 */
export function Pivot({ from, to, part, follow, children }: { from: [number, number]; to: [number, number]; part?: string; follow?: string; children: ReactNode }) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  return (
    <g transform={dx || dy ? `translate(${dx} ${dy})` : undefined}>
      <g data-part={part} data-follow={follow}>
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
  shoulders: [[168, 272], [232, 272]],
  arm: 20,
  paw: 10,
  reach: 62,
  waist: [306, 40, 30],
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
  shoulders: [[156, 276], [244, 276]],
  arm: 25,
  paw: 13,
  reach: 66,
  waist: [314, 52, 30],
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
  shoulders: [[159, 262], [241, 262]],
  arm: 16,
  paw: 8,
  reach: 60,
  waist: [292, 30, 30],
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
  shoulders: [[177, 266], [223, 266]],
  arm: 10,
  paw: 7,
  reach: 62,
  waist: [310, 25, 26],
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


/** A cloven hoof: two dark toes with a notch between them. */
function Hoof({ at, right }: { at: P; right?: boolean }) {
  const [x, y] = at;
  const hoof = (
    <g>
      <path d={`M${x - 15} ${y + 6} Q ${x - 15} ${y - 7} ${x - 2} ${y - 7} L ${x - 1} ${y + 6} Z M${x + 15} ${y + 6} Q ${x + 15} ${y - 7} ${x + 2} ${y - 7} L ${x + 1} ${y + 6} Z`} className="hoof ol-thin" />
      <path d={`M${x - 12} ${y - 3} Q ${x - 8} ${y - 6} ${x - 4} ${y - 5}`} stroke="rgb(255 255 255 / 0.25)" strokeWidth="2" fill="none" strokeLinecap="round" />
    </g>
  );
  return right ? <Pivot from={[236, 362]} to={at} part="boot">{hoof}</Pivot> : hoof;
}

/**
 * Moose: a deep chest with the shoulders standing high (the hump), long legs with pale "stockings" below the
 * knee and cloven hooves (or the act's shoes), and a tiny tail tucked behind. The antlers are on the face.
 */
const moose: Figure = {
  head: [186, 0.84],
  torso: 'M172 252 Q 200 244 228 252 Q 250 256 254 282 Q 256 306 248 320 Q 200 330 152 320 Q 144 306 146 282 Q 150 256 172 252 Z',
  shoulders: [[156, 272], [244, 272]],
  arm: 22,
  paw: 12,
  reach: 66,
  waist: [310, 48, 28],
  chin: [252, 46],
  Under: ({ legs, shoe }) => {
    const bare = legs === 'bare';
    return (
      <>
        <Pivot from={[268, 292]} to={[236, 304]} part="tail">
          <path d="M228 300 Q 250 298 252 312 Q 244 318 230 312 Z" className="bare ol-thin" />
        </Pivot>
        <Shaded d={tube([180, 314], [176, 336], [176, 358], 22, 16)} className={legs} />
        <Shaded d={tube([220, 314], [224, 336], [224, 358], 22, 16)} className={legs} />
        {bare && (
          <>
            <path d={tube([176, 340], [176, 350], [176, 358], 17, 16)} className="moose-stocking" />
            <path d={tube([224, 340], [224, 350], [224, 358], 17, 16)} className="moose-stocking" />
          </>
        )}
        {shoe ? (
          <>
            <Foot at={[174, 364]} rx={18} ry={9} shoe={shoe} />
            <Foot at={[226, 364]} rx={18} ry={9} shoe={shoe} right />
          </>
        ) : (
          <>
            <Hoof at={[176, 364]} />
            <Hoof at={[224, 364]} right />
          </>
        )}
      </>
    );
  },
};


/** The turtle's shell seen from the front: a high dome, wider than the top, so its rim shows all round it. */
const SHELL = 'M200 222 C 258 222, 292 258, 292 300 C 292 334, 272 356, 246 362 Q 200 372 154 362 C 128 356, 108 334, 108 300 C 108 258, 142 222, 200 222 Z';

/** points round an ellipse about the shell's middle, at `deg` degrees (0 is to the right, 90 down) */
const ring = (rx: number, ry: number, deg: number) => {
  const r = (deg * Math.PI) / 180;
  return `${(200 + rx * Math.cos(r)).toFixed(1)} ${(298 + ry * Math.sin(r)).toFixed(1)}`;
};
const RIM_SEAMS = Array.from({ length: 14 }, (_, i) => `M${ring(70, 60, i * (360 / 14) - 90)} L${ring(100, 84, i * (360 / 14) - 90)}`).join(' ');
/** the big plates inside the rim: seams from the middle out to the rim, and a gold sunburst on each */
const PLATE_SEAMS = [-160, -120, -60, -20, 20, 160].map((a) => `M${ring(30, 26, a)} L${ring(70, 60, a)}`).join(' ') + ` M${ring(30, 26, 0)} A30 26 0 1 1 ${ring(30, 26, 180)} A30 26 0 1 1 ${ring(30, 26, 0)}`;
const RAYS = [-140, -90, -40, 0, 180, 150, 30]
  .map((a) => {
    const c = ring(50, 43, a);
    const [x, y] = c.split(' ').map(Number);
    return [0, 60, 120, 180, 240, 300].map((r) => `M${x} ${y} l ${(9 * Math.cos((r * Math.PI) / 180)).toFixed(1)} ${(9 * Math.sin((r * Math.PI) / 180)).toFixed(1)}`).join(' ');
  })
  .join(' ');

/**
 * Turtle (a box turtle): a round top over a tall domed shell whose rim shows behind the shoulders and either
 * side of the clothes. The shell is drawn under the top, so every act's outfit goes over it and the arms and
 * instruments in front of it (the hazmat suit covers it). A short scaly neck, stumpy legs with blunt claws (or
 * the act's shoes) and a little pointed tail.
 */
const turtle: Figure = {
  head: [190, 0.84],
  torso: 'M174 256 Q 200 248 226 256 Q 250 264 254 290 Q 256 314 248 326 Q 200 336 152 326 Q 144 314 146 290 Q 150 264 174 256 Z',
  shoulders: [[156, 276], [244, 276]],
  arm: 21,
  paw: 12,
  reach: 64,
  waist: [314, 50, 28],
  chin: [252, 44],
  Under: ({ legs, shoe }) => (
    <>
      <Pivot from={[268, 292]} to={[232, 350]} part="tail">
        <path d="M222 346 Q 248 348 262 366 Q 242 366 224 358 Z" className="bare ol-thin" />
      </Pivot>
      <defs>
        <clipPath id="critter-turtle-shell">
          <path d={SHELL} />
        </clipPath>
      </defs>
      <g className="turtle-shell">
        <path d={SHELL} className="shell-rim ol" />
        <g clipPath="url(#critter-turtle-shell)">
          <path d={RIM_SEAMS} className="shell-seam" strokeWidth="3" />
          <ellipse cx="200" cy="298" rx="70" ry="60" className="shell ol-thin" />
          <path d={PLATE_SEAMS} className="shell-seam" strokeWidth="3" fill="none" />
          <path d={RAYS} className="shell-ray" strokeWidth="3.5" strokeLinecap="round" />
        </g>
        <path d={SHELL} fill="url(#critter-vinyl)" />
      </g>
      <Shaded d={tube([178, 318], [174, 338], [174, 356], 30, 26)} className={legs} />
      <Shaded d={tube([222, 318], [226, 338], [226, 356], 30, 26)} className={legs} />
      {shoe ? (
        <>
          <Foot at={[172, 364]} rx={21} ry={10} shoe={shoe} />
          <Foot at={[228, 364]} rx={21} ry={10} shoe={shoe} right />
        </>
      ) : (
        <>
          <Claws at={[172, 362]} />
          <Claws at={[228, 362]} right />
        </>
      )}
      {/* the neck, with a fold of skin */}
      <path d={tube([200, 226], [200, 240], [200, 256], 40, 46)} className="bare ol" />
      <path d="M184 244 Q 200 250 216 244" fill="none" stroke="rgb(0 0 0 / 0.22)" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
};

/** A bare turtle foot: a stumpy round pad in the dark skin with three blunt pale claws. */
function Claws({ at, right }: { at: P; right?: boolean }) {
  const [x, y] = at;
  const foot = (
    <g>
      <ellipse cx={x} cy={y} rx={19} ry={10} className="foot ol-thin" />
      <path d={`M${x - 11} ${y + 5} l -2 5 M${x} ${y + 7} v 5 M${x + 11} ${y + 5} l 2 5`} className="claw" strokeWidth="4.5" strokeLinecap="round" />
    </g>
  );
  return right ? <Pivot from={[236, 362]} to={at} part="boot">{foot}</Pivot> : foot;
}

export const FIGURES = {
  raccoon,
  bear,
  shark,
  alien: alien(202, [226, 262, 30]),
  grey: alien(186, [226, 254, 12]),
  moose,
  turtle,
} satisfies Record<string, Figure>;
