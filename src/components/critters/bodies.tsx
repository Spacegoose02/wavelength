import { createContext, useContext, type ReactNode } from 'react';
import { scale } from './scale';
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
  /** forearm width, below the elbow, when it's thinner than the upper arm (the T. rex's little arms) */
  fore?: number;
  /** what the hand is: a plain paw (default), a paw with two little claws, a wing's feathered tip (`Arm`,
   *  parts.tsx), or a penguin's flipper: no hand at all, the arm runs on into a long flat paddle */
  hand?: 'claws' | 'wing' | 'flipper';
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
  /** how the rig moves this species differently (rig.ts): `late`, everything half a beat behind (the sloth);
   *  `hop`, a little hop on every beat (the frog) */
  move?: 'late' | 'hop';
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
 * Turtle: a round top over a tall domed shell whose rim shows behind the shoulders and either
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


/**
 * Big cats (tiger, lion): a round top over sturdy furry legs, big soft paws (or the act's shoes) and a long
 * tail curling up behind; `Tail` draws the species' tail about its root at 236,320.
 */
const bigCat = (Tail: () => ReactNode): Figure => ({
  head: [190, 0.86],
  torso: 'M174 256 Q 200 248 226 256 Q 248 264 250 290 Q 252 312 246 324 Q 200 334 154 324 Q 148 312 150 290 Q 152 264 174 256 Z',
  shoulders: [[158, 274], [242, 274]],
  arm: 21,
  paw: 12,
  reach: 64,
  waist: [312, 48, 28],
  chin: [252, 46],
  Under: ({ legs, shoe }) => (
    <>
      <Pivot from={[268, 292]} to={[236, 320]} part="tail">
        <Tail />
      </Pivot>
      <Shaded d={tube([180, 314], [176, 336], [176, 356], 26, 22)} className={legs} />
      <Shaded d={tube([220, 314], [224, 336], [224, 356], 26, 22)} className={legs} />
      {shoe ? (
        <>
          <Foot at={[174, 364]} rx={20} ry={10} shoe={shoe} />
          <Foot at={[226, 364]} rx={20} ry={10} shoe={shoe} right />
        </>
      ) : (
        <>
          <Paw at={[175, 362]} />
          <Paw at={[225, 362]} right />
        </>
      )}
    </>
  ),
});

/** A bare big-cat paw: a soft round foot in the fur colour with two toe creases. */
function Paw({ at, right }: { at: P; right?: boolean }) {
  const [x, y] = at;
  const paw = (
    <g>
      <ellipse cx={x} cy={y} rx={19} ry={10} className="bare ol-thin" />
      <path d={`M${x - 6} ${y + 2} v 7 M${x + 6} ${y + 2} v 7`} stroke="rgb(0 0 0 / 0.3)" strokeWidth="2" strokeLinecap="round" />
    </g>
  );
  return right ? <Pivot from={[236, 362]} to={at} part="boot">{paw}</Pivot> : paw;
}

const CAT_TAIL = tube([230, 318], [296, 330], [292, 262], 16, 13);

/** The tiger's tail: orange with dark rings and a dark tip. */
function TigerTail() {
  return (
    <>
      <defs>
        <clipPath id="critter-tiger-tail">
          <path d={CAT_TAIL} />
        </clipPath>
      </defs>
      <path d={CAT_TAIL} className="bare ol" />
      <g clipPath="url(#critter-tiger-tail)" className="tiger-stripe" strokeWidth="6">
        <path d="M262 312 l 8 20 M282 300 l 18 6 M286 284 l 16 -2 M282 264 l 22 0" />
      </g>
      <path d={CAT_TAIL} fill="url(#critter-vinyl)" />
    </>
  );
}

/** The lion's tail: thin, with a dark tuft on the end. */
function LionTail() {
  return (
    <>
      <path d={tube([230, 318], [296, 330], [290, 270], 11, 8)} className="bare ol" />
      <path d="M290 270 C 276 262, 280 244, 290 238 C 294 248, 302 246, 304 254 C 304 264, 298 272, 290 270 Z" className="lion-tuft ol-thin" />
    </>
  );
}

/** An elephant's foot: a thick round pad in the skin colour with three pale toenails. */
function ElephantFoot({ at, right }: { at: P; right?: boolean }) {
  const [x, y] = at;
  const foot = (
    <g>
      <ellipse cx={x} cy={y} rx={22} ry={10} className="bare ol-thin" />
      {[-12, 0, 12].map((dx) => (
        <path key={dx} d={`M${x + dx - 5} ${y + 8} Q ${x + dx} ${y} ${x + dx + 5} ${y + 8} Z`} className="toenail" />
      ))}
    </g>
  );
  return right ? <Pivot from={[236, 362]} to={at} part="boot">{foot}</Pivot> : foot;
}

/**
 * Elephant: a round chunky top on short thick pillar legs, wide round feet with pale toenails (or the act's
 * shoes) and a little rope tail with a tuft. The ears and trunk are on the face.
 */
const elephant: Figure = {
  head: [188, 0.86],
  torso: 'M172 254 Q 200 246 228 254 Q 254 262 256 290 Q 258 316 250 328 Q 200 338 150 328 Q 142 316 144 290 Q 146 262 172 254 Z',
  shoulders: [[154, 274], [246, 274]],
  arm: 25,
  paw: 13,
  reach: 64,
  waist: [314, 54, 28],
  chin: [252, 50],
  Under: ({ legs, shoe }) => (
    <>
      <Pivot from={[268, 292]} to={[238, 316]} part="tail">
        <path d={tube([234, 314], [256, 316], [262, 336], 7, 5)} className="bare ol-thin" />
        <path d="M262 334 Q 254 346 260 352 Q 264 346 268 352 Q 272 344 264 334 Z" className="elephant-tuft ol-thin" />
      </Pivot>
      <Shaded d={tube([178, 316], [176, 338], [176, 356], 32, 30)} className={legs} />
      <Shaded d={tube([222, 316], [224, 338], [224, 356], 32, 30)} className={legs} />
      {shoe ? (
        <>
          <Foot at={[174, 364]} rx={22} ry={10} shoe={shoe} />
          <Foot at={[226, 364]} rx={22} ry={10} shoe={shoe} right />
        </>
      ) : (
        <>
          <ElephantFoot at={[176, 362]} />
          <ElephantFoot at={[224, 362]} right />
        </>
      )}
    </>
  ),
};

