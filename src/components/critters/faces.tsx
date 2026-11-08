import { createContext, useContext, type ReactNode } from 'react';
import { Mouth } from './parts';

/**
 * The six faces in the "vinyl toy" style (docs/CRITTERS-ROADMAP.md, phase 3): soft shading from the upper
 * left, a dark outline, a rim of stage light on the right edge (`.rim`, the skin's `--viz-high`) and big eyes
 * with a coloured iris and two highlights.
 *
 * Each face is drawn in its own art frame (the style-frame drawings in docs/critters/) and placed on the
 * shared skeleton by `Placed`: the head scaled to fit about 200,178, with the eyes on y 166–190.
 *
 * Every face has the same named parts, which the rig (rig.ts) moves: `eyes` (blinks and squints), `brow-l` /
 * `brow-r`, `smile` (the closed mouth, hidden while singing) and `yawn` (the singing mouth, `Mouth` in
 * parts.tsx). Species details are optional parts: `whisker-l` / `whisker-r` and `snarl` (raccoon), `ear-l` /
 * `ear-r` (raccoon, bears), `[data-shine]` eye shines and `[data-voice-glow]` antennae (alien). They all move
 * about their own box (styles.css), so where they sit inside the art frame doesn't matter to the rig.
 */

/** The art frame → the skeleton: centre (`cx`, `cy`) of the drawing goes to 200,178, scaled by `s`. */
function Placed({ cx, cy, s, children }: { cx: number; cy: number; s: number; children: ReactNode }) {
  return <g transform={`translate(200 178) scale(${s}) translate(${-cx} ${-cy})`}>{children}</g>;
}

/** Shading for a part: lit at the upper left, darker away from it. */
function Shade({ id, hi, mid, lo }: { id: string; hi: string; mid?: string; lo: string }) {
  return (
    <radialGradient id={id} cx="0.38" cy="0.28" r="0.85">
      <stop offset="0" style={{ stopColor: hi }} />
      {mid && <stop offset="0.6" style={{ stopColor: mid }} />}
      <stop offset="1" style={{ stopColor: lo }} />
    </radialGradient>
  );
}

/**
 * The head's silhouette `d`, drawn filled and outlined, with `inside` clipped to it and a rim of light on its
 * right edge (the shape minus a copy shifted left).
 */
function HeadShape({ id, d, fill, children }: { id: string; d: string; fill: string; children?: ReactNode }) {
  return (
    <>
      <defs>
        <path id={`head-${id}`} d={d} />
        <clipPath id={`clip-head-${id}`}>
          <use href={`#head-${id}`} />
        </clipPath>
        <mask id={`rim-head-${id}`}>
          <use href={`#head-${id}`} fill="#fff" />
          <use href={`#head-${id}`} fill="#000" transform="translate(-7 3)" />
        </mask>
      </defs>
      <use href={`#head-${id}`} fill={fill} className="ol" />
      <g clipPath={`url(#clip-head-${id})`}>{children}</g>
      <use href={`#head-${id}`} className="rim" mask={`url(#rim-head-${id})`} />
    </>
  );
}

/** A round eye: white, iris, pupil, a big highlight (widens on loud notes, rig) and a small one. `k` narrows the far eye. */
function Eye({ cx, cy, r, iris, k = 1 }: { cx: number; cy: number; r: number; iris: string; k?: number }) {
  const rx = r * k;
  return (
    <>
      <ellipse cx={cx} cy={cy} rx={rx} ry={r} fill="#fff" className="ol-thin" />
      <ellipse cx={cx + 3 * k} cy={cy + 1} rx={rx * 0.74} ry={r * 0.74} fill={iris} />
      <ellipse cx={cx + 3 * k} cy={cy + 1} rx={rx * 0.53} ry={r * 0.53} fill="#0b0b10" />
      <circle data-shine="" cx={cx + 8 * k} cy={cy - 5} r={r * 0.25} fill="#fff" />
      <circle cx={cx - 2 * k} cy={cy + 7} r={r * 0.1} fill="#fff" />
    </>
  );
}

/**
 * Two brows (`brow-l`, `brow-r`). The right one is the left's mirror about `mid`, drawn in a mirrored group so
 * the rig gives both the same rotation and they tilt as a pair (as `Brows` in parts.tsx).
 */
function Pair({ l, mid, stroke, width = 4 }: { l: string; mid: number; stroke: string; width?: number }) {
  return (
    <g className="brows" fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round">
      <path data-part="brow-l" d={l} />
      <g transform={`translate(${2 * mid} 0) scale(-1 1)`}>
        <path data-part="brow-r" d={l} />
      </g>
    </g>
  );
}

const INK = '#24170f';

/** Draw the girl version: lashes on the eyes, and a bow on the head (`Head`). */
export const GirlContext = createContext(false);

/**
 * Three lashes fanning up and out from each eye's outer top corner (`l`, `r`, in the face's art frame), drawn
 * inside the `eyes` group so they blink with the lids.
 */
function Lashes({ l, r, s = 1 }: { l: [number, number]; r: [number, number]; s?: number }) {
  if (!useContext(GirlContext)) return null;
  const fan = ([x, y]: [number, number], side: number) =>
    [[0, 0, -1, -0.45], [7, -6, -0.75, -1], [15, -9, -0.3, -1.15]]
      .map(([bx, by, dx, dy]) => {
        const x0 = x - side * bx * s;
        const y0 = y + by * s;
        const len = 10 * s;
        return `M${x0.toFixed(1)} ${y0.toFixed(1)} q ${(side * dx * len * 0.4).toFixed(1)} ${(dy * len * 0.7).toFixed(1)} ${(side * dx * len).toFixed(1)} ${(dy * len).toFixed(1)}`;
      })
      .join(' ');
  return <path className="lashes" d={`${fan(l, 1)} ${fan(r, -1)}`} fill="none" strokeWidth={3 * s} strokeLinecap="round" />;
}

