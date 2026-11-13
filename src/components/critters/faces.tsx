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

/** The owl's left ear tuft (the right is its mirror): a short soft point at the top corner of the head. */
const OWL_TUFT = 'M130 132 C 124 116, 118 98, 116 80 C 134 88, 152 100, 166 112 Z';

/** A big round sticker-style eye: white, a huge dark brown iris, a black pupil, a big shine and a small one. */
function OwlEye({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return (
    <>
      <circle cx={cx} cy={cy} r={r} fill="#fff" className="ol-thin" />
      <circle cx={cx + 1} cy={cy + 1} r={r * 0.84} fill="#3a2416" />
      <circle cx={cx + 1} cy={cy + 1} r={r * 0.5} fill="#120a06" />
      <circle data-shine="" cx={cx + r * 0.3} cy={cy - r * 0.32} r={r * 0.3} fill="#fff" />
      <circle cx={cx - r * 0.34} cy={cy + r * 0.34} r={r * 0.13} fill="#fff" />
    </>
  );
}

/**
 * An owlet's face, drawn cute like a sticker and kept clear of famous cartoon owls (no snowy-white post owl,
 * no spectacles, no mortarboard): a round brown head with two short pointed tufts (`ear-l` / `ear-r`, so the rig
 * wiggles them and the cowboy hat hides them), a big cream face dipping to a point between the eyes, huge round
 * dark eyes with big shines, a little yellow beak with the singing mouth under it and pink cheeks. The wings are
 * its arms (`FIGURES.owl`, `.species-owl .sleeve`).
 */
export function OwlFace() {
  return (
    <Placed cx={206} cy={176} s={0.84}>
      <defs>
        <Shade id="ow-fur" hi="#c99560" mid="#a5713f" lo="#6e4626" />
        <Shade id="ow-face" hi="#fffaf0" lo="#f0dcb8" />
        <Shade id="ow-beak" hi="#ffe066" lo="#e8a412" />
      </defs>
      <g data-part="ear-l">
        <path d={OWL_TUFT} fill="url(#ow-fur)" className="ol" />
      </g>
      <g data-part="ear-r">
        <g transform="translate(412 0) scale(-1 1)">
          <path d={OWL_TUFT} fill="url(#ow-fur)" className="ol" />
        </g>
      </g>
      <HeadShape id="owl" fill="url(#ow-fur)" d="M206 94 C 272 94, 308 134, 308 182 C 308 232, 268 262, 206 262 C 144 262, 104 232, 104 182 C 104 134, 140 94, 206 94 Z">
        {/* the big cream face, dipping to a point between the eyes */}
        <path d="M206 146 C 194 126, 152 120, 134 140 C 114 162, 116 214, 142 238 C 166 258, 246 258, 270 238 C 296 214, 298 162, 278 140 C 260 120, 218 126, 206 146 Z" fill="url(#ow-face)" className="ol-thin" />
        <ellipse cx="172" cy="112" rx="30" ry="10" fill="rgb(255 255 255 / 0.2)" transform="rotate(-14 172 112)" />
      </HeadShape>
      {/* pink cheeks */}
      <ellipse cx="146" cy="216" rx="16" ry="9" fill="#ff8fa6" opacity="0.7" />
      <ellipse cx="266" cy="216" rx="16" ry="9" fill="#ff8fa6" opacity="0.7" />
      <g data-part="eyes">
        <OwlEye cx={166} cy={180} r={27} />
        <OwlEye cx={246} cy={180} r={27} />
        <Lashes l={[144, 166]} r={[268, 166]} />
      </g>
      <Pair l="M146 136 Q 158 130 172 134" mid={206} stroke="#6e4626" width={4} />
      {/* the singing mouth and the closed smile under a little yellow beak */}
      <path data-part="smile" d="M199 228 Q 206 232 213 228" fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
      <Mouth id="owl" x={206} y={220} w={10} h={20} fill="#5a1a24" line={INK} teeth="none" />
      <path d="M194 200 Q 206 194 218 200 Q 214 214 206 222 Q 198 214 194 200 Z" fill="url(#ow-beak)" className="ol-thin" />
      <ellipse cx="202" cy="201" rx="4" ry="1.8" fill="rgb(255 255 255 / 0.7)" />
    </Placed>
  );
}

/**
 * A baby T. rex's face, drawn cute and kept clear of famous cartoon dinosaurs (not purple, no spots on a long
 * neck, no roar): a round green head that widens into a big soft snout, a pale yellow chin, darker green
 * freckles on the crown, big friendly eyes under little brow ridges, two nostrils, rosy cheeks and a wide grin
 * with two tiny teeth peeking down. No ears, so hats sit on the plain round head; the short clawed arms, big
 * feet and tail are on the figure (`FIGURES.trex`).
 */
export function TrexFace() {
  return (
    <Placed cx={206} cy={176} s={0.84}>
      <defs>
        <Shade id="tx-skin" hi="#b6e58c" mid="#7cc25a" lo="#457f30" />
        <Shade id="tx-chin" hi="#fffbe0" lo="#ead98e" />
      </defs>
      <HeadShape id="trex" fill="url(#tx-skin)" d="M206 92 C 262 92, 296 124, 298 166 C 300 190, 314 208, 310 230 C 304 258, 260 266, 206 266 C 152 266, 108 258, 102 230 C 98 208, 112 190, 114 166 C 116 124, 150 92, 206 92 Z">
        {/* the pale chin under the grin */}
        <path d="M112 236 Q 206 222 300 236 Q 290 268 206 270 Q 122 268 112 236 Z" fill="url(#tx-chin)" />
        {/* freckles on the crown */}
        <g fill="#4f8c38" opacity="0.7">
          <circle cx="182" cy="110" r="5" />
          <circle cx="206" cy="104" r="4" />
          <circle cx="230" cy="110" r="5" />
          <circle cx="194" cy="122" r="2.8" />
          <circle cx="218" cy="122" r="2.8" />
          <circle cx="126" cy="194" r="3.4" />
          <circle cx="286" cy="194" r="3.4" />
        </g>
        <ellipse cx="174" cy="114" rx="36" ry="12" fill="rgb(255 255 255 / 0.22)" transform="rotate(-14 174 114)" />
      </HeadShape>
      {/* rosy cheeks */}
      <ellipse cx="136" cy="212" rx="15" ry="9" fill="#ff8f9c" opacity="0.5" />
      <ellipse cx="276" cy="212" rx="15" ry="9" fill="#ff8f9c" opacity="0.5" />
      <g data-part="eyes">
        <Eye cx={166} cy={162} r={20} iris="#8a5a1c" />
        <Eye cx={246} cy={162} r={20} iris="#8a5a1c" k={0.9} />
        <Lashes l={[149, 150]} r={[262, 150]} />
      </g>
      {/* little brow ridges */}
      <Pair l="M144 132 Q 160 122 180 130" mid={206} stroke="#3f7a2c" width={6} />
      {/* nostrils on the snout */}
      <ellipse cx="192" cy="198" rx="4" ry="2.6" fill="#2f5e22" transform="rotate(-18 192 198)" />
      <ellipse cx="220" cy="198" rx="4" ry="2.6" fill="#2f5e22" transform="rotate(18 220 198)" />
      {/* a wide grin with two tiny teeth peeking down at the corners */}
      <g data-part="smile">
        <path d="M150 220 Q 206 254 262 220 M146 215 Q 148 222 155 224 M266 215 Q 264 222 257 224" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />
        <path d="M170 231 L 176 241 L 181 234 Z M231 234 L 236 241 L 242 231 Z" fill="#fff" className="ol-thin" />
      </g>
      <Mouth id="trex" x={206} y={224} w={24} h={32} fill="#5a1a24" line={INK} />
    </Placed>
  );
}

/**
 * A monkey's face, drawn cute and kept clear of famous cartoon monkeys (no fez or vest, no yellow-hat friend,
 * no red cap): a round brown head with a little tuft of hair on the crown, big round ears out at the sides
 * with peach insides (`ear-l` / `ear-r`; they stay out under every hat, `.species-monkey`, styles.css), a
 * peach heart of a face round big brown eyes, a soft muzzle with two nostrils, rosy cheeks and a wide grin.
 */
export function MonkeyFace() {
  return (
    <Placed cx={206} cy={176} s={0.84}>
      <defs>
        <Shade id="mk-fur" hi="#b07a4c" mid="#8a5530" lo="#55301a" />
        <Shade id="mk-face" hi="#fde3c4" mid="#f2c79c" lo="#d9a072" />
      </defs>
      {/* round ears out at the sides, at eye level */}
      <g className="monkey-ears">
        <g data-part="ear-l">
          <circle cx="104" cy="176" r="32" fill="url(#mk-fur)" className="ol" />
          <circle cx="106" cy="178" r="20" fill="url(#mk-face)" />
          <path d="M100 172 Q 108 176 104 188" fill="none" stroke="rgb(0 0 0 / 0.18)" strokeWidth="3" strokeLinecap="round" />
        </g>
        <g data-part="ear-r">
          <circle cx="308" cy="176" r="32" fill="url(#mk-fur)" className="ol" />
          <circle cx="306" cy="178" r="20" fill="url(#mk-face)" />
          <path d="M312 172 Q 304 176 308 188" fill="none" stroke="rgb(0 0 0 / 0.18)" strokeWidth="3" strokeLinecap="round" />
        </g>
      </g>
      <HeadShape id="monkey" fill="url(#mk-fur)" d="M206 92 C 266 92, 300 128, 300 174 C 300 222, 262 256, 206 256 C 150 256, 112 222, 112 174 C 112 128, 146 92, 206 92 Z">
        {/* the peach face: a heart round the eyes, narrowing into the muzzle */}
        <path d="M206 142 C 194 118, 144 116, 134 148 C 126 172, 136 192, 148 204 C 140 236, 168 256, 206 256 C 244 256, 272 236, 264 204 C 276 192, 286 172, 278 148 C 268 116, 218 118, 206 142 Z" fill="url(#mk-face)" />
        <ellipse cx="206" cy="222" rx="48" ry="30" fill="#fff0dc" opacity="0.55" />
        <path d="M188 100 q 6 10 4 20 M224 100 q -6 10 -4 20" fill="none" stroke="rgb(0 0 0 / 0.2)" strokeWidth="2" strokeLinecap="round" />
        <ellipse cx="174" cy="112" rx="32" ry="10" fill="rgb(255 255 255 / 0.18)" transform="rotate(-14 174 112)" />
      </HeadShape>
      {/* a little tuft of hair on the crown */}
      <path d="M190 98 Q 186 78 200 70 Q 198 84 208 86 Q 212 72 226 72 Q 216 84 222 98 Z" fill="url(#mk-fur)" className="ol-thin" />
      <ellipse cx="146" cy="214" rx="14" ry="8" fill="#ff8f9c" opacity="0.5" />
      <ellipse cx="266" cy="214" rx="14" ry="8" fill="#ff8f9c" opacity="0.5" />
      <g data-part="eyes">
        <Eye cx={168} cy={168} r={18} iris="#5a3418" />
        <Eye cx={244} cy={168} r={18} iris="#5a3418" k={0.9} />
        <Lashes l={[153, 157]} r={[258, 157]} />
      </g>
      <Pair l="M148 140 Q 162 132 180 138" mid={206} stroke="#55301a" width={4.5} />
      {/* two nostrils on the muzzle */}
      <ellipse cx="198" cy="204" rx="4" ry="3" fill="#5a3418" transform="rotate(-15 198 204)" />
      <ellipse cx="214" cy="204" rx="4" ry="3" fill="#5a3418" transform="rotate(15 214 204)" />
      <path data-part="smile" d="M176 222 Q 206 246 236 222 M172 218 Q 173 224 179 226 M240 218 Q 239 224 233 226" fill="none" stroke={INK} strokeWidth="2.8" strokeLinecap="round" />
      <Mouth id="monkey" x={206} y={224} w={16} h={28} fill="#5a1a24" line={INK} />
    </Placed>
  );
}

/**
 * A baby gorilla's face, drawn cute and kept clear of famous cartoon apes (no necktie, no initials, no
 * skyscraper): a charcoal head domed a little at the crown, small round ears, a soft grey leathery face with a
 * heavy brow (the brows, which lift and tilt with the singing), big brown eyes, a broad nose with wide nostrils,
 * a wide gentle smile and pink cheeks.
 */
export function GorillaFace() {
  return (
    <Placed cx={206} cy={172} s={0.84}>
      <defs>
        <Shade id="go-fur" hi="#6a6466" mid="#3e393b" lo="#1c191a" />
        <Shade id="go-face" hi="#a3958e" mid="#7e6f68" lo="#574a44" />
      </defs>
      <g data-part="ear-l">
        <circle cx="112" cy="182" r="17" fill="url(#go-fur)" className="ol" />
        <circle cx="114" cy="183" r="10" fill="url(#go-face)" />
      </g>
      <g data-part="ear-r">
        <circle cx="300" cy="182" r="17" fill="url(#go-fur)" className="ol" />
        <circle cx="298" cy="183" r="10" fill="url(#go-face)" />
      </g>
      <HeadShape id="gorilla" fill="url(#go-fur)" d="M206 76 C 254 76, 296 112, 300 164 Q 310 180 302 196 C 296 234, 258 258, 206 258 C 154 258, 116 234, 110 196 Q 102 180 112 164 C 116 112, 158 76, 206 76 Z">
        {/* fur on the domed crown */}
        <path d="M184 92 q 6 10 4 22 M206 86 q 2 12 2 24 M228 92 q -6 10 -4 22" fill="none" stroke="rgb(255 255 255 / 0.12)" strokeWidth="2.4" strokeLinecap="round" />
        {/* the leathery face: wide over the eyes, round over the muzzle */}
        <path d="M206 132 C 168 124, 132 132, 132 164 C 132 184, 138 196, 148 204 C 142 240, 174 256, 206 256 C 238 256, 270 240, 264 204 C 274 196, 280 184, 280 164 C 280 132, 244 124, 206 132 Z" fill="url(#go-face)" />
        <ellipse cx="206" cy="226" rx="44" ry="26" fill="#c8b8ae" opacity="0.35" />
        <ellipse cx="172" cy="104" rx="34" ry="11" fill="rgb(255 255 255 / 0.14)" transform="rotate(-14 172 104)" />
      </HeadShape>
      <ellipse cx="146" cy="214" rx="13" ry="7" fill="#ff8f9c" opacity="0.4" />
      <ellipse cx="266" cy="214" rx="13" ry="7" fill="#ff8f9c" opacity="0.4" />
      <g data-part="eyes">
        <Eye cx={170} cy={170} r={17} iris="#4a2a16" />
        <Eye cx={242} cy={170} r={17} iris="#4a2a16" k={0.9} />
        <Lashes l={[156, 159]} r={[255, 159]} />
      </g>
      {/* a heavy brow ridge over each eye */}
      <Pair l="M144 146 Q 168 134 196 144" mid={206} stroke="#3e3430" width={9} />
      {/* a broad nose with wide nostrils */}
      <path d="M186 196 Q 206 184 226 196 Q 232 210 218 214 Q 206 208 194 214 Q 180 210 186 196 Z" fill="#4a3e3a" className="ol-thin" />
      <ellipse cx="196" cy="205" rx="5" ry="3.6" fill="#1f1816" />
      <ellipse cx="216" cy="205" rx="5" ry="3.6" fill="#1f1816" />
      <ellipse cx="202" cy="194" rx="7" ry="2.2" fill="rgb(255 255 255 / 0.3)" />
      <path data-part="smile" d="M176 228 Q 206 248 236 228" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />
      <Mouth id="gorilla" x={206} y={228} w={17} h={28} fill="#5a1a24" line={INK} />
    </Placed>
  );
}

/**
 * The flamingo's upper bill: a short broad beak, pale at the base and bending down at the end into a dark,
 * slightly hooked tip. It sits over the top of the mouth, so singing, the mouth opens below it like a lower bill
 * dropping.
 */
const FLAMINGO_BILL = 'M180 198 Q 206 182 232 198 Q 244 212 232 222 Q 222 228 216 236 Q 212 252 204 248 Q 198 236 192 228 Q 168 214 180 198 Z';

/**
 * A flamingo chick's face, drawn cute: a round pink head with a soft tuft on the crown, big friendly eyes with
 * warm brown irises, rosy cheeks and a short bill, pale at the base with a dark hooked tip. The closed smile is
 * the line of the lower bill under it; singing, the mouth opens below the upper bill, never through it. No ears,
 * so hats sit on the round head; the wings are its arms and the long legs are on the figure (`FIGURES.flamingo`).
 */
export function FlamingoFace() {
  return (
    <Placed cx={206} cy={174} s={0.84}>
      <defs>
        <Shade id="fl-skin" hi="#ffc2d6" mid="#f47ea6" lo="#cf4f80" />
        <Shade id="fl-bill" hi="#fff6f4" lo="#f4cfcf" />
        <clipPath id="clip-flamingo-bill">
          <path d={FLAMINGO_BILL} />
        </clipPath>
      </defs>
      {/* a soft tuft on the crown, swept back */}
      <path d="M200 100 C 192 80, 204 64, 222 66 C 240 68, 246 84, 236 96 C 232 86, 222 82, 216 88 C 214 94, 214 98, 214 102 Z" fill="url(#fl-skin)" className="ol-thin" />
      <HeadShape id="flamingo" fill="url(#fl-skin)" d="M206 94 C 266 94, 300 130, 300 176 C 300 222, 262 252, 206 252 C 150 252, 112 222, 112 176 C 112 130, 146 94, 206 94 Z">
        <ellipse cx="176" cy="116" rx="36" ry="12" fill="rgb(255 255 255 / 0.25)" transform="rotate(-14 176 116)" />
      </HeadShape>
      <ellipse cx="138" cy="208" rx="15" ry="9" fill="#ff5f8a" opacity="0.45" />
      <ellipse cx="274" cy="208" rx="15" ry="9" fill="#ff5f8a" opacity="0.45" />
      <g data-part="eyes">
        <Eye cx={162} cy={160} r={21} iris="#8a4a1c" />
        <Eye cx={250} cy={160} r={21} iris="#8a4a1c" k={0.9} />
        <Lashes l={[144, 148]} r={[267, 148]} />
      </g>
      <Pair l="M142 128 Q 156 120 174 126" mid={206} stroke="#b84a74" width={4.5} />
      {/* the closed smile: the lower bill's line under the upper bill */}
      <path data-part="smile" d="M178 228 Q 206 252 234 228" fill="none" stroke={INK} strokeWidth="2.8" strokeLinecap="round" />
      {/* singing, the mouth opens below the upper bill */}
      <Mouth id="flamingo" x={206} y={232} w={20} h={30} fill="#5a1a24" line={INK} teeth="none" />
      <path d={FLAMINGO_BILL} fill="url(#fl-bill)" />
      <path d="M160 214 Q 206 204 252 214 V260 H160 Z" fill="#4a4560" clipPath="url(#clip-flamingo-bill)" />
      <path d={FLAMINGO_BILL} fill="none" className="ol-thin" />
      <ellipse cx="194" cy="196" rx="9" ry="2.4" fill="rgb(255 255 255 / 0.85)" />
      <path d="M194 206 q 4 2 6 0 M212 206 q 4 2 6 0" fill="none" stroke="#b07a80" strokeWidth="1.8" strokeLinecap="round" />
    </Placed>
  );
}

/**
 * A penguin chick's face, drawn cute and kept clear of famous cartoon penguins (no clay look, no tap shoes, no
 * spy squad): a round black head with a little tuft of hair on top, a white face that rises in two tall ovals
 * round the eyes with a black peak between them, big blue eyes, a wide orange beak with the singing mouth under
 * it, and freckles on the cheeks. No ears, so hats sit on the round head; the flippers, white belly and orange
 * feet are on the figure (`FIGURES.penguin`).
 */
export function PenguinFace() {
  return (
    <Placed cx={206} cy={176} s={0.84}>
      <defs>
        <Shade id="pg-black" hi="#4c5266" mid="#262a38" lo="#10121a" />
        <Shade id="pg-white" hi="#ffffff" lo="#dde3ea" />
        <Shade id="pg-beak" hi="#ffb04a" lo="#e8700e" />
      </defs>
      {/* a little tuft of hair */}
      <path d="M204 96 C 198 80, 184 72, 170 76 C 186 80, 194 88, 196 98 Z M210 96 C 214 78, 226 68, 238 70 C 226 76, 218 86, 216 98 Z" fill="url(#pg-black)" className="ol-thin" />
      <HeadShape id="penguin" fill="url(#pg-black)" d="M206 92 C 266 92, 302 130, 302 176 C 302 224, 262 258, 206 258 C 150 258, 110 224, 110 176 C 110 130, 146 92, 206 92 Z">
        {/* the white face: two tall ovals round the eyes, a black peak between them, joining over the cheeks */}
        <path d="M206 176 C 200 146, 192 118, 168 116 C 140 116, 124 144, 126 178 C 128 218, 160 248, 206 248 C 252 248, 284 218, 286 178 C 288 144, 272 116, 244 116 C 220 118, 212 146, 206 176 Z" fill="url(#pg-white)" />
        <ellipse cx="174" cy="108" rx="30" ry="9" fill="rgb(255 255 255 / 0.2)" transform="rotate(-14 174 108)" />
      </HeadShape>
      {/* freckles */}
      <g fill="#e05a5a" opacity="0.75">
        <circle cx="140" cy="210" r="2.4" /><circle cx="148" cy="216" r="2.4" /><circle cx="136" cy="218" r="2" />
        <circle cx="272" cy="210" r="2.4" /><circle cx="264" cy="216" r="2.4" /><circle cx="276" cy="218" r="2" />
      </g>
      <g data-part="eyes">
        <Eye cx={168} cy={172} r={21} iris="#2f6a96" />
        <Eye cx={244} cy={172} r={21} iris="#2f6a96" k={0.9} />
        <Lashes l={[150, 159]} r={[260, 159]} />
      </g>
      <Pair l="M148 140 Q 160 132 178 138" mid={206} stroke="#7a8296" width={4} />
      <path data-part="smile" d="M192 228 Q 206 236 220 228" fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
      <Mouth id="penguin" x={206} y={220} w={13} h={24} fill="#5a1a24" line={INK} teeth="none" />
      <path d="M184 204 Q 206 194 228 204 Q 220 218 206 226 Q 192 218 184 204 Z" fill="url(#pg-beak)" className="ol-thin" />
      <path d="M190 206 Q 206 212 222 206" fill="none" stroke="rgb(0 0 0 / 0.2)" strokeWidth="1.6" />
      <ellipse cx="198" cy="202" rx="6" ry="1.8" fill="rgb(255 255 255 / 0.7)" />
    </Placed>
  );
}

/** The fox's left ear (the right is its mirror): tall and pointed, dark at the tip, pale inside. */
const FOX_EAR = 'M128 150 C 114 112, 116 76, 126 52 C 150 66, 174 92, 186 118 Z';
const FOX_EAR_IN = 'M136 138 C 128 112, 130 88, 134 72 C 150 86, 164 104, 172 120 Z';

/**
 * A fox cub's face, drawn cute and kept clear of famous cartoon foxes (no hat and cape, no bandit mask, no
 * waistcoat): a round orange head with tall pointed ears tipped in black (`ear-l` / `ear-r`, so the rig flicks
 * them and the cowboy hat hides them), white cheek fluff flaring out at the sides, a white muzzle tapering to a
 * little black nose, big amber eyes and whiskers.
 */
export function FoxFace() {
  const ear = (
    <>
      <path d={FOX_EAR} fill="url(#fx-fur)" className="ol" />
      <path d="M126 52 C 132 56, 138 60, 144 66 L 130 76 Z" fill="#2a1a12" />
      <path d={FOX_EAR_IN} fill="#fff1e4" />
    </>
  );
  return (
    <Placed cx={206} cy={176} s={0.84}>
      <defs>
        <Shade id="fx-fur" hi="#ffa860" mid="#f07a2a" lo="#b44e12" />
        <Shade id="fx-white" hi="#ffffff" lo="#eee2d6" />
      </defs>
      <g data-part="ear-l">{ear}</g>
      <g data-part="ear-r">
        <g transform="translate(412 0) scale(-1 1)">{ear}</g>
      </g>
      <HeadShape
        id="fox"
        fill="url(#fx-fur)"
        d="M206 96 C 262 96, 296 128, 298 168 Q 320 184 316 204 Q 300 202 296 212 C 282 242, 248 258, 206 258 C 164 258, 130 242, 116 212 Q 112 202 96 204 Q 92 184 114 168 C 116 128, 150 96, 206 96 Z"
      >
        {/* white cheek fluff and a muzzle tapering to the nose */}
        <path d="M96 204 Q 120 186 150 192 Q 178 196 206 194 Q 234 196 262 192 Q 292 186 316 204 Q 300 202 296 212 C 282 242, 248 258, 206 258 C 164 258, 130 242, 116 212 Q 112 202 96 204 Z" fill="url(#fx-white)" />
        <path d="M206 150 C 196 170, 188 186, 184 200 L 228 200 C 224 186, 216 170, 206 150 Z" fill="url(#fx-white)" opacity="0.85" />
        <ellipse cx="176" cy="114" rx="34" ry="11" fill="rgb(255 255 255 / 0.2)" transform="rotate(-14 176 114)" />
      </HeadShape>
      <g data-part="eyes">
        <Eye cx={166} cy={170} r={18} iris="#c07a14" />
        <Eye cx={246} cy={170} r={18} iris="#c07a14" k={0.9} />
        <Lashes l={[151, 159]} r={[260, 159]} />
      </g>
      <Pair l="M148 142 Q 162 134 180 140" mid={206} stroke="#8a3a0e" width={4.5} />
      <g data-part="whisker-l" className="whiskers">
        <path d="M176 218 L 128 210 M176 224 L 126 228" />
      </g>
      <g data-part="whisker-r" className="whiskers">
        <path d="M236 218 L 284 210 M236 224 L 286 228" />
      </g>
      <path d="M196 204 Q 206 198 216 204 Q 214 212 206 214 Q 198 212 196 204 Z" fill="#17120f" className="ol-thin" />
      <ellipse cx="202" cy="203" rx="4" ry="1.6" fill="rgb(255 255 255 / 0.6)" />
      <path d="M206 214 V220" stroke="#5a3a2a" strokeWidth="2.4" strokeLinecap="round" />
      <path data-part="smile" d="M192 222 Q 199 230 206 222 Q 213 230 220 222" fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
      <Mouth id="fox" x={206} y={222} w={13} h={24} fill="#5a1a24" line={INK} />
    </Placed>
  );
}

/** One side's three frilly gills (the left; the right is its mirror), fanning out from the side of the head. */
const AXOLOTL_GILLS = [
  'M126 146 C 104 120, 84 108, 64 104 C 74 112, 70 118, 80 122 C 74 126, 78 132, 88 132 C 84 138, 92 142, 100 140 C 106 146, 116 150, 126 152 Z',
  'M116 174 C 92 166, 70 166, 48 172 C 58 176, 58 182, 68 184 C 62 190, 68 194, 78 192 C 76 198, 86 200, 94 196 C 102 196, 110 190, 118 186 Z',
  'M120 204 C 100 206, 82 214, 66 228 C 76 228, 78 234, 88 232 C 86 240, 94 242, 102 236 C 104 242, 114 240, 118 232 C 122 226, 126 218, 128 212 Z',
];

/**
 * An axolotl's face, drawn cute: a wide soft pink head with three frilly gills fanning out either side (they
 * glow and pulse with the bass, `[data-glow]`), big shiny dark eyes set wide, rosy cheeks, two tiny nostrils and
 * the widest happy smile of them all. The hazmat hood hides the gills (`.axolotl-gills`, styles.css).
 */
export function AxolotlFace() {
  const gills = AXOLOTL_GILLS.map((d) => <path key={d} d={d} fill="url(#ax-gill)" className="ol-thin" />);
  return (
    <Placed cx={206} cy={176} s={0.84}>
      <defs>
        <Shade id="ax-skin" hi="#ffe2ec" mid="#f9b6cc" lo="#e0809e" />
        <Shade id="ax-gill" hi="#ff8ab6" mid="#f0508e" lo="#b82a64" />
      </defs>
      <g className="axolotl-gills">
        <g data-glow="">{gills}</g>
        <g data-glow="" transform="translate(412 0) scale(-1 1)">{gills}</g>
      </g>
      <HeadShape id="axolotl" fill="url(#ax-skin)" d="M206 104 C 274 104, 306 138, 306 180 C 306 226, 266 254, 206 254 C 146 254, 106 226, 106 180 C 106 138, 138 104, 206 104 Z">
        <ellipse cx="206" cy="232" rx="70" ry="22" fill="#fff0f5" opacity="0.55" />
        <g fill="#e48aa8" opacity="0.6">
          <circle cx="186" cy="122" r="4" />
          <circle cx="206" cy="116" r="3.4" />
          <circle cx="226" cy="122" r="4" />
        </g>
        <ellipse cx="174" cy="122" rx="34" ry="10" fill="rgb(255 255 255 / 0.35)" transform="rotate(-12 174 122)" />
      </HeadShape>
      <ellipse cx="138" cy="210" rx="15" ry="9" fill="#ff5f8a" opacity="0.45" />
      <ellipse cx="274" cy="210" rx="15" ry="9" fill="#ff5f8a" opacity="0.45" />
      <g data-part="eyes">
        <Eye cx={156} cy={174} r={17} iris="#1c1a2a" />
        <Eye cx={256} cy={174} r={17} iris="#1c1a2a" k={0.9} />
        <Lashes l={[141, 163]} r={[270, 163]} />
      </g>
      <Pair l="M138 148 Q 152 140 168 144" mid={206} stroke="#c0607e" width={4} />
      <circle cx="198" cy="200" r="2.2" fill="#b0506e" />
      <circle cx="214" cy="200" r="2.2" fill="#b0506e" />
      <path data-part="smile" d="M150 212 Q 206 252 262 212 M146 207 Q 148 214 155 216 M266 207 Q 264 214 257 216" fill="none" stroke={INK} strokeWidth="2.8" strokeLinecap="round" />
      <Mouth id="axolotl" x={206} y={220} w={22} h={28} fill="#5a1a24" line={INK} teeth="none" />
    </Placed>
  );
}

/**
 * A sloth's face, drawn cute: a round shaggy tan head with a tuft of fur on top, a big cream face, the dark
 * patches that sweep down and back from its eyes, big shiny brown eyes, a big round dark nose with a shine, and
 * a happy open smile with a pink tongue. The sloth also does everything half a beat late (`FIGURES.sloth`,
 * `move: 'late'`).
 */
export function SlothFace() {
  return (
    <Placed cx={206} cy={176} s={0.84}>
      <defs>
        <Shade id="sl-fur" hi="#dcbc8e" mid="#b88e5e" lo="#7e5a38" />
        <Shade id="sl-face" hi="#fffaf0" lo="#efdcb8" />
        <Shade id="sl-nose" hi="#5a6070" mid="#23252e" lo="#101116" />
      </defs>
      {/* a tuft of fur on top */}
      <path d="M190 100 C 184 86, 176 80, 166 80 C 178 86, 182 94, 184 102 Z M204 98 C 202 82, 208 70, 218 66 C 212 78, 212 88, 214 98 Z M222 100 C 228 88, 238 84, 248 86 C 236 90, 232 96, 230 104 Z" fill="url(#sl-fur)" className="ol-thin" />
      <HeadShape
        id="sloth"
        fill="url(#sl-fur)"
        d="M206 94 C 262 94, 298 126, 302 166 Q 314 176 306 186 Q 312 198 300 204 C 290 238, 254 258, 206 258 C 158 258, 122 238, 112 204 Q 100 198 106 186 Q 98 176 110 166 C 114 126, 150 94, 206 94 Z"
      >
        <path d="M150 116 q 6 6 6 14 M262 116 q -6 6 -6 14 M128 150 q 6 4 8 12 M284 150 q -6 4 -8 12" fill="none" stroke="rgb(0 0 0 / 0.16)" strokeWidth="2.4" strokeLinecap="round" />
        {/* the cream face, coming to a soft point on the brow */}
        <path d="M206 128 C 192 116, 140 118, 124 150 C 108 182, 124 236, 206 242 C 288 236, 304 182, 288 150 C 272 118, 220 116, 206 128 Z" fill="url(#sl-face)" />
        <ellipse cx="176" cy="112" rx="34" ry="10" fill="rgb(255 255 255 / 0.2)" transform="rotate(-14 176 112)" />
      </HeadShape>
      {/* the dark patches sweeping down and back from the eyes, outside the eyes group so a blink leaves them be */}
      <path d="M194 168 C 190 146, 160 140, 138 152 C 120 164, 120 194, 134 204 C 152 206, 176 194, 188 184 C 196 178, 196 174, 194 168 Z" fill="#3e2c26" />
      <path d="M218 168 C 222 146, 252 140, 274 152 C 292 164, 292 194, 278 204 C 260 206, 236 194, 224 184 C 216 178, 216 174, 218 168 Z" fill="#3e2c26" />
      <g data-part="eyes">
        <Eye cx={166} cy={172} r={17} iris="#6a3e1e" />
        <Eye cx={246} cy={172} r={17} iris="#6a3e1e" k={0.9} />
        <Lashes l={[150, 160]} r={[262, 160]} />
      </g>
      <Pair l="M146 136 Q 160 130 176 134" mid={206} stroke="#7e5a38" width={4} />
      {/* a big round shiny nose */}
      <ellipse cx="206" cy="200" rx="16" ry="12" fill="url(#sl-nose)" className="ol-thin" />
      <ellipse cx="201" cy="195" rx="6" ry="3" fill="rgb(255 255 255 / 0.7)" />
      {/* a happy open smile with a pink tongue */}
      <g data-part="smile">
        <path d="M184 222 Q 206 248 228 222 Q 206 230 184 222 Z" fill="#5a1a24" stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
        <ellipse cx="206" cy="234" rx="8" ry="4.5" fill="#e07a8a" />
        <path d="M178 218 q 4 2 6 4 M234 218 q -4 2 -6 4" fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
      </g>
      <Mouth id="sloth" x={206} y={222} w={14} h={24} fill="#5a1a24" line={INK} />
    </Placed>
  );
}

/**
 * An octopus's face, drawn cute: a tall soft coral dome of a head with paler spots, big shiny eyes low on it,
 * rosy cheeks and a little round smile. Its tentacles are its arms and legs (`FIGURES.octopus`).
 */
export function OctopusFace() {
  return (
    <Placed cx={206} cy={170} s={0.84}>
      <defs>
        <Shade id="oc-skin" hi="#ffb4a4" mid="#f2786a" lo="#b8443c" />
      </defs>
      <HeadShape id="octopus" fill="url(#oc-skin)" d="M206 70 C 272 70, 306 118, 304 172 C 302 222, 264 256, 206 256 C 148 256, 110 222, 108 172 C 106 118, 140 70, 206 70 Z">
        <g fill="#ffd2c6" opacity="0.6">
          <circle cx="170" cy="104" r="9" />
          <circle cx="236" cy="96" r="7" />
          <circle cx="262" cy="128" r="10" />
          <circle cx="146" cy="138" r="6" />
          <circle cx="206" cy="122" r="5" />
        </g>
        <ellipse cx="172" cy="96" rx="34" ry="12" fill="rgb(255 255 255 / 0.25)" transform="rotate(-16 172 96)" />
      </HeadShape>
      <ellipse cx="144" cy="214" rx="15" ry="9" fill="#ff5f7a" opacity="0.45" />
      <ellipse cx="268" cy="214" rx="15" ry="9" fill="#ff5f7a" opacity="0.45" />
      <g data-part="eyes">
        <Eye cx={168} cy={180} r={20} iris="#2a2a4a" />
        <Eye cx={244} cy={180} r={20} iris="#2a2a4a" k={0.9} />
        <Lashes l={[151, 168]} r={[260, 168]} />
      </g>
      <Pair l="M148 148 Q 162 140 180 146" mid={206} stroke="#a43a34" width={4.5} />
      <path data-part="smile" d="M194 224 Q 206 234 218 224" fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
      <Mouth id="octopus" x={206} y={222} w={12} h={22} fill="#5a1a24" line={INK} teeth="none" />
    </Placed>
  );
}

/** The dragon's left ear fin (the right is its mirror): a soft swept-back flap with a second, smaller one under it. */
const DRAGON_FIN = 'M150 122 C 132 110, 116 92, 112 70 C 132 80, 152 96, 170 110 Z M136 140 C 118 136, 104 126, 96 112 C 114 116, 130 122, 144 130 Z';

/**
 * A baby dragon's face, drawn cute and kept clear of famous cartoon dragons (not purple, no glasses, no long
 * whiskered noodle body, and its own face rather than any film dragon's): a round charcoal head with swept-back
 * ear fins (`ear-l` / `ear-r`, so they wiggle and the cowboy hat hides them), a row of little dark spines on the
 * crown, a slightly lighter snout with two nostrils, big lime-green eyes and a grin with two tiny fangs. On a
 * flourish it puffs a little cloud of smoke from its nostrils (`smoke`, rig.ts); the wings and tail are on the
 * figure (`FIGURES.dragon`).
 */
export function DragonFace() {
  // the girl dragon is pearl white with sky-blue eyes; the boy charcoal with lime eyes (own gradient ids, so a
  // page showing both keeps each its colours)
  const girl = useContext(GirlContext);
  const k = girl ? 'drw' : 'dr';
  const c = girl
    ? { skin: ['#ffffff', '#e6e8f0', '#a9adbd'], snout: ['#ffffff', '#d4d7e2'], fin: ['#f4f5fa', '#b4b8c8'], spines: '#c4c8d6', iris: '#5ab8f0', brow: '#8a8e9e', nose: '#7a7e8e', shine: 'rgb(255 255 255 / 0.5)' }
    : { skin: ['#6c707c', '#34373f', '#141519'], snout: ['#7a7e8a', '#3e414a'], fin: ['#5a5e6a', '#202228'], spines: '#202228', iris: '#a6d62a', brow: '#8a8e9a', nose: '#141519', shine: 'rgb(255 255 255 / 0.16)' };
  return (
    <Placed cx={206} cy={176} s={0.84}>
      <defs>
        <Shade id={`${k}-skin`} hi={c.skin[0]} mid={c.skin[1]} lo={c.skin[2]} />
        <Shade id={`${k}-snout`} hi={c.snout[0]} lo={c.snout[1]} />
        <Shade id={`${k}-fin`} hi={c.fin[0]} lo={c.fin[1]} />
      </defs>
      <g data-part="ear-l">
        <path d={DRAGON_FIN} fill={`url(#${k}-fin)`} className="ol" />
      </g>
      <g data-part="ear-r">
        <g transform="translate(412 0) scale(-1 1)">
          <path d={DRAGON_FIN} fill={`url(#${k}-fin)`} className="ol" />
        </g>
      </g>
      <path d="M188 100 L 194 84 L 204 98 L 212 82 L 222 98 L 230 86 L 234 102 Z" fill={c.spines} className="ol-thin" />
      <HeadShape id={girl ? 'dragon-white' : 'dragon'} fill={`url(#${k}-skin)`} d="M206 94 C 264 94, 300 128, 302 172 C 304 222, 264 256, 206 256 C 148 256, 108 222, 110 172 C 112 128, 148 94, 206 94 Z">
        <ellipse cx="206" cy="222" rx="60" ry="34" fill={`url(#${k}-snout)`} />
        <ellipse cx="176" cy="114" rx="34" ry="11" fill={c.shine} transform="rotate(-14 176 114)" />
      </HeadShape>
      <g data-part="eyes">
        <ellipse cx={162} cy={164} rx={25} ry={23} fill="#fff" className="ol-thin" />
        <ellipse cx={164} cy={165} rx={20} ry={19} fill={c.iris} />
        <ellipse cx={165} cy={165} rx={7} ry={15} fill="#0b0b10" />
        <circle data-shine="" cx={172} cy={156} r={6} fill="#fff" />
        <circle cx={156} cy={174} r={2.4} fill="#fff" />
        <ellipse cx={250} cy={164} rx={22.5} ry={23} fill="#fff" className="ol-thin" />
        <ellipse cx={252} cy={165} rx={18} ry={19} fill={c.iris} />
        <ellipse cx={253} cy={165} rx={6.4} ry={15} fill="#0b0b10" />
        <circle data-shine="" cx={259} cy={156} r={5.5} fill="#fff" />
        <circle cx={245} cy={174} r={2.2} fill="#fff" />
        <Lashes l={[140, 152]} r={[270, 152]} />
      </g>
      <Pair l="M140 132 Q 154 124 174 130" mid={206} stroke={c.brow} width={5} />
      <ellipse cx="194" cy="206" rx="4.4" ry="3" fill={c.nose} />
      <ellipse cx="218" cy="206" rx="4.4" ry="3" fill={c.nose} />
      <g data-part="smile">
        <path d="M174 224 Q 206 246 238 224" fill="none" stroke="#0b0b0e" strokeWidth="2.8" strokeLinecap="round" />
        <path d="M184 230 L 188 238 L 192 232 Z M220 232 L 224 238 L 228 230 Z" fill="#fff" className="ol-thin" />
      </g>
      <Mouth id="dragon" x={206} y={226} w={16} h={26} fill="#5a1a24" line="#0b0b0e" />
      {/* a puff of smoke from the nostrils, on a flourish */}
      <g data-part="smoke" opacity="0">
        <circle cx="168" cy="206" r="10" className="smoke" />
        <circle cx="150" cy="194" r="13" className="smoke" />
        <circle cx="244" cy="206" r="10" className="smoke" />
        <circle cx="262" cy="194" r="13" className="smoke" />
      </g>
    </Placed>
  );
}

/**
 * A frog's face, drawn cute: a wide round green head with its big eyes up on top in two bumps, a pale yellow
 * chin, two nostril dots, rosy cheeks and the wide frog grin. Hats sit up over the eye bumps (`fit.lift`). The
 * frog hops on the beat (`FIGURES.frog`, `move: 'hop'`).
 */
export function FrogFace() {
  return (
    <Placed cx={206} cy={180} s={0.84}>
      <defs>
        <Shade id="fr-skin" hi="#a8ec7a" mid="#5cc04a" lo="#2e7e2c" />
        <Shade id="fr-chin" hi="#fffbd8" lo="#ecdf8e" />
      </defs>
      {/* the eye bumps, behind the head so their outline joins it */}
      <circle cx="158" cy="134" r="38" fill="url(#fr-skin)" className="ol" />
      <circle cx="254" cy="134" r="38" fill="url(#fr-skin)" className="ol" />
      <HeadShape id="frog" fill="url(#fr-skin)" d="M206 128 C 282 128, 318 156, 316 194 C 314 234, 270 258, 206 258 C 142 258, 98 234, 96 194 C 94 156, 130 128, 206 128 Z">
        <path d="M110 220 Q 206 206 302 220 Q 290 262 206 262 Q 122 262 110 220 Z" fill="url(#fr-chin)" />
        <circle cx="158" cy="134" r="35" fill="url(#fr-skin)" />
        <circle cx="254" cy="134" r="35" fill="url(#fr-skin)" />
      </HeadShape>
      <ellipse cx="128" cy="204" rx="15" ry="9" fill="#ff8f9c" opacity="0.5" />
      <ellipse cx="284" cy="204" rx="15" ry="9" fill="#ff8f9c" opacity="0.5" />
      <g data-part="eyes">
        <Eye cx={158} cy={136} r={24} iris="#e0602a" />
        <Eye cx={254} cy={136} r={24} iris="#e0602a" k={0.92} />
        <Lashes l={[138, 122]} r={[274, 122]} />
      </g>
      <Pair l="M134 98 Q 150 90 170 96" mid={206} stroke="#2e7e2c" width={4.5} />
      <circle cx="198" cy="186" r="2.4" fill="#2e6e2a" />
      <circle cx="214" cy="186" r="2.4" fill="#2e6e2a" />
      <path data-part="smile" d="M140 206 Q 206 246 272 206 M136 201 Q 138 208 145 210 M276 201 Q 274 208 267 210" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />
      <Mouth id="frog" x={206} y={214} w={24} h={30} fill="#5a1a24" line={INK} teeth="none" />
    </Placed>
  );
}

/** The bunny's left ear (upright) and right ear (flopped over at the tip). */
const BUNNY_EAR = 'M162 120 C 146 80, 144 30, 160 10 C 178 26, 186 76, 186 116 Z';
const BUNNY_EAR_IN = 'M166 112 C 156 80, 154 42, 162 26 C 172 42, 178 78, 178 110 Z';

/**
 * A bunny's face, drawn cute and kept clear of famous cartoon rabbits (no carrot, no waistcoat or pocket watch,
 * no blue jacket): a round cream head, two long pink-lined ears (`ear-l` / `ear-r`, so they bounce on the beat;
 * one stands up, the other flops over at the tip) that stand up out of most hats, a pink button nose, whiskers,
 * big brown eyes, rosy cheeks and two buck teeth under the smile.
 */
export function BunnyFace() {
  return (
    <Placed cx={206} cy={178} s={0.84}>
      <defs>
        <Shade id="bn-fur" hi="#ffffff" mid="#f4ece2" lo="#cfc2b4" />
      </defs>
      <g data-part="ear-l">
        <path d={BUNNY_EAR} fill="url(#bn-fur)" className="ol" />
        <path d={BUNNY_EAR_IN} fill="#ffc4cf" />
      </g>
      <g data-part="ear-r">
        <g transform="translate(412 0) scale(-1 1)">
          <path d="M162 120 C 150 96, 146 72, 150 56 C 132 54, 118 66, 112 80 C 130 72, 146 74, 160 82 C 170 96, 180 108, 186 116 Z" fill="url(#bn-fur)" className="ol" />
          <path d="M166 112 C 158 98, 152 84, 152 70 C 140 70, 130 74, 124 80 C 138 78, 150 84, 160 94 C 168 102, 174 108, 178 110 Z" fill="#ffc4cf" />
        </g>
      </g>
      <HeadShape id="bunny" fill="url(#bn-fur)" d="M206 98 C 264 98, 300 132, 300 176 C 300 222, 262 254, 206 254 C 150 254, 112 222, 112 176 C 112 132, 148 98, 206 98 Z">
        <ellipse cx="206" cy="222" rx="44" ry="28" fill="#ffffff" opacity="0.7" />
        <ellipse cx="176" cy="118" rx="34" ry="11" fill="rgb(255 255 255 / 0.6)" transform="rotate(-14 176 118)" />
      </HeadShape>
      <ellipse cx="140" cy="210" rx="15" ry="9" fill="#ff8f9c" opacity="0.55" />
      <ellipse cx="272" cy="210" rx="15" ry="9" fill="#ff8f9c" opacity="0.55" />
      <g data-part="eyes">
        <Eye cx={166} cy={170} r={18} iris="#6a3a1a" />
        <Eye cx={246} cy={170} r={18} iris="#6a3a1a" k={0.9} />
        <Lashes l={[151, 159]} r={[260, 159]} />
      </g>
      <Pair l="M148 142 Q 162 134 180 140" mid={206} stroke="#b8a898" width={4} />
      <g data-part="whisker-l" className="whiskers bunny-whiskers">
        <path d="M178 214 L 132 206 M178 220 L 130 224" />
      </g>
      <g data-part="whisker-r" className="whiskers bunny-whiskers">
        <path d="M234 214 L 280 206 M234 220 L 282 224" />
      </g>
      <path d="M198 200 Q 206 196 214 200 Q 212 208 206 210 Q 200 208 198 200 Z" fill="#ff8aa0" className="ol-thin" />
      <path d="M206 210 V216" stroke="#8a6a5a" strokeWidth="2.2" strokeLinecap="round" />
      <g data-part="smile">
        <path d="M192 218 Q 199 226 206 218 Q 213 226 220 218" fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
        <path d="M199 222 H205 V232 Q 202 234 199 232 Z M207 222 H213 V232 Q 210 234 207 232 Z" fill="#fff" className="ol-thin" />
      </g>
      <Mouth id="bunny" x={206} y={220} w={13} h={24} fill="#5a1a24" line={INK} />
    </Placed>
  );
}

/**
 * A red panda's face, drawn cute and kept clear of famous cartoon red pandas: a round rusty-red head, pointed
 * ears with white rims (`ear-l` / `ear-r`), white brow spots, cheeks and muzzle, dark tear marks running down from
 * the eyes, big brown eyes and a little black nose. Its legs and arms are dark and its tail ringed
 * (`FIGURES.redPanda`).
 */
export function RedPandaFace() {
  const ear = (
    <>
      <path d="M126 140 C 112 108, 118 80, 146 78 C 170 78, 184 98, 186 118 Z" fill="#fff6ee" className="ol" />
      <path d="M134 132 C 126 110, 132 92, 148 92 C 164 92, 174 104, 176 118 Z" fill="#7a2e14" />
    </>
  );
  return (
    <Placed cx={206} cy={176} s={0.84}>
      <defs>
        <Shade id="rp-fur" hi="#f08a52" mid="#d0602c" lo="#8e3412" />
        <Shade id="rp-white" hi="#ffffff" lo="#f0e4d8" />
      </defs>
      <g data-part="ear-l">{ear}</g>
      <g data-part="ear-r">
        <g transform="translate(412 0) scale(-1 1)">{ear}</g>
      </g>
      <HeadShape
        id="red-panda"
        fill="url(#rp-fur)"
        d="M206 96 C 264 96, 298 128, 300 168 Q 318 182 312 198 Q 306 206 296 210 C 282 242, 248 258, 206 258 C 164 258, 130 242, 116 210 Q 106 206 100 198 Q 94 182 112 168 C 114 128, 148 96, 206 96 Z"
      >
        {/* white cheeks and muzzle, white spots over the eyes */}
        <path d="M100 198 Q 112 176 140 182 Q 170 190 206 190 Q 242 190 272 182 Q 300 176 312 198 Q 306 206 296 210 C 282 242, 248 258, 206 258 C 164 258, 130 242, 116 210 Q 106 206 100 198 Z" fill="url(#rp-white)" />
        <ellipse cx="160" cy="140" rx="17" ry="10" fill="url(#rp-white)" transform="rotate(-12 160 140)" />
        <ellipse cx="252" cy="140" rx="17" ry="10" fill="url(#rp-white)" transform="rotate(12 252 140)" />
        {/* tear marks from the eyes down to the jaw */}
        <path d="M150 182 C 146 204, 152 228, 170 246 C 164 224, 166 204, 172 186 Z M262 182 C 266 204, 260 228, 242 246 C 248 224, 246 204, 240 186 Z" fill="#8e3412" />
        <ellipse cx="176" cy="114" rx="34" ry="11" fill="rgb(255 255 255 / 0.2)" transform="rotate(-14 176 114)" />
      </HeadShape>
      <g data-part="eyes">
        <Eye cx={164} cy={170} r={18} iris="#4a2412" />
        <Eye cx={248} cy={170} r={18} iris="#4a2412" k={0.9} />
        <Lashes l={[149, 159]} r={[262, 159]} />
      </g>
      <Pair l="M146 124 Q 160 116 178 122" mid={206} stroke="#8e3412" width={4.5} />
      <path d="M194 202 Q 206 194 218 202 Q 216 212 206 216 Q 196 212 194 202 Z" fill="#17120f" className="ol-thin" />
      <ellipse cx="201" cy="201" rx="4" ry="1.6" fill="rgb(255 255 255 / 0.6)" />
      <path d="M206 216 V222" stroke="#5a3a2a" strokeWidth="2.4" strokeLinecap="round" />
      <path data-part="smile" d="M190 224 Q 198 232 206 224 Q 214 232 222 224" fill="none" stroke={INK} strokeWidth="2.8" strokeLinecap="round" />
      <Mouth id="red-panda" x={206} y={224} w={14} h={26} fill="#5a1a24" line={INK} />
    </Placed>
  );
}

/** A feather of the turkey's crest (the middle one; the others are turned copies), curling over at the tip. */
const TURKEY_CREST = 'M206 100 C 200 82, 204 64, 218 56 C 226 52, 232 60, 226 66 C 218 72, 214 84, 214 100 Z';

/**
 * A turkey's face, an original college-mascot-style bird in maroon and orange: a round maroon head with a curl
 * of crest feathers on top, big white eyes with dark irises under bold brows, an orange beak hooked down at
 * the tip with the singing mouth under it, and a little red wattle at the chin. No ears, so hats sit on the
 * round head; the fan of tail feathers, the wings and the orange feet are on the figure (`FIGURES.turkey`).
 */
export function TurkeyFace() {
  return (
    <Placed cx={206} cy={176} s={0.84}>
      <defs>
        <Shade id="tk-skin" hi="#b0405e" mid="#861f3c" lo="#560f24" />
        <Shade id="tk-beak" hi="#ffb25a" lo="#e86a10" />
      </defs>
      {[-24, 0, 22].map((r) => (
        <path key={r} d={TURKEY_CREST} transform={`rotate(${r} 210 104)`} fill="url(#tk-skin)" className="ol-thin" />
      ))}
      <HeadShape id="turkey" fill="url(#tk-skin)" d="M206 94 C 266 94, 300 130, 300 176 C 300 224, 262 254, 206 254 C 150 254, 112 224, 112 176 C 112 130, 146 94, 206 94 Z">
        <ellipse cx="176" cy="116" rx="34" ry="11" fill="rgb(255 255 255 / 0.18)" transform="rotate(-14 176 116)" />
      </HeadShape>
      <g data-part="eyes">
        <ellipse cx={168} cy={168} rx={24} ry={26} fill="#fff" className="ol-thin" />
        <ellipse cx={244} cy={168} rx={22} ry={26} fill="#fff" className="ol-thin" />
        <ellipse cx={172} cy={174} rx={11} ry={13} fill="#1b1012" />
        <ellipse cx={246} cy={174} rx={10} ry={13} fill="#1b1012" />
        <circle data-shine="" cx={176} cy={168} r={4.4} fill="#fff" />
        <circle data-shine="" cx={250} cy={168} r={4} fill="#fff" />
        <Lashes l={[146, 152]} r={[264, 152]} />
      </g>
      <Pair l="M142 136 Q 160 124 184 132" mid={206} stroke="#2a0a14" width={6} />
      <path data-part="smile" d="M184 228 Q 206 242 228 228" fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
      <Mouth id="turkey" x={206} y={224} w={16} h={26} fill="#5a1a24" line={INK} teeth="none" />
      {/* the beak, hooked down at the tip, and a little red wattle under the chin */}
      <path d="M182 202 Q 206 188 230 202 Q 236 216 222 222 Q 214 226 210 234 Q 206 240 202 234 Q 198 226 190 222 Q 176 216 182 202 Z" fill="url(#tk-beak)" className="ol-thin" />
      <path d="M190 210 Q 206 216 222 210" fill="none" stroke="rgb(0 0 0 / 0.2)" strokeWidth="1.6" />
      <ellipse cx="198" cy="200" rx="7" ry="2" fill="rgb(255 255 255 / 0.7)" />
      <path d="M232 236 C 240 244, 240 258, 232 262 C 224 258, 224 246, 232 236 Z" fill="#d8283a" className="ol-thin" />
    </Placed>
  );
}

/** The opossum's left ear (the right is its mirror): a round, thin black ear with a pale rim along the top. */
function OpossumEar() {
  return (
    <g transform="rotate(-16 128 112)">
      <ellipse cx="128" cy="112" rx="30" ry="32" fill="#f4e8ec" className="ol" />
      <ellipse cx="129" cy="115" rx="27" ry="29" fill="#26212a" />
      <ellipse cx="132" cy="120" rx="15" ry="17" fill="#4a3a46" />
    </g>
  );
}

/**
 * An opossum's face, an original cute take: a pale head with a soft grey crown and a grey stripe down the
 * forehead, round thin black ears with pale rims (`ear-l` / `ear-r`), big dark shiny eyes in soft grey rings, a
 * long white snout tapering to a big pink nose, and whiskers. It sings with a mouthful of little teeth (opossums
 * have fifty). On a flourish it plays dead for a moment (`play-dead`, rig.ts): crossed-out eyes and its tongue
 * lolling out. The pink-tipped hands and feet and the long bare pink tail are on the figure (`FIGURES.opossum`).
 */
export function OpossumFace() {
  return (
    <Placed cx={206} cy={176} s={0.84}>
      <defs>
        <Shade id="op-fur" hi="#ffffff" mid="#f3eff0" lo="#d6cfd2" />
        <Shade id="op-grey" hi="#a49ca4" mid="#857c86" lo="#5c545e" />
      </defs>
      <g data-part="ear-l">
        <OpossumEar />
      </g>
      <g data-part="ear-r">
        <g transform="translate(412 0) scale(-1 1)">
          <OpossumEar />
        </g>
      </g>
      <HeadShape
        id="opossum"
        fill="url(#op-fur)"
        d="M206 96 C 262 96, 298 126, 300 166 Q 314 178 308 194 Q 298 200 292 206 C 276 232, 246 252, 206 262 C 166 252, 136 232, 120 206 Q 114 200 104 194 Q 98 178 112 166 C 114 126, 150 96, 206 96 Z"
      >
        {/* a grey crown between the ears, running down the forehead in a stripe to the snout */}
        <path d="M90 60 H 322 V 136 Q 286 122 254 128 Q 226 134 216 156 Q 210 172 206 182 Q 202 172 196 156 Q 186 134 158 128 Q 126 122 90 136 Z" fill="url(#op-grey)" />
        <path d="M120 140 Q 160 124 190 140" fill="none" stroke="#5c545e" strokeWidth="2" opacity="0.5" />
        {/* soft grey rings round the eyes */}
        <ellipse cx="164" cy="172" rx="26" ry="24" fill="#8a8088" opacity="0.38" />
        <ellipse cx="248" cy="172" rx="25" ry="24" fill="#8a8088" opacity="0.38" />
        {/* the snout: a whiter wedge narrowing down to the nose */}
        <path d="M206 186 C 190 194, 178 210, 180 226 Q 206 246 232 226 C 234 210, 222 194, 206 186 Z" fill="#ffffff" opacity="0.85" />
        <ellipse cx="172" cy="110" rx="30" ry="9" fill="rgb(255 255 255 / 0.22)" transform="rotate(-14 172 110)" />
      </HeadShape>
      <g data-part="eyes">
        <Eye cx={164} cy={170} r={17} iris="#2a1c26" />
        <Eye cx={248} cy={170} r={17} iris="#2a1c26" k={0.9} />
        <Lashes l={[150, 159]} r={[262, 159]} />
      </g>
      <Pair l="M146 140 Q 160 133 178 138" mid={206} stroke="#4a424c" width={4.5} />
      <g data-part="whisker-l" className="whiskers opossum-whiskers">
        <path d="M184 216 L 132 206 M184 222 L 130 226" />
      </g>
      <g data-part="whisker-r" className="whiskers opossum-whiskers">
        <path d="M228 216 L 280 206 M228 222 L 282 226" />
      </g>
      {/* the big pink nose at the tip of the snout */}
      <path d="M190 208 Q 206 196 222 208 Q 220 222 206 224 Q 192 222 190 208 Z" fill="#f28ca4" className="ol-thin" />
      <ellipse cx="201" cy="205" rx="5" ry="2" fill="rgb(255 255 255 / 0.7)" />
      <path d="M200 214 q 2 2 0 4 M212 214 q -2 2 0 4" fill="none" stroke="#a84a64" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M206 224 V230" stroke="#8a5a6a" strokeWidth="2.2" strokeLinecap="round" />
      <path data-part="smile" d="M192 232 Q 199 239 206 232 Q 213 239 220 232" fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
      <Mouth id="opossum" x={206} y={231} w={13} h={24} fill="#5a1a24" line={INK} teeth="rows" />
      {/* playing dead, on a flourish: fur over the eyes, crossed out, and the tongue lolling from the corner */}
      <g data-part="play-dead" opacity="0">
        <ellipse cx="164" cy="170" rx="21" ry="20" fill="#e6e0e3" />
        <ellipse cx="248" cy="170" rx="19" ry="20" fill="#e6e0e3" />
        <path d="M152 158 L 176 182 M176 158 L 152 182 M237 158 L 259 182 M259 158 L 237 182" stroke={INK} strokeWidth="5" strokeLinecap="round" />
        <path d="M214 232 C 216 246, 222 256, 230 254 C 236 252, 234 242, 226 232 Z" fill="#f07a92" className="ol-thin" />
        <path d="M220 236 Q 224 244 228 248" fill="none" stroke="#b84a64" strokeWidth="1.6" strokeLinecap="round" />
      </g>
    </Placed>
  );
}