/** A bare panda foot: a soft round black foot with three pale toe pads peeking under the front. */
function PandaFoot({ at, right }: { at: P; right?: boolean }) {
  const [x, y] = at;
  const foot = (
    <g>
      <ellipse cx={x} cy={y} rx={21} ry={10} className="bare ol-thin" />
      {[-10, 0, 10].map((dx) => (
        <ellipse key={dx} cx={x + dx} cy={y + 5} rx={4} ry={2.6} className="panda-pad" />
      ))}
    </g>
  );
  return right ? <Pivot from={[236, 362]} to={at} part="boot">{foot}</Pivot> : foot;
}

/**
 * Panda: a round chubby top on short thick black legs, round black feet with pale toe pads (or the act's shoes)
 * and a little white puff of a tail. Arms and legs are black (`--skin`), like a real panda's.
 */
const panda: Figure = {
  head: [188, 0.88],
  torso: 'M172 254 Q 200 246 228 254 Q 254 262 256 290 Q 258 316 250 328 Q 200 338 150 328 Q 142 316 144 290 Q 146 262 172 254 Z',
  shoulders: [[154, 274], [246, 274]],
  arm: 24,
  paw: 13,
  reach: 64,
  waist: [314, 54, 28],
  chin: [252, 50],
  Under: ({ legs, shoe }) => (
    <>
      <Pivot from={[268, 292]} to={[240, 318]} part="tail">
        <circle cx="252" cy="318" r="13" className="panda-tail ol-thin" />
      </Pivot>
      <Shaded d={tube([180, 316], [177, 338], [176, 356], 30, 27)} className={legs} />
      <Shaded d={tube([220, 316], [223, 338], [224, 356], 30, 27)} className={legs} />
      {shoe ? (
        <>
          <Foot at={[174, 364]} rx={21} ry={10} shoe={shoe} />
          <Foot at={[226, 364]} rx={21} ry={10} shoe={shoe} right />
        </>
      ) : (
        <>
          <PandaFoot at={[175, 362]} />
          <PandaFoot at={[225, 362]} right />
        </>
      )}
    </>
  ),
};

/** An owl's foot: three plump orange toes with dark talon tips, under a fluffy feathered ankle. */
function Talons({ at, right }: { at: P; right?: boolean }) {
  const [x, y] = at;
  const foot = (
    <g>
      {[-11, 0, 11].map((dx) => (
        <g key={dx}>
          <ellipse cx={x + dx} cy={y + 2} rx={6} ry={9} transform={`rotate(${dx * 1.6} ${x + dx} ${y + 2})`} className="talon ol-thin" />
          <path d={`M${x + dx * 1.25} ${y + 9} l 0 4`} className="claw-tip" strokeWidth="3.5" strokeLinecap="round" />
        </g>
      ))}
    </g>
  );
  return right ? <Pivot from={[236, 362]} to={at} part="boot">{foot}</Pivot> : foot;
}

/**
 * Owl: a plump round egg of a top on short fluffy legs, orange talons (or the act's shoes) and a little fan of
 * tail feathers peeking out below. Its arms are its wings: bare feathered sleeves with feathered tips (`wing`, see
 * `Arm` in parts.tsx, and `.species-owl .sleeve` in styles.css) and a feathered tip for a hand.
 */
const owl: Figure = {
  head: [188, 0.88],
  torso: 'M174 252 Q 200 244 226 252 Q 256 266 258 296 Q 258 320 248 332 Q 200 342 152 332 Q 142 320 142 296 Q 144 266 174 252 Z',
  shoulders: [[156, 276], [244, 276]],
  arm: 26,
  paw: 13,
  reach: 64,
  hand: 'wing',
  waist: [316, 54, 28],
  chin: [252, 50],
  Under: ({ legs, shoe }) => (
    <>
      <Pivot from={[268, 292]} to={[200, 326]} part="tail">
        {[-16, 0, 16].map((dx) => (
          <path key={dx} d={`M${200 + dx * 0.5} 326 Q ${200 + dx * 1.4 - 9} 350 ${200 + dx * 1.6} 362 Q ${200 + dx * 1.4 + 9} 350 ${200 + dx * 0.5} 326 Z`} className="owl-tail ol-thin" />
        ))}
      </Pivot>
      <Shaded d={tube([182, 318], [180, 336], [180, 352], 28, 24)} className={legs} />
      <Shaded d={tube([218, 318], [220, 336], [220, 352], 28, 24)} className={legs} />
      {shoe ? (
        <>
          <Foot at={[176, 364]} rx={20} ry={10} shoe={shoe} />
          <Foot at={[224, 364]} rx={20} ry={10} shoe={shoe} right />
        </>
      ) : (
        <>
          <Talons at={[178, 360]} />
          <Talons at={[222, 360]} right />
        </>
      )}
    </>
  ),
};

/** A T. rex's foot: a broad round foot with three pale claws. */
function DinoFoot({ at, right }: { at: P; right?: boolean }) {
  const [x, y] = at;
  const foot = (
    <g>
      <ellipse cx={x} cy={y} rx={23} ry={11} className="bare ol-thin" />
      {[-13, 0, 13].map((dx) => (
        <path key={dx} d={`M${x + dx - 4} ${y + 7} Q ${x + dx} ${y + 15} ${x + dx + 4} ${y + 7} Z`} className="dino-claw ol-thin" />
      ))}
    </g>
  );
  return right ? <Pivot from={[236, 362]} to={at} part="boot">{foot}</Pivot> : foot;
}

const TREX_TAIL = 'M214 318 C 250 316, 286 330, 312 346 C 330 356, 350 356, 358 340 C 362 352, 352 370, 326 370 C 290 370, 250 360, 214 350 Z';

/**
 * T. rex: a sturdy pear of a top on big strong thighs, broad three-clawed feet (or the act's shoes) and a thick
 * tail sweeping out behind to the right along the ground with a row of little rounded plates. Its arms are short and thin, with a
 * plump upper arm, a skinny forearm bending at the elbow and two little claws on each hand (`fore`, `hand`),
 * set high and close on the chest; they still reach the instruments.
 */
