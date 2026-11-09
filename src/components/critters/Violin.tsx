import { useRef } from 'react';
import { beatClock, bend } from './arm';
import { swell, windUp } from './flourish';
import { Arm, ArmHand, Body, BodyOutfits, CritterFrame, Head, Legs, Shadow, Skirt } from './parts';
import type { ActProps } from './species';
import { useCritterRig } from './rig';

/** The bow's direction from the hand to its tip (unit vector), and its length. */
const BOW: [number, number] = [0.79, -0.61];
const BOW_LEN = 132;
/** Raindrops: x, where in the fall each starts (0..1), speed, length. */
const RAIN = Array.from({ length: 34 }, (_, i) => [((i * 97) % 400) + 4, (i * 0.37) % 1, 0.8 + ((i * 13) % 7) / 10, 10 + (i % 4) * 3] as const);
/** Puddles on the pavement: centre x, y and half-width; each ripples on the beat in turn. */
const PUDDLES: [number, number, number][] = [
  [64, 378, 34], [318, 386, 40], [214, 394, 22],
];
/** Bricks: rows of the wall behind. */
const BRICK_ROWS = Array.from({ length: 13 }, (_, i) => 52 + i * 22);

const f1 = (n: number) => n.toFixed(1);

/**
 * Busking in the rain: the critter plays the violin on a city street at night, under a street lamp, by a brick
 * wall with a lit window where a cat nods along, in a long coat with the collar up, a scarf and a flat cap
 * (girls: the coat over a skirt and a bow). The coat, scarf and the window's glow take the skin's colours; the
 * street, lamp and rain are fixed. The bow saws along its length, one stroke per beat (down, then up),
 * longer and faster when the band is loud and with a quick tremolo on strong highs; the fingers walk up and
 * down the neck. The rain falls harder with the bass, the puddles ripple on the beat, the lamp's light swells
 * and coins glint in the open violin case. Flourish: a long sweeping stroke, with the bow lifted high off the
 * strings at the end. Paused, the bow rests on the strings.
 */