/** A bow at `x`,`y` on the head skeleton (species `fit.bow`, drawn by `Head` over any hat), tilted `rot` degrees, in the skin's accent. */
export function Bow({ x, y, rot = -20, s = 1, alt }: { x: number; y: number; rot?: number; s?: number; alt?: boolean }) {
  if (!useContext(GirlContext)) return null;
  return (
    <g className={alt ? 'girl-bow bow-alt' : 'girl-bow'} transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`}>
      <path className="bow ol-thin" d="M0 0 C -10 -16, -32 -18, -32 0 C -32 18, -10 16, 0 0 Z M0 0 C 10 -16, 32 -18, 32 0 C 32 18, 10 16, 0 0 Z" />
      <path d="M0 0 C -10 -16, -32 -18, -32 0 C -32 18, -10 16, 0 0 Z M0 0 C 10 -16, 32 -18, 32 0 C 32 18, 10 16, 0 0 Z" fill="url(#critter-vinyl)" />
      <path d="M-22 -4 Q -14 0 -6 -2 M22 -4 Q 14 0 6 -2" fill="none" stroke="rgb(0 0 0 / 0.25)" strokeWidth="2" strokeLinecap="round" />
      <ellipse className="bow-knot ol-thin" cx="0" cy="0" rx="7" ry="8" />
    </g>
  );
}

export function RaccoonFace() {
  return (
    <Placed cx={204} cy={168} s={0.84}>
      <defs>
        <Shade id="rc-fur" hi="#a9a9b5" mid="#8a8a96" lo="#5f5f6b" />
        <Shade id="rc-light" hi="#fbfbfd" lo="#c9c9d3" />
        <Shade id="rc-mask" hi="#3a3a44" lo="#1c1c22" />
      </defs>
      {/* ears bounce on the beat and flick on accents (rig) */}
      <g data-part="ear-l">
        <g transform="rotate(-18 130 104)">
          <ellipse cx="130" cy="104" rx="26" ry="28" fill="url(#rc-fur)" className="ol" />
          <ellipse cx="132" cy="107" rx="18" ry="21" fill="#e9e4e6" />
          <ellipse cx="134" cy="110" rx="11" ry="14" fill="#4a3c40" />
        </g>
      </g>
      <g data-part="ear-r">
        <g transform="rotate(18 280 104)">
          <ellipse cx="280" cy="104" rx="24" ry="27" fill="url(#rc-fur)" className="ol" />
          <ellipse cx="278" cy="107" rx="16" ry="20" fill="#e9e4e6" />
          <ellipse cx="276" cy="110" rx="10" ry="13" fill="#4a3c40" />
        </g>
      </g>
      <HeadShape
        id="raccoon"
        fill="url(#rc-fur)"
        d="M204 80 C 258 80, 290 116, 290 154 Q 302 164 314 178 Q 302 184 306 192 Q 296 194 300 202 Q 286 204 280 214 C 266 240, 238 252, 206 252 C 172 252, 142 240, 130 214 Q 122 204 108 202 Q 112 194 102 192 Q 106 184 92 178 Q 106 164 118 154 C 118 116, 150 80, 204 80 Z"
      >
        {/* fur strokes on the crown */}
        <path d="M188 98 q 4 14 2 26 M206 96 q 2 14 6 24 M222 102 q -2 12 4 20 M170 104 q 6 10 4 20" fill="none" stroke="#6f6f7b" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
        {/* white brow patches sweeping out over the cheeks */}
        <path d="M104 172 Q 120 128 172 128 Q 194 132 198 150 Q 186 162 168 156 Q 136 154 110 186 Z M302 170 Q 288 126 240 126 Q 216 130 212 150 Q 224 162 244 156 Q 276 154 298 186 Z" fill="url(#rc-light)" />
        {/* the mask: a wide dark band from cheek tuft to cheek tuft, through the eyes */}
        <path d="M90 186 Q 116 160 160 158 Q 192 158 204 178 Q 218 158 250 158 Q 290 160 312 184 Q 296 206 262 208 Q 236 210 218 198 Q 208 192 204 200 Q 200 192 190 198 Q 170 210 140 208 Q 108 206 90 186 Z" fill="url(#rc-mask)" />
        {/* white muzzle and chin */}
        <path d="M148 206 Q 176 192 204 198 Q 234 192 262 206 Q 274 240 206 250 Q 136 240 148 206 Z" fill="url(#rc-light)" />
      </HeadShape>
      <g data-part="eyes">
        <Eye cx={170} cy={180} r={17} iris="#1b2340" />
        <Eye cx={240} cy={180} r={17} iris="#1b2340" k={0.88} />
        <Lashes l={[156, 168]} r={[253, 168]} />
      </g>
      <Pair l="M150 152 Q 164 144 184 150" mid={205} stroke="#2b2b33" />
      {/* whiskers twitch on accents (rig) */}
      <g data-part="whisker-l" className="whiskers">
        <path d="M176 222 L 130 216 M176 226 L 128 230" />
      </g>
      <g data-part="whisker-r" className="whiskers">
        <path d="M240 220 L 290 212 M240 224 L 292 228" />
      </g>
      <path d="M196 206 Q 208 200 220 206 Q 218 216 208 218 Q 198 216 196 206 Z" fill="#141418" className="ol-thin" />
      <ellipse cx="205" cy="205" rx="4" ry="2" fill="rgb(255 255 255 / 0.6)" />
      <path d="M208 218 V224" stroke="#3a3a44" strokeWidth="2" strokeLinecap="round" />
      <path data-part="smile" d="M196 226 Q 202 232 208 226 Q 214 232 222 226" fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
      {/* a little snarl on strong accents: the lip lifts at one corner over a fang */}
      <g data-part="snarl" opacity="0">
        <path d="M192 227 Q 196 219 203 223" fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
        <path d="M196 226 L 200 226 L 198 232 Z" fill="#fff" />
      </g>
      <Mouth id="raccoon" x={208} y={225} w={12} h={24} fill="#5a1a24" line={INK} />
    </Placed>
  );
}

export function SharkFace() {
  return (
    <Placed cx={205} cy={174} s={0.84}>
      <defs>
        <Shade id="sk-skin" hi="#9fc0d8" mid="#6f8fa8" lo="#3f5c74" />
        <Shade id="sk-belly" hi="#fbfbfd" lo="#c9d3da" />
      </defs>
      {/* the dorsal fin; hats and hoods hide it (styles.css) instead of having it poke out beside them */}
      <g className="shark-fin">
        <path d="M168 104 C 182 72, 212 46, 252 38 C 236 62, 232 88, 240 108 Z" fill="url(#sk-skin)" className="ol" />
        <path d="M240 108 C 232 88, 236 62, 252 38" fill="none" className="rim-line" strokeWidth="3" />
      </g>
      <HeadShape id="shark" fill="url(#sk-skin)" d="M206 94 C 266 94, 304 132, 304 178 C 304 224, 264 254, 206 254 C 148 254, 106 224, 106 178 C 106 132, 146 94, 206 94 Z">
        <path d="M96 196 Q 150 214 206 206 Q 258 214 314 196 V 262 H 96 Z" fill="url(#sk-belly)" />
        <path d="M276 168 q 6 12 0 26 M286 164 q 7 14 0 32 M296 166 q 5 12 0 26 M132 168 q -6 12 0 26 M122 164 q -7 14 0 32" fill="none" stroke="#3d5a73" strokeWidth="3" strokeLinecap="round" />
        <ellipse cx="180" cy="112" rx="40" ry="14" fill="rgb(255 255 255 / 0.18)" transform="rotate(-12 180 112)" />
      </HeadShape>
      <g data-part="eyes">
        <Eye cx={168} cy={164} r={16} iris="#24476a" />
        <Eye cx={242} cy={164} r={16} iris="#24476a" k={0.88} />
        <Lashes l={[155, 153]} r={[254, 153]} />
      </g>
      <Pair l="M148 136 Q 164 128 184 136" mid={205} stroke="#2c4458" width={4.5} />
      <circle cx="196" cy="190" r="2.2" fill="#2c4458" />
      <circle cx="216" cy="190" r="2.2" fill="#2c4458" />
      <g data-part="smile">
        <path d="M162 210 Q 206 236 252 210" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />
        <path d="M174 217 l4 6 l4 -4 M188 222 l4 5 l4 -4 M204 224 l4 5 l4 -5 M220 222 l4 5 l4 -5 M234 217 l4 5 l3 -5" fill="#fff" stroke={INK} strokeWidth="1" strokeLinejoin="round" />
      </g>
      {/* singing, the grin opens into a mouth with top and bottom rows of teeth instead of a plain hole */}
      <Mouth id="shark" x={207} y={210} w={20} h={34} fill="#5a1a24" line={INK} teeth="rows" />
    </Placed>
  );
}

export function AlienFace() {
  return (
    <Placed cx={205} cy={165} s={0.78}>
      <defs>
        <Shade id="al-skin" hi="#c4f096" mid="#8fd16a" lo="#4f9238" />
        <radialGradient id="al-eye" cx="0.5" cy="0.7" r="0.7">
          <stop offset="0" stopColor="#1c4a5a" />
          <stop offset="0.6" stopColor="#0b0b12" />
          <stop offset="1" stopColor="#050508" />
        </radialGradient>
      </defs>
      <path d="M170 96 Q 158 60 140 44 M238 96 Q 252 62 272 48" fill="none" stroke="#5aa040" strokeWidth="5" strokeLinecap="round" />
      {/* glow with the bass, and brighter and bigger with a high voice while singing (rig) */}
      <circle data-voice-glow="" className="antenna ol-thin" cx="140" cy="42" r="8" filter="url(#critter-glow)" />
      <circle data-voice-glow="" className="antenna-2 ol-thin" cx="272" cy="46" r="8" filter="url(#critter-glow)" />
      <HeadShape id="alien" fill="url(#al-skin)" d="M206 74 C 282 74, 316 118, 308 166 C 300 212, 250 254, 206 256 C 162 254, 110 212, 102 166 C 94 118, 130 74, 206 74 Z">
        <ellipse cx="170" cy="104" rx="46" ry="18" fill="rgb(255 255 255 / 0.22)" transform="rotate(-14 170 104)" />
      </HeadShape>
      <g data-part="eyes">
        <path d="M128 168 C 132 138, 170 128, 194 150 C 202 174, 180 196, 154 192 C 136 188, 126 180, 128 168 Z" fill="url(#al-eye)" className="ol-thin" />
        <path d="M282 166 C 278 138, 244 128, 222 148 C 214 172, 234 192, 258 190 C 274 186, 284 178, 282 166 Z" fill="url(#al-eye)" className="ol-thin" />
        <ellipse data-shine="" cx="170" cy="158" rx="9" ry="7" fill="#fff" />
        <circle cx="152" cy="178" r="3" fill="#fff" />
        <ellipse data-shine="" cx="248" cy="156" rx="8" ry="6" fill="#fff" />
        <circle cx="262" cy="176" r="2.6" fill="#fff" />
        <Lashes l={[134, 150]} r={[276, 148]} s={1.1} />
      </g>
      <Pair l="M138 132 Q 158 120 184 128" mid={205} stroke="#4a8a34" />
      <circle cx="198" cy="206" r="2.2" fill="#3c6e2a" />
      <circle cx="212" cy="206" r="2.2" fill="#3c6e2a" />
      <path data-part="smile" d="M192 222 Q 205 232 218 222" fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
      <Mouth id="alien" x={205} y={220} w={11} h={21} fill="#5a1a24" line={INK} teeth="none" />
    </Placed>
  );
}

export function GreyFace() {
  return (
    <Placed cx={204} cy={161} s={0.78}>
      <defs>
        <Shade id="gr-skin" hi="#dfe6eb" mid="#a9b4bc" lo="#6c7882" />
        <radialGradient id="gr-eye" cx="0.5" cy="0.72" r="0.7">
          <stop offset="0" stopColor="#3a2a5e" />
          <stop offset="0.6" stopColor="#0b0b12" />
          <stop offset="1" stopColor="#050508" />
        </radialGradient>
      </defs>
      <HeadShape id="grey" fill="url(#gr-skin)" d="M204 58 C 286 58, 316 108, 306 158 C 296 214, 234 262, 204 264 C 174 262, 112 214, 102 158 C 92 108, 122 58, 204 58 Z">
        <ellipse cx="166" cy="96" rx="40" ry="20" fill="rgb(255 255 255 / 0.45)" transform="rotate(-20 166 96)" />
      </HeadShape>
      <g data-part="eyes">
        <path d="M118 160 C 120 128, 160 120, 192 142 C 202 170, 178 194, 148 190 C 126 186, 116 176, 118 160 Z" fill="url(#gr-eye)" className="ol-thin" />
        <path d="M290 158 C 286 128, 248 120, 220 140 C 210 168, 232 190, 262 188 C 282 184, 292 172, 290 158 Z" fill="url(#gr-eye)" className="ol-thin" />
        <ellipse data-shine="" cx="166" cy="148" rx="10" ry="7" fill="#fff" />
        <circle cx="146" cy="174" r="3.2" fill="#fff" />
        <ellipse data-shine="" cx="250" cy="146" rx="9" ry="6.5" fill="#fff" />
        <circle cx="264" cy="172" r="2.8" fill="#fff" />
        <Lashes l={[123, 142]} r={[285, 140]} s={1.1} />
      </g>
      {/* brow ridges: they lift and tilt like brows (rig) */}
      <Pair l="M128 124 Q 156 108 188 120" mid={205} stroke="#6f7a84" width={3.5} />
      <circle cx="199" cy="210" r="2" fill="#5d6870" />
      <circle cx="211" cy="210" r="2" fill="#5d6870" />
      <path data-part="smile" d="M194 228 Q 205 236 216 228" fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
      <Mouth id="grey" x={205} y={226} w={9} h={18} fill="#5a1a24" line={INK} teeth="none" />
    </Placed>
  );
}

/**
 * A bear's face; fur and muzzle colours come from `--bear-*` (black or brown, styles.css). Each bear gets its
 * own gradient ids (`id`): a gradient takes its colours where it's defined, so with one id a page showing both
 * bears would paint them both the colour of the first.
 */
function Bear({ id }: { id: string }) {
  const fur = `${id}-fur`;
  const muzzle = `${id}-muzzle`;
  return (
    <Placed cx={206} cy={172} s={0.84}>
      <defs>
        <Shade id={fur} hi="var(--bear-fur-hi)" mid="var(--bear-fur)" lo="var(--bear-fur-lo)" />
        <Shade id={muzzle} hi="var(--bear-muzzle-hi)" lo="var(--bear-muzzle-lo)" />
      </defs>
      {/* ears twitch on accents and loud notes (rig) */}
      <g data-part="ear-l">
        <circle cx="134" cy="106" r="28" fill={`url(#${fur})`} className="ol" />
        <circle cx="137" cy="110" r="16" fill={`url(#${muzzle})`} />
      </g>
      <g data-part="ear-r">
        <circle cx="276" cy="104" r="26" fill={`url(#${fur})`} className="ol" />
        <circle cx="273" cy="108" r="15" fill={`url(#${muzzle})`} />
      </g>
      <HeadShape id={id} fill={`url(#${fur})`} d="M206 96 C 266 96, 302 132, 304 172 Q 316 186 302 196 C 296 230, 258 254, 206 254 C 154 254, 116 230, 110 196 Q 96 186 108 172 C 110 132, 146 96, 206 96 Z">
        <path d="M182 112 q 4 10 2 18 M204 108 q 2 10 4 18 M224 112 q -2 10 2 16" fill="none" stroke="rgb(0 0 0 / 0.25)" strokeWidth="2" strokeLinecap="round" />
        <ellipse cx="208" cy="214" rx="46" ry="34" fill={`url(#${muzzle})`} />
      </HeadShape>
      <g data-part="eyes">
        <Eye cx={166} cy={172} r={16.5} iris="#4a2a16" />
        <Eye cx={246} cy={172} r={16.5} iris="#4a2a16" k={0.88} />
        <Lashes l={[153, 161]} r={[258, 161]} />
      </g>
      <Pair l="M148 148 Q 162 140 180 146" mid={206} stroke={`url(#${muzzle})`} width={5} />
      <path d="M190 196 Q 208 186 226 196 Q 224 210 208 214 Q 192 210 190 196 Z" fill="#17120f" className="ol-thin" />
      <ellipse cx="202" cy="195" rx="6" ry="3" fill="rgb(255 255 255 / 0.55)" />
      <path d="M208 214 V222" stroke="#2b1d12" strokeWidth="2.4" strokeLinecap="round" />
      <path data-part="smile" d="M192 224 Q 200 232 208 224 Q 216 232 224 224" fill="none" stroke="#2b1d12" strokeWidth="2.8" strokeLinecap="round" />
      {/* the biggest jaw drop of the lot */}
      <Mouth id={id} x={208} y={223} w={15} h={30} fill="#5a1a24" line="#2b1d12" />
    </Placed>
  );
}

export const BlackBearFace = () => <Bear id="bear-black" />;
export const BrownBearFace = () => <Bear id="bear-brown" />;


/**
 * One palmate antler (the left; the right is its mirror): a short beam out from the crown into a broad flat
 * palm with rounded tines along its top edge and a little brow tine forward. Drawn behind the head, so a hat
 * or a beanie covers the beams and only the palms show either side of it, and headphones sit between them.
 */
const ANTLER =
  'M154 112 C 136 112, 120 112, 106 108 C 84 104, 60 98, 44 84 Q 34 74 36 64 Q 42 63 46 68 Q 44 57 48 50 Q 53 49 56 56 Q 56 46 62 42 Q 67 41 69 49 Q 70 42 76 39 Q 82 40 81 49 Q 85 43 91 43 Q 96 45 93 54 Q 98 50 104 51 Q 109 55 103 63 C 99 74, 103 85, 114 90 C 128 94, 142 96, 156 98 Z';

export function MooseFace() {
  return (
    <Placed cx={206} cy={172} s={0.84}>
      <defs>
        <Shade id="ms-fur" hi="#8a6242" mid="#5e3d25" lo="#3a2414" />
        <Shade id="ms-muzzle" hi="#a88464" mid="#7d5a3e" lo="#57391f" />
        <Shade id="ms-antler" hi="#f4e6c4" mid="#dcc597" lo="#ab8f5e" />
      </defs>
      {/* antlers: hidden under the hazmat hood (styles.css), shown with every act's hat */}
      <g className="moose-antlers">
        <path d={ANTLER} fill="url(#ms-antler)" className="ol" />
        <path d="M114 100 Q 86 98 58 84 M78 92 Q 74 74 80 58 M96 94 Q 92 78 98 64" fill="none" stroke="rgb(120 90 50 / 0.35)" strokeWidth="2.5" strokeLinecap="round" />
        <g transform="translate(412 0) scale(-1 1)">
          <path d={ANTLER} fill="url(#ms-antler)" className="ol" />
          <path d="M114 100 Q 86 98 58 84 M78 92 Q 74 74 80 58 M96 94 Q 92 78 98 64" fill="none" stroke="rgb(120 90 50 / 0.35)" strokeWidth="2.5" strokeLinecap="round" />
        </g>
      </g>
      {/* long ears out to the sides, under the antlers; they droop and flick (rig) */}
      <g data-part="ear-l">
        <g transform="rotate(-28 116 138)">
          <ellipse cx="116" cy="138" rx="34" ry="14" fill="url(#ms-fur)" className="ol" />
          <ellipse cx="112" cy="139" rx="22" ry="7" fill="#c49a76" />
        </g>
      </g>
      <g data-part="ear-r">
        <g transform="rotate(28 296 138)">
          <ellipse cx="296" cy="138" rx="32" ry="13" fill="url(#ms-fur)" className="ol" />
          <ellipse cx="300" cy="139" rx="20" ry="6.5" fill="#c49a76" />
        </g>
      </g>
      {/* the bell: the flap of fur under the chin */}
      <path d="M190 262 Q 184 290 198 312 Q 205 302 210 310 Q 224 290 222 262 Z" fill="url(#ms-fur)" className="ol" />
      <HeadShape id="moose" fill="url(#ms-fur)" d="M206 96 C 264 96, 298 130, 298 170 C 298 210, 264 244, 206 244 C 148 244, 114 210, 114 170 C 114 130, 148 96, 206 96 Z">
        <path d="M184 110 q 4 10 2 18 M206 106 q 2 10 4 18 M226 110 q -2 10 2 16" fill="none" stroke="rgb(0 0 0 / 0.25)" strokeWidth="2" strokeLinecap="round" />
        <ellipse cx="174" cy="116" rx="34" ry="12" fill="rgb(255 255 255 / 0.12)" transform="rotate(-14 174 116)" />
      </HeadShape>
      {/* the big overhanging muzzle, drawn over the head's outline so it hangs below it */}
      <path d="M168 186 C 176 174, 236 174, 244 186 C 256 200, 274 226, 268 246 C 262 266, 234 270, 206 270 C 178 270, 150 266, 144 246 C 138 226, 156 200, 168 186 Z" fill="url(#ms-muzzle)" className="ol" />
      <ellipse cx="188" cy="204" rx="24" ry="9" fill="rgb(255 255 255 / 0.16)" transform="rotate(-10 188 204)" />
      <g data-part="eyes">
        <Eye cx={164} cy={164} r={15.5} iris="#3a2414" />
        <Eye cx={248} cy={164} r={15.5} iris="#3a2414" k={0.88} />
        <Lashes l={[151, 153]} r={[260, 153]} />
      </g>
      <Pair l="M146 140 Q 160 132 178 138" mid={206} stroke="#2a1a0e" width={5} />
      {/* wide nostrils on the end of the muzzle */}
      <path d="M176 230 Q 168 220 178 214 Q 192 216 194 228 Q 188 236 176 230 Z M236 230 Q 244 220 234 214 Q 220 216 218 228 Q 224 236 236 230 Z" fill="#26170c" />
      <path data-part="smile" d="M190 248 Q 199 255 206 250 Q 213 255 222 248" fill="none" stroke={INK} strokeWidth="2.8" strokeLinecap="round" />
      <Mouth id="moose" x={206} y={248} w={14} h={22} fill="#5a1a24" line={INK} />
    </Placed>
  );
}

/**
 * A turtle's face, drawn cute: a round sea-green head with a soft mint muzzle, a few gold freckles on the
 * crown, big open eyes, pink cheeks, two little nostrils and a wide happy smile. No ears or horns, so hats and
 * headphones sit on the plain round head; the shell is on the figure (`FIGURES.turtle`).
 */
export function TurtleFace() {
  return (
    <Placed cx={206} cy={174} s={0.84}>
      <defs>
        <Shade id="tt-skin" hi="#a6dfb0" mid="#62b07f" lo="#367a55" />
        <Shade id="tt-muzzle" hi="#f1fbe6" lo="#bfe3bd" />
      </defs>
      <HeadShape id="turtle" fill="url(#tt-skin)" d="M206 96 C 266 96, 302 132, 302 176 C 302 220, 264 252, 206 252 C 148 252, 110 220, 110 176 C 110 132, 146 96, 206 96 Z">
        {/* the soft pale muzzle */}
        <ellipse cx="206" cy="220" rx="62" ry="38" fill="url(#tt-muzzle)" />
        <g fill="#e9c35c" opacity="0.85">
          <circle cx="184" cy="114" r="4" />
          <circle cx="206" cy="108" r="3.2" />
          <circle cx="228" cy="114" r="4" />
          <circle cx="196" cy="124" r="2.2" />
          <circle cx="218" cy="124" r="2.2" />
        </g>
        <ellipse cx="176" cy="120" rx="38" ry="13" fill="rgb(255 255 255 / 0.16)" transform="rotate(-14 176 120)" />
      </HeadShape>
      {/* rosy cheeks */}
      <ellipse cx="140" cy="200" rx="15" ry="9" fill="#ff8f9c" opacity="0.5" />
      <ellipse cx="272" cy="200" rx="15" ry="9" fill="#ff8f9c" opacity="0.5" />
      <g data-part="eyes">
        <Eye cx={166} cy={164} r={21} iris="#2a6f8a" />
        <Eye cx={246} cy={164} r={21} iris="#2a6f8a" k={0.9} />
        <Lashes l={[148, 152]} r={[262, 152]} />
      </g>
      <Pair l="M146 130 Q 160 123 176 128" mid={206} stroke="#2f6b47" width={4.5} />
      <ellipse cx="199" cy="198" rx="2.6" ry="2" fill="#2c5a3e" />
      <ellipse cx="213" cy="198" rx="2.6" ry="2" fill="#2c5a3e" />
      <path data-part="smile" d="M176 208 Q 206 236 236 208 M172 205 Q 175 210 179 210 M240 205 Q 237 210 233 210" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />
      <Mouth id="turtle" x={206} y={212} w={16} h={26} fill="#5a1a24" line={INK} teeth="none" />
    </Placed>
  );
}

/**
 * A big cat's round ear (`ear-l`; the right is its mirror about `mid`): fur outside, a pale inner ear, and on
 * the tiger a dark back edge. Drawn behind the head so the cowboy hat can hide it (`hidesEars`).
 */
function CatEars({ fur, inner, mid = 206, rim }: { fur: string; inner: string; mid?: number; rim?: string }) {
  const ear = (
    <>
      <path d="M118 140 C 104 104, 116 76, 148 78 C 170 80, 182 96, 184 112 Z" fill={fur} className="ol" />
      {rim && <path d="M118 140 C 104 104, 116 76, 148 78" fill="none" stroke={rim} strokeWidth="9" strokeLinecap="round" opacity="0.9" />}
      <path d="M130 128 C 124 106, 132 92, 150 94 C 162 96, 170 106, 170 116 Z" fill={inner} />
    </>
  );
  return (
    <>
      <g data-part="ear-l">{ear}</g>
      <g data-part="ear-r">
        <g transform={`translate(${2 * mid} 0) scale(-1 1)`}>{ear}</g>
      </g>
    </>
  );
}

/**
 * A tiger cub's face, drawn cute and kept clear of famous cartoon tigers (no blue nose, no bouncy tail, no
 * neckerchief): a round orange head with fluffy cheek ruffs, three bold stripes on the brow and a few on the
 * cheeks, a white muzzle and eye patches, round ears with dark backs, big green eyes, a pink nose and
 * whiskers.
 */
export function TigerFace() {
  return (
    <Placed cx={206} cy={176} s={0.84}>
      <defs>
        <Shade id="tg-fur" hi="#ffc27a" mid="#f08a2c" lo="#b75a16" />
        <Shade id="tg-white" hi="#ffffff" lo="#e9dccb" />
      </defs>
      <CatEars fur="url(#tg-fur)" inner="#fff1e4" rim="#2a1a12" />
      <HeadShape
        id="tiger"
        fill="url(#tg-fur)"
        d="M206 92 C 266 92, 300 128, 302 168 Q 318 178 312 190 Q 320 200 304 208 C 292 238, 254 256, 206 256 C 158 256, 120 238, 108 208 Q 92 200 100 190 Q 94 178 110 168 C 112 128, 146 92, 206 92 Z"
      >
        {/* white patches over the eyes and the muzzle */}
        <ellipse cx="164" cy="146" rx="22" ry="11" fill="url(#tg-white)" opacity="0.9" transform="rotate(-10 164 146)" />
        <ellipse cx="248" cy="146" rx="22" ry="11" fill="url(#tg-white)" opacity="0.9" transform="rotate(10 248 146)" />
        <path d="M206 196 C 178 186, 140 196, 132 222 C 140 252, 186 258, 206 254 C 226 258, 272 252, 280 222 C 272 196, 234 186, 206 196 Z" fill="url(#tg-white)" />
        {/* stripes: three on the brow, three on each cheek */}
        <g fill="#2a1a12">
          <path d="M206 96 Q 200 112 206 128 Q 212 112 206 96 Z" />
          <path d="M182 100 Q 180 114 190 124 Q 190 110 182 100 Z" />
          <path d="M230 100 Q 232 114 222 124 Q 222 110 230 100 Z" />
          <path d="M102 172 Q 124 170 140 180 Q 122 180 102 172 Z" />
          <path d="M100 190 Q 124 186 142 194 Q 122 196 100 190 Z" />
          <path d="M108 208 Q 126 202 140 208 Q 124 212 108 208 Z" />
          <path d="M310 172 Q 288 170 272 180 Q 290 180 310 172 Z" />
          <path d="M312 190 Q 288 186 270 194 Q 290 196 312 190 Z" />
          <path d="M304 208 Q 286 202 272 208 Q 288 212 304 208 Z" />
        </g>
        <ellipse cx="176" cy="112" rx="34" ry="11" fill="rgb(255 255 255 / 0.18)" transform="rotate(-14 176 112)" />
      </HeadShape>
      <g data-part="eyes">
        <Eye cx={166} cy={170} r={19} iris="#5f9a2c" />
        <Eye cx={246} cy={170} r={19} iris="#5f9a2c" k={0.9} />
        <Lashes l={[150, 159]} r={[261, 159]} />
      </g>
      <Pair l="M146 140 Q 160 132 178 138" mid={206} stroke="#2a1a12" width={4.5} />
      <g data-part="whisker-l" className="whiskers">
        <path d="M172 220 L 124 212 M172 226 L 122 228" />
      </g>
      <g data-part="whisker-r" className="whiskers">
        <path d="M240 220 L 290 212 M240 226 L 292 228" />
      </g>
      {/* a pink heart-shaped nose */}
      <path d="M194 202 Q 206 196 218 202 Q 216 212 206 216 Q 196 212 194 202 Z" fill="#f2869a" className="ol-thin" />
      <ellipse cx="202" cy="202" rx="4" ry="2" fill="rgb(255 255 255 / 0.6)" />
      <path d="M206 216 V222" stroke="#5a3a2a" strokeWidth="2.4" strokeLinecap="round" />
      <path data-part="smile" d="M190 224 Q 198 232 206 224 Q 214 232 222 224" fill="none" stroke={INK} strokeWidth="2.8" strokeLinecap="round" />
      <Mouth id="tiger" x={206} y={224} w={14} h={26} fill="#5a1a24" line={INK} />
    </Placed>
  );
}

/** The lion's mane: a scalloped ring of tufts round the head, darker at the edge. */
const MANE = Array.from({ length: 16 }, (_, i) => {
  const a0 = (i / 16) * Math.PI * 2;
  const a1 = ((i + 1) / 16) * Math.PI * 2;
  const am = (a0 + a1) / 2;
  const p = (a: number, r: number) => `${(206 + r * Math.cos(a)).toFixed(1)} ${(180 + r * 0.94 * Math.sin(a)).toFixed(1)}`;
  return `${i === 0 ? `M${p(a0, 118)} ` : ''}Q ${p(am, 140)} ${p(a1, 118)}`;
}).join(' ') + ' Z';

/**
 * A lion cub's face, drawn cute and kept clear of famous cartoon lions: a round golden head in a big
 * russet mane (the girl is a lioness, with no mane but a little tuft on the crown), round ears, a cream
 * muzzle, big amber eyes, a dusky-rose nose and whiskers. The mane is behind the head, so hats sit on the
 * head and the mane frames them; the hazmat hood hides it (`.lion-mane`, styles.css).
 */
export function LionFace() {
  const girl = useContext(GirlContext);
  return (
    <Placed cx={206} cy={176} s={0.84}>
      <defs>
        <Shade id="ln-fur" hi="#ffd98a" mid="#e3a64a" lo="#a86d22" />
        <Shade id="ln-mane" hi="#d0742c" mid="#a4501c" lo="#6a3010" />
        <Shade id="ln-muzzle" hi="#fffaf0" lo="#ecd6ac" />
      </defs>
      {!girl && (
        <g className="lion-mane">
          <path d={MANE} fill="url(#ln-mane)" className="ol" />
          <path d="M120 150 q 10 6 14 18 M292 150 q -10 6 -14 18 M126 220 q 12 -2 20 6 M286 220 q -12 -2 -20 6 M206 68 q -4 10 0 20" fill="none" stroke="rgb(0 0 0 / 0.2)" strokeWidth="3" strokeLinecap="round" />
        </g>
      )}
      <CatEars fur="url(#ln-fur)" inner="#f6d9b0" />
      <HeadShape id="lion" fill="url(#ln-fur)" d="M206 96 C 266 96, 300 130, 300 174 C 300 220, 262 252, 206 252 C 150 252, 112 220, 112 174 C 112 130, 146 96, 206 96 Z">
        <path d="M206 194 C 178 186, 146 196, 140 222 C 148 250, 186 256, 206 252 C 226 256, 264 250, 272 222 C 266 196, 234 186, 206 194 Z" fill="url(#ln-muzzle)" />
        <ellipse cx="176" cy="116" rx="34" ry="11" fill="rgb(255 255 255 / 0.2)" transform="rotate(-14 176 116)" />
      </HeadShape>
      {girl && <path d="M196 100 Q 192 84 204 78 Q 202 90 210 92 Q 216 82 226 86 Q 216 94 216 104 Z" fill="url(#ln-fur)" className="ol-thin" />}
      <g data-part="eyes">
        <Eye cx={166} cy={168} r={19} iris="#b8741a" />
        <Eye cx={246} cy={168} r={19} iris="#b8741a" k={0.9} />
        <Lashes l={[150, 157]} r={[261, 157]} />
      </g>
      <Pair l="M146 140 Q 160 132 178 138" mid={206} stroke="#8a5418" width={4.5} />
      <g data-part="whisker-l" className="whiskers">
        <path d="M172 220 L 124 212 M172 226 L 122 228" />
      </g>
      <g data-part="whisker-r" className="whiskers">
        <path d="M240 220 L 290 212 M240 226 L 292 228" />
      </g>
      <path d="M192 200 Q 206 192 220 200 Q 218 212 206 216 Q 194 212 192 200 Z" fill="#9a5248" className="ol-thin" />
      <ellipse cx="201" cy="200" rx="4.5" ry="2" fill="rgb(255 255 255 / 0.5)" />
      <path d="M206 216 V222" stroke="#5a3a2a" strokeWidth="2.4" strokeLinecap="round" />
      <path data-part="smile" d="M190 224 Q 198 232 206 224 Q 214 232 222 224" fill="none" stroke={INK} strokeWidth="2.8" strokeLinecap="round" />
      <Mouth id="lion" x={206} y={224} w={14} h={26} fill="#5a1a24" line={INK} />
    </Placed>
  );
}

/** The elephant's left ear (the right is its mirror): a big rounded flap out to the side, pink inside. */
const ELEPHANT_EAR = 'M140 128 C 104 92, 52 98, 40 140 C 30 180, 54 228, 96 236 C 118 240, 134 228, 142 212 Z';
/** The trunk's outline, and just its two sides (its root at the top is left open, so it joins the face). */
const TRUNK = 'M228 178 C 230 200, 226 218, 206 223 C 184 228, 160 222, 148 206 C 142 198, 150 190, 158 196 C 168 206, 180 208, 192 204 C 200 200, 188 196, 188 178 Z';
const TRUNK_SIDES = 'M228 178 C 230 200, 226 218, 206 223 C 184 228, 160 222, 148 206 C 142 198, 150 190, 158 196 C 168 206, 180 208, 192 204 C 200 200, 188 196, 188 178';
const ELEPHANT_EAR_IN = 'M132 140 C 106 116, 70 120, 60 148 C 52 178, 70 212, 100 218 C 116 220, 126 210, 130 200 Z';

/**
 * An elephant calf's face, drawn cute and kept clear of famous cartoon elephants (no giant flying ears, no
 * hat or bonnet of its own): a round soft-grey head, big round ears out to the sides with pink insides,
 * big blue eyes, pink cheeks, a trunk that sweeps out to the left over a wide smile, which shows either side of it.
 * The ears flap (rig) and stay out with every hat, even the cowboy hat; the hazmat hood hides the ears and
 * the trunk (`.elephant-ears`, `.elephant-trunk`, styles.css).
 */
export function ElephantFace() {
  return (
    <Placed cx={206} cy={174} s={0.84}>
      <defs>
        <Shade id="el-skin" hi="#d2d8e8" mid="#a3abc4" lo="#6e7690" />
        <Shade id="el-ear" hi="#c6cde0" mid="#9aa2bc" lo="#6a728c" />
      </defs>
      <g className="elephant-ears">
        <g data-part="ear-l">
          <path d={ELEPHANT_EAR} fill="url(#el-ear)" className="ol" />
          <path d={ELEPHANT_EAR_IN} fill="#f2b6c0" />
        </g>
        <g data-part="ear-r">
          <g transform="translate(412 0) scale(-1 1)">
            <path d={ELEPHANT_EAR} fill="url(#el-ear)" className="ol" />
            <path d={ELEPHANT_EAR_IN} fill="#f2b6c0" />
          </g>
        </g>
      </g>
      <HeadShape id="elephant" fill="url(#el-skin)" d="M206 94 C 266 94, 300 130, 300 176 C 300 222, 262 252, 206 252 C 150 252, 112 222, 112 176 C 112 130, 146 94, 206 94 Z">
        <path d="M184 108 q 4 8 2 14 M206 104 q 2 8 2 14 M228 108 q -2 8 0 14" fill="none" stroke="rgb(0 0 0 / 0.18)" strokeWidth="2" strokeLinecap="round" />
        <ellipse cx="176" cy="116" rx="36" ry="12" fill="rgb(255 255 255 / 0.22)" transform="rotate(-14 176 116)" />
      </HeadShape>
      <ellipse cx="140" cy="206" rx="15" ry="9" fill="#ff8f9c" opacity="0.45" />
      <ellipse cx="272" cy="206" rx="15" ry="9" fill="#ff8f9c" opacity="0.45" />
      <g data-part="eyes">
        <Eye cx={164} cy={166} r={19} iris="#3a6ea8" />
        <Eye cx={248} cy={166} r={19} iris="#3a6ea8" k={0.9} />
        <Lashes l={[148, 155]} r={[263, 155]} />
      </g>
      <Pair l="M146 136 Q 160 128 178 134" mid={206} stroke="#5d6580" width={4.5} />
      {/* a wide smile, and the singing mouth, under the trunk: wide enough to show either side of it */}
      <path data-part="smile" d="M166 226 Q 212 264 260 226 M162 221 Q 164 228 171 230 M264 221 Q 262 228 255 230" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />
      <Mouth id="elephant" x={214} y={228} w={28} h={34} fill="#5a1a24" line={INK} teeth="none" />
      {/* the trunk: down from between the eyes and sweeping out to the left over the mouth, tip up; outlined
          down its sides only, so it grows out of the face without a seam */}
      <g className="elephant-trunk">
        <path d={TRUNK} fill="url(#el-skin)" />
        <path d={TRUNK_SIDES} fill="none" className="ol" />
        <path d="M190 190 q 18 4 38 0 M192 206 q 2 8 -2 16 M174 210 q 2 6 -2 12" fill="none" stroke="rgb(0 0 0 / 0.2)" strokeWidth="2.2" strokeLinecap="round" />
        <ellipse cx="152" cy="199" rx="6.5" ry="4.5" fill="#4a5068" transform="rotate(50 152 199)" />
      </g>
    </Placed>
  );
}

/** The panda's left eye patch (the right is its mirror): a soft teardrop round the eye, drooping out and down. */
const PANDA_PATCH = 'M182 148 C 186 166, 180 194, 160 204 C 140 212, 124 200, 126 180 C 128 158, 144 140, 162 138 C 174 137, 180 140, 182 148 Z';

/**
 * A panda cub's face, drawn cute and kept clear of famous cartoon pandas (no jade eyes, no kung-fu headband):
 * a round cream-white head with fluffy cheeks, round black ears, black teardrop patches round big shiny brown
 * eyes, a little black button nose on a soft muzzle, pink cheeks and a wide smile. The ears are `ear-l` /
 * `ear-r` like the bears', so the rig wiggles them and the cowboy hat hides them; the patches sit outside the
 * `eyes` group so blinks don't squash them. The girl's lashes are pale so they show against the patches
 * (`.species-panda .lashes`, styles.css).
 */
export function PandaFace() {
  return (
    <Placed cx={206} cy={174} s={0.84}>
      <defs>
        <Shade id="pd-fur" hi="#ffffff" mid="#f4f2ec" lo="#c9c6c0" />
        <Shade id="pd-black" hi="#4a4852" mid="#2a2930" lo="#141318" />
        <Shade id="pd-muzzle" hi="#ffffff" lo="#ebe7de" />
      </defs>
      {/* round black ears, twitching on accents (rig) */}
      <g data-part="ear-l">
        <circle cx="132" cy="108" r="30" fill="url(#pd-black)" className="ol" />
        <circle cx="135" cy="112" r="15" fill="#3c3a44" />
      </g>
      <g data-part="ear-r">
        <circle cx="280" cy="108" r="30" fill="url(#pd-black)" className="ol" />
        <circle cx="277" cy="112" r="15" fill="#3c3a44" />
      </g>
      <HeadShape id="panda" fill="url(#pd-fur)" d="M206 94 C 268 94, 304 130, 304 172 Q 318 188 302 200 C 294 234, 256 256, 206 256 C 156 256, 118 234, 110 200 Q 94 188 108 172 C 108 130, 144 94, 206 94 Z">
        <ellipse cx="206" cy="220" rx="48" ry="32" fill="url(#pd-muzzle)" />
        <ellipse cx="176" cy="114" rx="36" ry="12" fill="rgb(255 255 255 / 0.5)" transform="rotate(-14 176 114)" />
      </HeadShape>
      {/* the eye patches, outside the eyes group so a blink leaves them be */}
      <path d={PANDA_PATCH} fill="url(#pd-black)" />
      <g transform="translate(412 0) scale(-1 1)">
        <path d={PANDA_PATCH} fill="url(#pd-black)" />
      </g>
      {/* rosy cheeks */}
      <ellipse cx="128" cy="214" rx="14" ry="8" fill="#ff8f9c" opacity="0.55" />
      <ellipse cx="284" cy="214" rx="14" ry="8" fill="#ff8f9c" opacity="0.55" />
      <g data-part="eyes">
        <Eye cx={160} cy={170} r={17} iris="#5a3418" />
        <Eye cx={252} cy={170} r={17} iris="#5a3418" k={0.9} />
        <Lashes l={[146, 160]} r={[266, 160]} />
      </g>
      <Pair l="M144 132 Q 156 124 172 128" mid={206} stroke="#2a2930" width={4.5} />
      {/* a little black button nose */}
      <path d="M194 200 Q 206 193 218 200 Q 216 211 206 214 Q 196 211 194 200 Z" fill="#17161b" className="ol-thin" />
      <ellipse cx="201" cy="199" rx="4.5" ry="2" fill="rgb(255 255 255 / 0.6)" />
      <path d="M206 214 V221" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
      <path data-part="smile" d="M188 222 Q 197 232 206 222 Q 215 232 224 222" fill="none" stroke={INK} strokeWidth="2.8" strokeLinecap="round" />
      <Mouth id="panda" x={206} y={222} w={14} h={26} fill="#5a1a24" line={INK} />
    </Placed>
  );
}