const trex: Figure = {
  head: [186, 0.9],
  torso: 'M176 252 Q 200 244 224 252 Q 252 264 256 296 Q 258 320 250 332 Q 200 342 150 332 Q 142 320 144 296 Q 148 264 176 252 Z',
  shoulders: [[166, 276], [234, 276]],
  arm: 19,
  fore: 13,
  paw: 9,
  reach: 62,
  hand: 'claws',
  waist: [316, 54, 28],
  chin: [254, 50],
  Under: ({ legs, shoe }) => (
    <>
      <Pivot from={[268, 292]} to={[226, 330]} part="tail">
        <defs>
          <clipPath id="critter-trex-tail">
            <path d={TREX_TAIL} />
          </clipPath>
        </defs>
        {[[248, 320], [276, 328], [302, 340], [326, 350]].map(([x, y], i) => (
          <circle key={x} cx={x} cy={y - 4} r={9 - i * 1.5} className="dino-plate ol-thin" />
        ))}
        <path d={TREX_TAIL} className="bare ol" />
        <g clipPath="url(#critter-trex-tail)">
          <path d="M214 352 C 252 360, 292 368, 330 364 L 340 380 L 214 380 Z" className="dino-belly" />
          <circle cx="262" cy="334" r="4" className="dino-spot" />
          <circle cx="292" cy="344" r="3.4" className="dino-spot" />
          <circle cx="318" cy="354" r="2.6" className="dino-spot" />
        </g>
        <path d={TREX_TAIL} fill="url(#critter-vinyl)" />
      </Pivot>
      <Shaded d={tube([178, 312], [172, 334], [176, 354], 40, 26)} className={legs} />
      <Shaded d={tube([222, 312], [228, 334], [224, 354], 40, 26)} className={legs} />
      {shoe ? (
        <>
          <Foot at={[174, 364]} rx={22} ry={10} shoe={shoe} />
          <Foot at={[226, 364]} rx={22} ry={10} shoe={shoe} right />
        </>
      ) : (
        <>
          <DinoFoot at={[175, 361]} />
          <DinoFoot at={[225, 361]} right />
        </>
      )}
    </>
  ),
};

/** A bare monkey foot: a long peach sole with a little thumb-like big toe out to the side. */
function MonkeyFoot({ at, right }: { at: P; right?: boolean }) {
  const [x, y] = at;
  const side = right ? 1 : -1;
  const foot = (
    <g>
      <ellipse cx={x} cy={y} rx={20} ry={9} className="monkey-sole ol-thin" />
      <ellipse cx={x - side * 15} cy={y - 4} rx={6} ry={5} className="monkey-sole ol-thin" />
      <path d={`M${x - 4} ${y + 3} v 5 M${x + 4} ${y + 3} v 5 M${x + 12 * side} ${y + 2} v 5`} stroke="rgb(0 0 0 / 0.25)" strokeWidth="2" strokeLinecap="round" />
    </g>
  );
  return right ? <Pivot from={[236, 362]} to={at} part="boot">{foot}</Pivot> : foot;
}

/**
 * Monkey: a slim round top on thin furry legs, long peach feet (or the act's shoes) and a long thin tail
 * reaching out behind to the right and curling round at the tip.
 */
const monkey: Figure = {
  head: [190, 0.86],
  torso: 'M176 256 Q 200 248 224 256 Q 246 266 248 292 Q 250 314 244 326 Q 200 336 156 326 Q 150 314 152 292 Q 154 266 176 256 Z',
  shoulders: [[160, 274], [240, 274]],
  arm: 18,
  paw: 11,
  reach: 66,
  waist: [312, 46, 28],
  chin: [252, 46],
  Under: ({ legs, shoe }) => (
    <>
      <Pivot from={[268, 292]} to={[234, 318]} part="tail">
        <path d="M232 318 C 290 330, 316 300, 306 262 C 300 238, 270 238, 270 258 C 270 274, 292 274, 292 260" fill="none" className="limb-outline" strokeWidth="13" strokeLinecap="round" />
        <path d="M232 318 C 290 330, 316 300, 306 262 C 300 238, 270 238, 270 258 C 270 274, 292 274, 292 260" fill="none" className="monkey-tail" strokeWidth="8" strokeLinecap="round" />
      </Pivot>
      <Shaded d={tube([182, 316], [178, 338], [178, 356], 22, 18)} className={legs} />
      <Shaded d={tube([218, 316], [222, 338], [222, 356], 22, 18)} className={legs} />
      {shoe ? (
        <>
          <Foot at={[176, 364]} rx={20} ry={9} shoe={shoe} />
          <Foot at={[224, 364]} rx={20} ry={9} shoe={shoe} right />
        </>
      ) : (
        <>
          <MonkeyFoot at={[176, 362]} />
          <MonkeyFoot at={[224, 362]} right />
        </>
      )}
    </>
  ),
};

/** A bare gorilla foot: a broad dark leathery foot with four short toes. */
function GorillaFoot({ at, right }: { at: P; right?: boolean }) {
  const [x, y] = at;
  const foot = (
    <g>
      <ellipse cx={x} cy={y} rx={23} ry={10} className="gorilla-sole ol-thin" />
      {[-13, -4, 5, 14].map((dx) => (
        <ellipse key={dx} cx={x + dx} cy={y + 6} rx={4.4} ry={3.4} className="gorilla-sole ol-thin" />
      ))}
    </g>
  );
  return right ? <Pivot from={[236, 362]} to={at} part="boot">{foot}</Pivot> : foot;
}

/**
 * Gorilla: a big broad barrel of a top with the shoulders wide and high, thick long arms and big hands, short
 * sturdy legs and broad leathery feet (or the act's shoes). No tail.
 */
const gorilla: Figure = {
  head: [188, 0.86],
  torso: 'M168 252 Q 200 242 232 252 Q 264 262 266 292 Q 268 318 258 332 Q 200 344 142 332 Q 132 318 134 292 Q 136 262 168 252 Z',
  shoulders: [[148, 272], [252, 272]],
  arm: 30,
  paw: 16,
  reach: 70,
  waist: [318, 58, 26],
  chin: [252, 54],
  Under: ({ legs, shoe }) => (
    <>
      <g data-part="tail" />
      <Shaded d={tube([178, 318], [174, 340], [176, 356], 36, 32)} className={legs} />
      <Shaded d={tube([222, 318], [226, 340], [224, 356], 36, 32)} className={legs} />
      {shoe ? (
        <>
          <Foot at={[174, 364]} rx={23} ry={10} shoe={shoe} />
          <Foot at={[226, 364]} rx={23} ry={10} shoe={shoe} right />
        </>
      ) : (
        <>
          <GorillaFoot at={[175, 362]} />
          <GorillaFoot at={[225, 362]} right />
        </>
      )}
    </>
  ),
};

