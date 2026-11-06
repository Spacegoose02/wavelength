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
export function Bow({ x, y, rot = -20, s = 1 }: { x: number; y: number; rot?: number; s?: number }) {
  if (!useContext(GirlContext)) return null;
  return (
    <g className="girl-bow" transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`}>
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