export function Violin({ species, still }: ActProps) {
  const root = useRef<SVGSVGElement>(null);
  const state = useRef({ stroke: 0, rain: 0, beat: -1, ripple: 0, rippleAt: 0, finger: 0 });

  useCritterRig(
    root,
    (f) => {
      const { t, a, idle, bob, hit, rock, flourish, $ } = f;
      const s = state.current;
      const svg = root.current!;
      const { phase, index } = beatClock(f);
      if (index !== s.beat && a.playing) {
        s.ripple = 1;
        s.rippleAt = index % PUDDLES.length;
      }
      s.beat = index;

      // the bow: down-bow over one beat, up-bow over the next, a fuller stroke when loud; tremolo on strong highs
      const reach = idle ? 0 : 10 + (a.live ? Math.min(1, (a.bass + a.mid) * 0.8) * 14 : 8);
      const dir = index % 2 === 0 ? 1 : -1;
      let along = idle ? Math.sin(t * 0.6) * 2 : dir * (phase * 2 - 1) * reach;
      if (hit) along += rock * 4;
      // flourish: one long sweep, then the bow lifted off the strings and up
      const sweep = flourish ? windUp(flourish) : 0;
      const lifted = flourish > 0.6 ? swell((flourish - 0.6) / 0.4 / 2) : 0;
      if (flourish) along = -24 + sweep * 48;
      s.stroke += (along - s.stroke) * 0.5;
      // move the hand along the bow, and keep the bow at the same slant whatever the forearm does
      const to: [number, number] = [-BOW[0] * s.stroke, -BOW[1] * s.stroke - lifted * 26];
      $('arm-l').setAttribute('transform', `rotate(${f1(lifted * 30)} 138 268)`);
      const [, , rot] = bend($, 'arm-l', { to });
      bend($, 'arm-l', { to, wrist: -rot - lifted * 30 });
      // the fingers walk along the neck with the melody (the highs)
      s.finger += ((idle ? 0 : a.live ? a.treble * 2 - 0.6 : Math.sin(t * 2)) - s.finger) * 0.15;
      const tap = idle ? 0 : Math.abs(Math.sin(Math.PI * ((phase * 2) % 1)));
      $('arm-r').setAttribute('transform', `rotate(${f1(idle ? Math.sin(t * 0.8) : -s.finger * 3)} 262 268)`);
      bend($, 'arm-r', { to: [-s.finger * 6, tap * 2], wrist: tap * 6 });

      // the violin rides with the body's bob
      $('violin').setAttribute('transform', `translate(0 ${f1(a.playing ? bob * 2 : 0)}) rotate(${f1(a.playing ? Math.sin(Math.PI * (index + phase)) * 2 : 0)} 228 268)`);

      // rain falls harder with the bass
      s.rain += (1.2 + (a.playing ? a.bass * 1.6 : 0)) / 60;
      svg.querySelectorAll<SVGElement>('[data-drop]').forEach((d, i) => {
        const [x, start, speed] = RAIN[i];
        const p = (s.rain * speed + start) % 1;
        d.setAttribute('transform', `translate(${f1(x - p * 20)} ${f1(-20 + p * 420)})`);
      });
      // puddles ripple on the beat, one at a time
      s.ripple *= 0.94;
      svg.querySelectorAll<SVGElement>('[data-ripple]').forEach((r, i) => {
        const k = i === s.rippleAt ? 1 - s.ripple : 1;
        const [x, y] = PUDDLES[i];
        r.setAttribute('transform', `translate(${x} ${y}) scale(${(0.2 + k * 0.7).toFixed(3)}) translate(${-x} ${-y})`);
        r.style.opacity = (i === s.rippleAt ? s.ripple : 0).toFixed(2);
      });
      $('lamp-light').style.opacity = (0.55 + (a.playing ? a.bass * 0.3 + bob * 0.1 : 0)).toFixed(2);
      $('lamp-glow').style.opacity = (0.7 + (a.playing ? bob * 0.3 : 0) - (Math.sin(t * 31) > 0.985 ? 0.4 : 0)).toFixed(2);
      $('window').style.opacity = (0.75 + (a.playing ? a.mid * 0.25 : 0)).toFixed(2);
      // the cat in the window nods along
      $('cat').setAttribute('transform', `rotate(${f1(a.playing ? Math.sin(Math.PI * (index + phase)) * 8 : Math.sin(t * 0.5) * 2)} 300 150)`);
      // coins glint in turn
      svg.querySelectorAll<SVGElement>('[data-glint]').forEach((g, i) => {
        g.style.opacity = (Math.max(0, Math.sin(t * 1.3 + i * 2.1)) ** 8).toFixed(2);
      });
    },
    { still, nod: 8 },
  );

  return (
    <CritterFrame ref={root} kind="violin" species={species} label={`A ${species.noun} playing the violin on a rainy street at night`}>
      <defs>
        <linearGradient id="violin-cone" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe6a0" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ffe6a0" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* night sky over the rooftops, a brick wall with a lit window, the pavement */}
      <rect className="night-sky" x="0" y="0" width="400" height="60" />
      <rect className="brick-wall" x="0" y="40" width="400" height="300" />
      {BRICK_ROWS.map((y, r) => (
        <g key={y}>
          <path className="brick-line" d={`M0 ${y} H400`} strokeWidth="2" />
          <path className="brick-line" d={Array.from({ length: 10 }, (_, i) => `M${i * 44 + (r % 2 ? 22 : 0)} ${y - 22} V${y}`).join(' ')} strokeWidth="2" />
        </g>
      ))}
      <path className="roof-edge" d="M0 40 H400" strokeWidth="6" />
      {/* the window, with a cat on the sill */}
      <rect className="window-frame ol-thin" x="252" y="88" width="96" height="88" rx="3" />
      <rect data-part="window" className="window-glow" x="258" y="94" width="84" height="76" />
      <g data-part="cat">
        <path className="cat" d="M282 170 Q 280 140 300 136 Q 320 140 318 170 Z" />
        <path className="cat" d="M286 142 Q 284 124 290 118 L 296 130 H304 L 310 118 Q 316 124 314 142 Q 300 156 286 142 Z" />
        <circle cx="294" cy="134" r="2" className="cat-eye" /><circle cx="306" cy="134" r="2" className="cat-eye" />
        <path className="cat" d="M318 166 Q 336 162 330 146" fill="none" strokeWidth="5" strokeLinecap="round" />
      </g>
      <path className="window-frame" d="M300 94 V170 M258 132 H342" strokeWidth="4" />
      <rect className="window-sill ol-thin" x="246" y="174" width="108" height="8" rx="2" />

      {/* the street lamp, its light pooling on the pavement */}
      <path data-part="lamp-light" d="M48 96 L 4 380 H150 Z" fill="url(#violin-cone)" />
      <rect className="pavement" x="0" y="336" width="400" height="64" />
      <path className="kerb" d="M0 338 H400 M0 368 L 40 400 M100 338 L 90 400 M220 338 L 230 400 M340 338 L 370 400" strokeWidth="2" fill="none" />
      {PUDDLES.map(([x, y, w], i) => (
        <g key={x}>
          <ellipse className="puddle" cx={x} cy={y} rx={w} ry={w * 0.18} />
          <ellipse className="puddle-shine" cx={x - w * 0.3} cy={y - 1} rx={w * 0.3} ry={w * 0.05} />
          <ellipse data-ripple={i} className="ripple" cx={x} cy={y} rx={w * 0.9} ry={w * 0.16} fill="none" strokeWidth="2" style={{ opacity: 0 }} />
        </g>
      ))}
      <Shadow cx={48} cy={384} rx={20} ry={4} />
      <path className="lamp-post" d="M48 386 V100" strokeWidth="7" />
      <path className="lamp-post" d="M38 386 H58 M42 378 H54" strokeWidth="6" />
      <path className="lamp-head ol-thin" d="M30 96 L 66 96 L 58 74 L 38 74 Z" />
      <circle data-part="lamp-glow" className="lamp-bulb" cx="48" cy="92" r="9" filter="url(#critter-glow)" />
      <path className="lamp-head" d="M36 74 L 48 62 L 60 74 Z" />

      {/* the open violin case, with coins */}
      <Shadow cx={334} cy={382} rx={52} ry={4} />
      <path className="case ol" d="M290 352 Q 286 334 310 334 Q 330 330 344 338 Q 360 330 372 334 Q 384 340 380 352 Z" />
      <path className="case ol" d="M286 356 Q 284 380 300 380 H368 Q 384 380 382 356 Z" />
      <path className="case-lining" d="M292 358 Q 292 374 304 374 H364 Q 376 374 376 358 Z" />
      {[[312, 366], [328, 364], [344, 367], [358, 364]].map(([x, y], i) => (
        <g key={x}>
          <ellipse className="coin ol-thin" cx={x} cy={y} rx="5" ry="3" />
          <path data-glint="" className="glint" d={`M${x + 1} ${y - 7} v 6 M${x - 2} ${y - 4} h 6`} strokeWidth="1.6" strokeLinecap="round" style={{ opacity: i === 0 ? 1 : 0 }} />
        </g>
      ))}

      <Shadow cx={200} cy={366} rx={62} />
      <Legs species={species} shoe="boot-black" />

      <Body species={species}>
        {/* a long coat: lapels, the collar up, a belt and two rows of buttons, a scarf */}
        <path className="coat-shade ol-thin" d="M178 244 L 200 296 L 168 284 Z M222 244 L 200 296 L 232 284 Z" />
        <path className="coat-belt" d="M140 316 H260" strokeWidth="8" />
        <rect className="buckle" x="192" y="311" width="16" height="10" rx="2" fill="none" strokeWidth="2.5" />
        {[[188, 290], [212, 290], [188, 304], [212, 304]].map(([x, y]) => <circle key={`${x}${y}`} className="coat-button" cx={x} cy={y} r="2.6" />)}
        <path className="scarf ol-thin" d="M172 244 Q 200 260 228 244 L 230 256 Q 200 272 170 256 Z" />
        <path className="scarf ol-thin" d="M212 258 L 224 300 L 210 302 L 202 262 Z" />
        <path d="M212 296 l 2 8 M218 296 l 2 8" className="scarf-fringe" strokeWidth="2" strokeLinecap="round" />
        <BodyOutfits />
      </Body>
      <Skirt species={species} style="aline" className="coat-skirt" />

      <Head
        species={species}
        hat={
          <g data-part="adjust" className="own-hat">
            {/* a flat cap */}
            <path className="flatcap ol" d="M138 122 Q 136 80 196 76 Q 256 76 264 112 Q 266 124 254 126 Z" />
            <path className="flatcap ol" d="M160 122 Q 210 112 270 120 Q 286 128 272 136 Q 214 132 150 130 Z" />
            <path d="M156 100 Q 200 88 248 100" stroke="rgb(0 0 0 / 0.18)" strokeWidth="2" fill="none" />
            <circle className="flatcap ol-thin" cx="200" cy="80" r="4" />
          </g>
        }
      />

      {/* the fingering arm (right of picture) goes under the violin; only its hand comes over the neck */}
      <Arm part="arm-r" d="M262 268 Q 268 352 304 302" hand={[304, 302]} handLater />
      {/* the violin, tucked under the chin and held out to the side */}
      <g data-part="violin">
        <g transform="translate(238 266) rotate(22) scale(1.4) translate(-238 -266)">
          <path className="violin-neck ol-thin" d="M256 263 H298 V269 H256 Z" />
          <path className="violin-scroll ol-thin" d="M298 261 Q 310 259 310 266 Q 310 273 298 271 Z" />
          <path d="M300 262 l -1 -4 M304 262 l 0 -5 M300 270 l -1 4 M304 270 l 0 5" stroke="#2a1608" strokeWidth="1.8" strokeLinecap="round" />
          <path className="violin-body ol" d="M208 266 C 208 250, 220 250, 226 255 C 230 258, 234 258, 238 255 C 244 250, 258 250, 258 266 C 258 282, 244 282, 238 277 C 234 274, 230 274, 226 277 C 220 282, 208 282, 208 266 Z" />
          <path d="M212 258 Q 220 254 226 258" stroke="rgb(255 255 255 / 0.35)" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M223 260 q -3 6 0 12 M243 260 q 3 6 0 12" stroke="#2a1608" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          <path className="violin-neck" d="M240 264 H258 V268 H240 Z" />
          <rect className="violin-bridge" x="231" y="259" width="2.6" height="14" rx="1" />
          <path className="violin-chin" d="M208 260 Q 204 266 208 272 L 214 270 L 214 262 Z" />
          <path className="violin-string" d="M212 264.5 H304 M212 267.5 H304" strokeWidth="0.7" />
        </g>
      </g>

      {/* the bow hand (left of picture); the fingering hand's comes after the violin */}
      <ArmHand part="arm-r" d="M262 268 Q 268 352 304 302" hand={[304, 302]} />
      <Arm part="arm-l" d="M138 268 Q 132 312 172 304" hand={[174, 304]}>
        {([x, y]) => (
          <g>
            <path className="bow-stick" d={`M${x} ${y} L ${f1(x + BOW[0] * BOW_LEN)} ${f1(y + BOW[1] * BOW_LEN)}`} strokeWidth="4" strokeLinecap="round" />
            <path className="bow-hair" d={`M${f1(x + 4)} ${f1(y + 4)} L ${f1(x + BOW[0] * (BOW_LEN - 4) + 3)} ${f1(y + BOW[1] * (BOW_LEN - 4) + 4)}`} strokeWidth="2.2" />
            <rect className="bow-frog ol-thin" x={x - 5} y={y - 4} width="10" height="7" rx="1.5" transform={`rotate(${f1((Math.atan2(BOW[1], BOW[0]) * 180) / Math.PI)} ${x} ${y})`} />
          </g>
        )}
      </Arm>
      {/* rain over everything */}
      {RAIN.map(([, , , len], i) => (
        <path key={i} data-drop="" className="raindrop" d={`M0 0 l -3 ${len}`} strokeWidth="1.6" strokeLinecap="round" />
      ))}
    </CritterFrame>
  );
}