/** A flamingo's foot: three pink toes webbed together, fanning forward. */
function WebbedFoot({ at, right, className = 'bare', s = 1 }: { at: P; right?: boolean; className?: string; s?: number }) {
  const [x, y] = at;
  const foot = (
    <g transform={s === 1 ? undefined : `translate(${x} ${y}) scale(${s}) translate(${-x} ${-y})`}>
      <path d={`M${x} ${y - 6} L ${x - 18} ${y + 6} Q ${x - 12} ${y + 2} ${x - 6} ${y + 8} Q ${x} ${y + 3} ${x + 6} ${y + 8} Q ${x + 12} ${y + 2} ${x + 18} ${y + 6} Z`} className={`${className} ol-thin`} />
      <path d={`M${x} ${y - 4} L ${x - 10} ${y + 5} M${x} ${y - 4} V ${y + 5} M${x} ${y - 4} L ${x + 10} ${y + 5}`} stroke="rgb(0 0 0 / 0.22)" strokeWidth="2" strokeLinecap="round" />
    </g>
  );
  return right ? <Pivot from={[236, 362]} to={at} part="boot">{foot}</Pivot> : foot;
}

/**
 * Flamingo: a plump pink egg of a top on a short neck, long thin pink legs with knobbly knees, webbed feet (or
 * the act's shoes) and a little fan of tail feathers. Its arms are its wings, bare and pink with black
 * feathered tips for hands (`hand: 'wing'`, `.species-flamingo` in styles.css).
 */
const flamingo: Figure = {
  head: [170, 0.82],
  torso: 'M176 254 Q 200 246 224 254 Q 252 266 254 296 Q 254 320 244 330 Q 200 340 156 330 Q 146 320 146 296 Q 148 266 176 254 Z',
  shoulders: [[160, 276], [240, 276]],
  arm: 22,
  paw: 12,
  reach: 64,
  hand: 'wing',
  waist: [314, 50, 26],
  chin: [254, 30],
  Under: ({ legs, shoe }) => (
    <>
      <Pivot from={[268, 292]} to={[236, 318]} part="tail">
        {[-12, 0, 12].map((d) => (
          <path key={d} d={`M236 318 Q ${262 + d * 0.3} ${300 + d} ${276} ${306 + d * 1.6} Q ${262} ${318 + d * 0.6} 236 324 Z`} className="flamingo-tail ol-thin" />
        ))}
      </Pivot>
      <Shaded d={tube([186, 318], [186, 340], [184, 358], 13, 9)} className={legs} />
      <Shaded d={tube([214, 318], [214, 340], [216, 358], 13, 9)} className={legs} />
      {legs === 'bare' && (
        <>
          <ellipse cx="186" cy="340" rx="7" ry="5" className="bare ol-thin" />
          <ellipse cx="214" cy="340" rx="7" ry="5" className="bare ol-thin" />
        </>
      )}
      {shoe ? (
        <>
          <Foot at={[180, 364]} rx={17} ry={8} shoe={shoe} />
          <Foot at={[220, 364]} rx={17} ry={8} shoe={shoe} right />
        </>
      ) : (
        <>
          <WebbedFoot at={[182, 362]} />
          <WebbedFoot at={[218, 362]} right />
        </>
      )}
      {/* the neck, up into the head */}
      <path d={tube([200, 214], [204, 236], [200, 258], 30, 38)} className="bare ol" />
      <path d="M190 236 Q 200 240 212 236 M192 246 Q 200 250 210 246" fill="none" stroke="rgb(0 0 0 / 0.14)" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
};

/** The usual round top, shared by most of the later critters. */
const ROUND_TOP = 'M174 256 Q 200 248 226 256 Q 248 264 250 290 Q 252 312 246 324 Q 200 334 154 324 Q 148 312 150 290 Q 152 264 174 256 Z';

/**
 * A figure on the usual round top: legs `leg` wide (top, ankle), the species' own bare feet (`Foot`, or the act's
 * shoes), and optionally a tail (drawn about its root `tailAt`, swaying with the rig) and things behind the top
 * (`Back`: wings).
 */
const roundFigure = ({
  Bare,
  Tail,
  tailAt = [236, 320],
  Back,
  leg = [26, 22],
  socks,
  ...f
}: Partial<Figure> & { Bare: (p: { at: P; right?: boolean }) => ReactNode; socks?: boolean; Tail?: () => ReactNode; tailAt?: P; Back?: () => ReactNode; leg?: [number, number] }): Figure => ({
  head: [190, 0.86],
  torso: ROUND_TOP,
  shoulders: [[158, 274], [242, 274]],
  arm: 21,
  paw: 12,
  reach: 64,
  waist: [312, 48, 28],
  chin: [252, 46],
  ...f,
  Under: ({ legs, shoe }) => (
    <>
      {Back?.()}
      {Tail ? (
        <Pivot from={[268, 292]} to={tailAt} part="tail">
          <Tail />
        </Pivot>
      ) : (
        <g data-part="tail" />
      )}
      <Shaded d={tube([180, 314], [177, 336], [176, 356], leg[0], leg[1])} className={legs} />
      <Shaded d={tube([220, 314], [223, 336], [224, 356], leg[0], leg[1])} className={legs} />
      {socks && legs === 'bare' && <LegMarks />}
      {shoe ? (
        <>
          <Foot at={[174, 364]} rx={20} ry={10} shoe={shoe} />
          <Foot at={[226, 364]} rx={20} ry={10} shoe={shoe} right />
        </>
      ) : (
        <>
          <Bare at={[175, 362]} />
          <Bare at={[225, 362]} right />
        </>
      )}
    </>
  ),
});
/** Dark stockings on bare legs, for species that have them (`.leg-sock`, coloured per species in styles.css). */
function LegMarks() {
  return (
    <>
      <path d={tube([177, 340], [176, 348], [176, 356], 23, 22)} className="leg-sock" />
      <path d={tube([223, 340], [224, 348], [224, 356], 23, 22)} className="leg-sock" />
    </>
  );
}

/** A round bare paw in a class colour, with two toe creases. */
const softPaw =
  (className: string) =>
  ({ at, right }: { at: P; right?: boolean }) => {
    const [x, y] = at;
    const paw = (
      <g>
        <ellipse cx={x} cy={y} rx={19} ry={10} className={`${className} ol-thin`} />
        <path d={`M${x - 6} ${y + 2} v 7 M${x + 6} ${y + 2} v 7`} stroke="rgb(0 0 0 / 0.3)" strokeWidth="2" strokeLinecap="round" />
      </g>
    );
    return right ? <Pivot from={[236, 362]} to={at} part="boot">{paw}</Pivot> : paw;
  };

/**
 * Penguin: a plump round top, short black legs, orange webbed feet and a little black tail. Its arms are flippers:
 * no hands, the arm runs on into a long flat paddle with a pale underside (`hand: 'flipper'`).
 */
const penguin = roundFigure({
  head: [188, 0.88],
  torso: 'M174 254 Q 200 246 226 254 Q 254 266 256 296 Q 256 322 246 332 Q 200 342 154 332 Q 144 322 144 296 Q 146 266 174 254 Z',
  shoulders: [[156, 276], [244, 276]],
  arm: 22,
  fore: 20,
  paw: 10,
  hand: 'flipper',
  leg: [22, 18],
  waist: [316, 54, 26],
  chin: [252, 48],
  Bare: (p) => <WebbedFoot {...p} className="penguin-foot" s={1.15} />,
  tailAt: [200, 330],
  Tail: () => <path d="M190 326 L 200 350 L 210 326 Z" className="bare ol-thin" />,
});

const FOX_TAIL = 'M232 320 C 290 340, 334 310, 330 262 C 328 236, 306 226, 296 240 C 308 268, 290 300, 236 306 Z';
/** Fox: the round top, dark stockings and paws, and a big bushy orange tail with a white tip curling up behind. */
const fox = roundFigure({
  leg: [24, 20],
  socks: true,
  Bare: softPaw('fox-paw'),
  Tail: () => (
    <>
      <defs>
        <clipPath id="critter-fox-tail">
          <path d={FOX_TAIL} />
        </clipPath>
      </defs>
      <path d={FOX_TAIL} className="bare ol" />
      <g clipPath="url(#critter-fox-tail)">
        <ellipse cx="316" cy="240" rx="22" ry="20" className="fox-tip" />
      </g>
      <path d={FOX_TAIL} fill="url(#critter-vinyl)" />
    </>
  ),
});

/** Axolotl: a chubby round top on short pink legs, little four-toed feet and a long tail with a soft fin. */
const axolotl = roundFigure({
  head: [190, 0.86],
  leg: [24, 22],
  Bare: ({ at, right }) => {
    const [x, y] = at;
    const foot = (
      <g>
        {[-12, -4, 4, 12].map((dx) => (
          <ellipse key={dx} cx={x + dx} cy={y + 2} rx={5} ry={7} transform={`rotate(${dx * 2} ${x + dx} ${y + 2})`} className="bare ol-thin" />
        ))}
        <ellipse cx={x} cy={y - 2} rx={15} ry={7} className="bare" />
      </g>
    );
    return right ? <Pivot from={[236, 362]} to={at} part="boot">{foot}</Pivot> : foot;
  },
  tailAt: [232, 330],
  Tail: () => (
    <>
      <path d="M226 326 C 262 318, 300 330, 338 352 C 312 352, 290 350, 268 346 C 252 344, 238 342, 226 344 Z" className="axolotl-fin ol-thin" />
      <path d={tube([226, 336], [282, 334], [334, 350], 18, 4)} className="bare ol-thin" />
    </>
  ),
});

/** Sloth: a shaggy round top, long arms with three-clawed hands, short legs, clawed feet and no tail to speak of. */
const sloth = roundFigure({
  arm: 19,
  paw: 11,
  reach: 68,
  hand: 'claws',
  leg: [24, 20],
  Bare: DinoFoot,
  move: 'late',
});

/** One octopus tentacle from under the top out along the floor, curling at the tip, with suckers. */
function Tentacle({ to, curl }: { to: P; curl: number }) {
  const [x, y] = to;
  const d = tube([200 + (x - 200) * 0.25, 318], [200 + (x - 200) * 0.75, 350], [x, y], 18, 7);
  return (
    <g>
      <path d={d} className="bare ol-thin" />
      <path d={`M${x} ${y} q ${curl * 10} -4 ${curl * 8} -12 q -2 -6 ${-curl * 6} -2`} fill="none" className="tentacle-tip" strokeWidth="7" strokeLinecap="round" />
      <circle cx={200 + (x - 200) * 0.6} cy={y - 2} r="2.4" className="sucker" />
      <circle cx={200 + (x - 200) * 0.82} cy={y - 1} r="2" className="sucker" />
    </g>
  );
}

/**
 * Two more tentacles reaching out and up from behind the top's sides, curling at the tips (`tentacle-l` /
 * `tentacle-r`, which the rig waves with the music). Acts that give the octopus more to hold (the Drummer's
 * extra sticks) hide these (`.octo-arms`) and draw their own.
 */
function OctoArms() {
  return (
    <g className="octo-arms">
      {[false, true].map((r) => (
        <g key={String(r)} transform={r ? 'translate(400 0) scale(-1 1)' : undefined}>
          <g data-part={r ? 'tentacle-r' : 'tentacle-l'}>
            <path d={tube([160, 300], [118, 304], [100, 262], 16, 7)} className="bare ol-thin" />
            <path d="M100 262 q -2 -12 8 -14 q 6 0 4 6" fill="none" className="tentacle-tip" strokeWidth="7" strokeLinecap="round" />
            <circle cx="122" cy="300" r="2.2" className="sucker" />
            <circle cx="108" cy="286" r="2" className="sucker" />
          </g>
        </g>
      ))}
    </g>
  );
}

/**
 * Octopus: a round top on six tentacles fanning out along the floor and curling at the tips, no legs or shoes. Its
 * arms are two more tentacles, tapering to a soft tip, and two more reach out from behind its sides (`OctoArms`),
 * so it plays with four.
 */
const octopus: Figure = {
  head: [182, 0.86],
  torso: 'M176 258 Q 200 250 224 258 Q 246 268 248 292 Q 250 314 242 326 Q 200 334 158 326 Q 150 314 152 292 Q 154 268 176 258 Z',
  shoulders: [[160, 276], [240, 276]],
  arm: 18,
  fore: 11,
  paw: 8,
  reach: 66,
  waist: [312, 46, 26],
  chin: [252, 44],
  Under: () => (
    <>
      <OctoArms />
      <g data-part="tail">
        {([[128, 362, -1], [152, 370, -1], [178, 374, -1], [222, 374, 1], [248, 370, 1], [272, 362, 1]] as const).map(([x, y, c]) => (
          <Tentacle key={x} to={[x, y]} curl={c} />
        ))}
      </g>
      <g data-part="boot" />
    </>
  ),
};

/** The dragon's left wing (the right is its mirror): a little bat wing behind the shoulder, three scalloped ribs. */
const DRAGON_WING = 'M178 270 C 150 236, 118 222, 96 228 C 106 238, 108 248, 104 258 C 116 254, 124 260, 124 270 C 136 264, 146 270, 148 280 Z';

/** Dragon: the round top with little wings behind it, sturdy legs, clawed feet and a spiky tail with an arrowhead tip. */
const dragon = roundFigure({
  leg: [28, 24],
  hand: 'claws',
  Bare: DinoFoot,
  Back: () => (
    <g className="dragon-wings">
      {[false, true].map((r) => (
        <g key={String(r)} transform={r ? 'translate(400 0) scale(-1 1)' : undefined}>
          <path d={DRAGON_WING} className="dragon-wing ol" />
          <path d="M178 270 L 104 232 M176 274 L 112 258 M170 278 L 128 270" stroke="rgb(0 0 0 / 0.25)" strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>
      ))}
    </g>
  ),
  Tail: () => (
    <>
      {[[258, 322], [282, 316], [304, 302]].map(([x, y]) => (
        <path key={x} d={`M${x - 7} ${y} L ${x} ${y - 14} L ${x + 7} ${y} Z`} className="dragon-spine ol-thin" />
      ))}
      <path d={tube([230, 322], [300, 332], [316, 282], 18, 9)} className="bare ol" />
      <path d="M316 284 L 304 274 L 318 256 L 330 276 Z" className="dragon-spine ol-thin" />
    </>
  ),
});

/** Frog: a round top on short bent green legs and big webbed feet; no tail. It hops on the beat. */
const frog = roundFigure({
  head: [188, 0.88],
  leg: [28, 22],
  Bare: (p) => <WebbedFoot {...p} s={1.35} />,
  move: 'hop',
});

/** Bunny: a round top on short legs, long flat feet with pink pads, and a fluffy white puff of a tail. */
const bunny = roundFigure({
  leg: [24, 22],
  Bare: ({ at, right }) => {
    const [x, y] = at;
    const foot = (
      <g>
        <ellipse cx={x} cy={y} rx={24} ry={9} className="bare ol-thin" />
        <ellipse cx={x} cy={y + 2} rx={8} ry={4} className="bunny-pad" />
      </g>
    );
    return right ? <Pivot from={[236, 362]} to={at} part="boot">{foot}</Pivot> : foot;
  },
  tailAt: [240, 318],
  Tail: () => <circle cx="254" cy="318" r="15" className="bunny-tail ol-thin" />,
});

const RED_PANDA_TAIL = 'M234 340 C 314 344, 348 300, 342 250 C 338 214, 310 200, 296 218 C 316 240, 314 284, 260 304 Z';
/** Red panda: the round top on short dark legs, dark paws and a big bushy tail with pale rings. */
const redPanda = roundFigure({
  Bare: softPaw('bare'),
  tailAt: [234, 330],
  Tail: () => (
    <>
      <defs>
        <clipPath id="critter-red-panda-tail">
          <path d={RED_PANDA_TAIL} />
        </clipPath>
      </defs>
      <path d={RED_PANDA_TAIL} className="red-panda-tail ol" />
      <g clipPath="url(#critter-red-panda-tail)">
        <path d="M248 336 C 306 336, 336 296, 332 254 C 330 230, 316 214, 304 218" fill="none" className="red-panda-ring" strokeWidth="40" strokeDasharray="12 18" />
      </g>
      <path d={RED_PANDA_TAIL} fill="url(#critter-vinyl)" />
    </>
  ),
});

/** One tail feather of the turkey's fan (pointing straight up from its root at 200,300; the rest are turned copies). */
const TURKEY_FEATHER = 'M200 300 C 178 264, 176 190, 186 156 Q 200 138 214 156 C 224 190, 222 264, 200 300 Z';

/**
 * Turkey: the round top with a big fan of tail feathers spread behind it, maroon and orange in turn with pale
 * tips, thin orange legs and three-toed orange feet. Its arms are wings, with feathered tips (`hand: 'wing'`).
 */
const turkey = roundFigure({
  hand: 'wing',
  leg: [16, 12],
  Bare: (p) => <WebbedFoot {...p} className="turkey-foot" s={1.2} />,
  Back: () => (
    <g className="turkey-fan">
      {[-84, -63, -42, -21, 0, 21, 42, 63, 84].map((r, i) => (
        <g key={r} transform={`rotate(${r} 200 300)`}>
          <path d={TURKEY_FEATHER} className={i % 2 ? 'turkey-feather-alt ol' : 'turkey-feather ol'} />
          <path d="M187 160 Q 200 140 213 160 Q 200 172 187 160 Z" className="turkey-tip" />
          <path d="M200 296 V160" stroke="rgb(0 0 0 / 0.2)" strokeWidth="2" />
        </g>
      ))}
    </g>
  ),
});

/** The opossum's bare tail beyond its dark furry base: out to the right, up, and hooked round at the tip. */
const OPOSSUM_TAIL = 'M282 318 C 314 310, 330 288, 324 262 C 318 240, 292 238, 290 256 C 288 270, 304 276, 310 264';

/**
 * Opossum: the round top on short dark legs, pink paws, and a long bare pink tail (dark and furry at the base,
 * faintly scaled) reaching out behind and hooking round at the tip.
 */
const opossum = roundFigure({
  Bare: softPaw('opossum-paw'),
  tailAt: [232, 322],
  Tail: () => (
    <>
      <path d={OPOSSUM_TAIL} fill="none" className="limb-outline" strokeWidth="15" strokeLinecap="round" />
      <path d={OPOSSUM_TAIL} fill="none" className="opossum-tail" strokeWidth="10" strokeLinecap="round" />
      <path d={OPOSSUM_TAIL} fill="none" className="opossum-scales" strokeWidth="10" strokeDasharray="1.6 7" />
      <Shaded d={tube([226, 320], [256, 328], [286, 317], 22, 13)} className="opossum-tail-base" />
    </>
  ),
});

/** Capybara: a chunky round top on short sturdy legs, dark round paws and no tail to speak of. */
const capybara = roundFigure({
  head: [190, 0.88],
  arm: 22,
  leg: [28, 24],
  Bare: softPaw('capybara-paw'),
});

const CROC_TAIL = 'M214 316 C 252 314, 292 326, 320 344 C 338 354, 356 352, 364 336 C 368 350, 356 370, 330 370 C 292 370, 252 360, 214 350 Z';
/**
 * Crocodile: the round top on sturdy legs, broad clawed feet and two-clawed hands, and a long thick tail sweeping
 * out along the ground to the right, with a row of pointed scutes down it.
 */
const crocodile = roundFigure({
  hand: 'claws',
  leg: [28, 24],
  Bare: DinoFoot,
  tailAt: [226, 330],
  Tail: () => (
    <>
      <defs>
        <clipPath id="critter-croc-tail">
          <path d={CROC_TAIL} />
        </clipPath>
      </defs>
      {[[244, 318], [270, 324], [296, 334], [320, 346], [342, 352]].map(([x, y], i) => (
        <path key={x} d={`M${x - 8 + i} ${y + 2} L ${x} ${y - 12 + i * 2} L ${x + 8 - i} ${y + 2} Z`} className="croc-scute ol-thin" />
      ))}
      <path d={CROC_TAIL} className="bare ol" />
      <g clipPath="url(#critter-croc-tail)">
        <path d="M214 352 C 252 360, 292 368, 334 364 L 340 380 L 214 380 Z" className="croc-belly" />
      </g>
      <path d={CROC_TAIL} fill="url(#critter-vinyl)" />
    </>
  ),
});

const DOLPHIN_BODY = 'M152 234 C 144 264 154 294 170 316 C 182 332 190 348 193 364 L 207 364 C 210 348 218 332 230 316 C 246 294 256 264 248 234 Z';
const DOLPHIN_FLUKES = 'M200 360 C 186 352 164 352 140 362 C 156 374 180 378 200 372 C 220 378 244 374 260 362 C 236 352 214 352 200 360 Z';

/**
 * Dolphin: like the shark, one smooth body from the head down to the tail with no legs, but plumper, with a
 * pale belly, a and broad flukes out flat. Its arms are flippers
 * (`hand: 'flipper'`); clothes are an open vest.
 */
const dolphin: Figure = {
  head: [204, 0.74],
  torso: DOLPHIN_BODY,
  shoulders: [[156, 262], [244, 262]],
  arm: 18,
  fore: 16,
  paw: 9,
  reach: 60,
  hand: 'flipper',
  waist: [294, 34, 30],
  chin: [244, 38],
  Under: () => (
    <>
      <Pivot from={[268, 292]} to={[200, 362]} part="tail">
        <Shaded d={DOLPHIN_FLUKES} className="dolphin-skin" />
      </Pivot>
      <g data-part="boot" />
    </>
  ),
  Top: () => <Shaded d={DOLPHIN_BODY} className="dolphin-skin" />,
  Skin: () => (
    <>
      <path className="dolphin-belly" d="M174 240 Q 200 262 226 240 Q 226 292 214 326 Q 206 348 200 364 Q 194 348 186 326 Q 174 292 174 240 Z" />
      <path className="top ol" d="M159 240 C 157 268 162 292 171 306 L 186 296 L 182 254 Z" />
      <path className="top ol" d="M241 240 C 243 268 238 292 229 306 L 214 296 L 218 254 Z" />
    </>
  ),
};

/** Goat: the round top on slim legs, cloven hooves and a short tuft of a tail that sticks up. */
const goat = roundFigure({
  leg: [22, 18],
  Bare: Hoof,
  tailAt: [236, 312],
  Tail: () => <path d="M230 316 C 234 302, 246 294, 256 296 C 254 306, 246 314, 236 320 Z" className="bare ol-thin" />,
});

/** One of the peacock's long train feathers (pointing straight up from its root at 200,300; the rest are turned copies). */
const PEACOCK_FEATHER = 'M200 300 C 190 250, 180 170, 184 128 C 186 104, 214 104, 216 128 C 220 170, 210 250, 200 300 Z';

/**
 * Peacock: the round top on thin grey legs and three-toed feet, wings for arms (`hand: 'wing'`), and a great fan
 * of train feathers behind it, each with an eye at the tip, over a shorter fan of green ones. The fan is the `fan`
 * part, which opens wider on the beat and spreads right out on a flourish (rig.ts).
 */
const peacock = roundFigure({
  hand: 'wing',
  leg: [14, 10],
  Bare: (p) => <WebbedFoot {...p} className="peacock-foot" s={1.1} />,
  Back: () => (
    <g className="peacock-fan" data-part="fan">
      {Array.from({ length: 11 }, (_, i) => -70 + i * 14).map((r) => (
        <g key={r} transform={`rotate(${r} 200 300) translate(0 -8)`}>
          <path d={PEACOCK_FEATHER} className="peacock-feather ol-thin" />
          <ellipse cx="200" cy="124" rx="13" ry="16" className="peacock-eye-gold" />
          <ellipse cx="200" cy="126" rx="9" ry="11" className="peacock-eye-teal" />
          <ellipse cx="200" cy="128" rx="5" ry="6" className="peacock-eye-navy" />
          <path d="M200 296 V140" stroke="rgb(0 0 0 / 0.18)" strokeWidth="1.6" />
        </g>
      ))}
      {Array.from({ length: 9 }, (_, i) => -64 + i * 16).map((r) => (
        <g key={r} transform={`rotate(${r} 200 300) translate(0 40)`}>
          <path d={PEACOCK_FEATHER} className="peacock-feather-short ol-thin" />
        </g>
      ))}
    </g>
  ),
});

/** The pangolin's armour seen from the front: rows of big bronze scales behind the top, wider than it, so they show round its sides. */
const PANGOLIN_ARMOUR = [334, 312, 290, 268, 250].flatMap((y, row) => {
  const n = [7, 8, 7, 6, 5][row];
  const half = [50, 60, 60, 54, 40][row];
  return Array.from({ length: n }, (_, i) => scale(200 - half + (i * 2 * half) / (n - 1), y, 28, 28));
});
/** The pangolin's tail: overlapping scales along a curve out to the right, from the tip back to the root, each turned to point down the tail. */
const PANGOLIN_TAIL = Array.from({ length: 10 }, (_, k) => {
  const t = 1 - k / 9;
  const x = (1 - t) ** 2 * 222 + 2 * (1 - t) * t * 296 + t * t * 344;
  const y = (1 - t) ** 2 * 330 + 2 * (1 - t) * t * 330 + t * t * 362;
  const dx = 2 * (1 - t) * (296 - 222) + 2 * t * (344 - 296);
  const dy = 2 * (1 - t) * (330 - 330) + 2 * t * (362 - 330);
  const turn = (Math.atan2(dy, dx) * 180) / Math.PI - 90;
  const w = 34 - t * 20;
  return { d: scale(x, y - w * 0.5, w, w), turn: `rotate(${turn.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})` };
});

/**
 * Pangolin: the round top in front of rows of big bronze scales that show round its sides (like the turtle's
 * shell), short legs, broad clawed feet, two-clawed hands for digging, and a long, thick tail of overlapping
 * scales lying out to the right.
 */
const pangolin = roundFigure({
  hand: 'claws',
  leg: [26, 22],
  Bare: DinoFoot,
  Back: () => (
    <g className="pangolin-armour">
      {PANGOLIN_ARMOUR.map((d, i) => (
        <path key={i} d={d} className="pangolin-scale ol-thin" />
      ))}
    </g>
  ),
  tailAt: [226, 330],
  Tail: () => (
    <>
      {PANGOLIN_TAIL.map(({ d, turn }, i) => (
        <path key={i} d={d} transform={turn} className="pangolin-scale ol-thin" />
      ))}
    </>
  ),
});

/** The bat's left wing (the right is its mirror): a wide membrane from the shoulder, scalloped between three finger bones. */
const BAT_WING = 'M170 272 C 140 236, 98 214, 54 216 C 60 232, 58 248, 50 262 C 70 258, 86 266, 90 282 C 104 274, 120 278, 126 292 C 140 286, 156 290, 166 300 Z';

/**
 * Bat: the round top with big membrane wings spread behind it (`wing-l` / `wing-r`, flapping on the beat, rig.ts;
 * hidden under the hazmat suit, `.bat-wings`), short legs, little clawed feet and no tail.
 */
const bat = roundFigure({
  leg: [20, 16],
  Bare: softPaw('bat-foot'),
  Back: () => (
    <g className="bat-wings">
      {[false, true].map((r) => (
        <g key={String(r)} transform={r ? 'translate(400 0) scale(-1 1)' : undefined}>
          <g data-part={r ? 'wing-r' : 'wing-l'}>
            <path d={BAT_WING} className="bat-wing ol" />
            <path d="M168 274 L 56 218 M164 280 L 90 280 M162 286 L 126 290" stroke="rgb(0 0 0 / 0.3)" strokeWidth="2.4" fill="none" strokeLinecap="round" />
            <path d="M56 218 l -6 -8" className="bat-thumb" strokeWidth="3" strokeLinecap="round" />
          </g>
        </g>
      ))}
    </g>
  ),
});

/** A polar bear's bare foot: a big furry white paw with a black pad and four toe beans. */
function PolarPaw({ at, right }: { at: P; right?: boolean }) {
  const [x, y] = at;
  const paw = (
    <g>
      <ellipse cx={x} cy={y} rx={24} ry={11} className="bare ol-thin" />
      <ellipse cx={x} cy={y + 3} rx={9} ry={4.5} className="polar-pad" />
      {[-13, -5, 5, 13].map((dx) => (
        <circle key={dx} cx={x + dx} cy={y - 4} r={2.6} className="polar-pad" />
      ))}
    </g>
  );
  return right ? <Pivot from={[236, 362]} to={at} part="boot">{paw}</Pivot> : paw;
}

/**
 * Polar bear: bigger than the other bears, a broad top with the shoulders set wide, long sturdy legs, huge furry
 * paws with black pads (or the act's shoes) and a stubby round tail.
 */
const polarBear: Figure = {
  head: [188, 0.86],
  torso: 'M172 254 Q 200 246 228 254 Q 254 262 258 290 Q 260 316 252 328 Q 200 340 148 328 Q 140 316 142 290 Q 146 262 172 254 Z',
  shoulders: [[154, 276], [246, 276]],
  arm: 26,
  paw: 14,
  reach: 66,
  waist: [316, 54, 30],
  chin: [252, 50],
  Under: ({ legs, shoe }) => (
    <>
      <Pivot from={[268, 292]} to={[240, 322]} part="tail">
        <circle cx="248" cy="322" r="11" className="bare ol-thin" />
      </Pivot>
      <Shaded d={tube([180, 316], [176, 338], [176, 356], 32, 28)} className={legs} />
      <Shaded d={tube([220, 316], [224, 338], [224, 356], 32, 28)} className={legs} />
      {shoe ? (
        <>
          <Foot at={[174, 364]} rx={22} ry={10} shoe={shoe} />
          <Foot at={[226, 364]} rx={22} ry={10} shoe={shoe} right />
        </>
      ) : (
        <>
          <PolarPaw at={[174, 362]} />
          <PolarPaw at={[226, 362]} right />
        </>
      )}
    </>
  ),
};

/**
 * How far each head sits down into its top from where the figures above place it: the chin tucks over the
 * collar so the head reads as sitting on a neck, not floating over the shoulders. The chin's shadow comes down
 * with it.
 */
export const NECK_DROP = 10;

const seat = (f: Figure, drop = NECK_DROP): Figure => ({ ...f, head: [f.head[0] + drop, f.head[1]], chin: [f.chin[0] + drop, f.chin[1]] });

export const FIGURES = {
  raccoon: seat(raccoon),
  bear: seat(bear),
  shark: seat(shark),
  alien: seat(alien(202, [226, 262, 30])),
  grey: seat(alien(186, [226, 254, 12])),
  moose: seat(moose),
  turtle: seat(turtle),
  tiger: seat(bigCat(TigerTail)),
  lion: seat(bigCat(LionTail)),
  elephant: seat(elephant),
  panda: seat(panda),
  owl: seat(owl),
  trex: seat(trex),
  monkey: seat(monkey),
  gorilla: seat(gorilla),
  flamingo: seat(flamingo),
  penguin: seat(penguin),
  fox: seat(fox),
  axolotl: seat(axolotl),
  sloth: seat(sloth),
  octopus: seat(octopus),
  dragon: seat(dragon),
  frog: seat(frog),
  bunny: seat(bunny),
  redPanda: seat(redPanda),
  turkey: seat(turkey),
  opossum: seat(opossum),
  capybara: seat(capybara),
  crocodile: seat(crocodile),
  dolphin: seat(dolphin),
  goat: seat(goat),
  peacock: seat(peacock),
  pangolin: seat(pangolin),
  bat: seat(bat),
  polarBear: seat(polarBear),
} satisfies Record<string, Figure>;
