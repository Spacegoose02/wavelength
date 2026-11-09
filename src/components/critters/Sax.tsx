import { useRef } from 'react';
import { beatClock, bend } from './arm';
import { swell } from './flourish';
import { Arm, Body, BodyOutfits, CritterFrame, Head, Legs, Shadow, Skirt } from './parts';
import type { ActProps } from './species';
import { useCritterRig } from './rig';

/** Where the mouthpiece meets the mouth: the sax tips about this point. */
const MOUTH: [number, number] = [210, 240];
/** Where each hand rests on the keys, as drawn (upper hand, lower hand). */
const KEYS_HI: [number, number] = [222, 278];
const KEYS_LO: [number, number] = [234, 316];
/** The bell's mouth: notes float out of here. */
const BELL: [number, number] = [286, 266];
/** City buildings behind the roof: x, width, height. */
const BUILDINGS: [number, number, number][] = [
  [0, 56, 170], [50, 44, 230], [92, 60, 150], [148, 40, 260], [186, 70, 190], [252, 46, 240], [296, 58, 160], [350, 50, 210],
];
/** Lit windows: every third or so window in each building, as x, y. */
const WINDOWS: [number, number][] = BUILDINGS.flatMap(([x, w, h], b) => {
  const out: [number, number][] = [];
  for (let wy = 340 - h + 14; wy < 316; wy += 20) {
    for (let wx = x + 8; wx < x + w - 10; wx += 14) if ((wx * 7 + wy * 3 + b) % 5 < 2) out.push([wx, wy]);
  }
  return out;
});
/** Bulbs on the string of lights across the top: x, y. */
const BULBS: [number, number][] = Array.from({ length: 11 }, (_, i) => {
  const x = 10 + i * 38;
  const u = x / 400;
  return [x, 46 + Math.sin(u * Math.PI) * 26];
});
const NOTES = 4;

const f1 = (n: number) => n.toFixed(1);

/** Where point `p` goes when turned by `deg` about `c`, as an offset from `p`. */
function turned(p: [number, number], c: [number, number], deg: number): [number, number] {
  const r = (deg * Math.PI) / 180;
  const x = p[0] - c[0];
  const y = p[1] - c[1];
  return [c[0] + x * Math.cos(r) - y * Math.sin(r) - p[0], c[1] + x * Math.sin(r) + y * Math.cos(r) - p[1]];
}

/**
 * Saxophone on a city rooftop at night: a beret and a roll-neck jumper, playing an alto sax under a string of
 * lights, with the skyline and a water tower behind. The jumper, the beret and the lights take the skin's
 * colours; the brass, the city and the roof are fixed. The sax sways with the beat, the fingers work the keys
 * with the melody, and on each beat a note floats out of the bell. Windows across the city light up and go
 * dark with the highs and the bulbs pulse on the beat. Flourish: the player leans back and lifts the bell high
 * for a long note, notes pouring out. Paused, the sax rests and the player breathes. The mouthpiece is in
 * their mouth, so they don't sing along.
 */
export function Sax({ species, still }: ActProps) {
  const root = useRef<SVGSVGElement>(null);
  const state = useRef({ tip: 0, beat: -1, notes: Array.from({ length: NOTES }, () => -1), next: 0, finger: 0, pulse: 0 });

  useCritterRig(
    root,
    (f) => {
      const { t, a, idle, bob, flourish, $ } = f;
      const s = state.current;
      const svg = root.current!;
      const { phase, index } = beatClock(f);

      // the sax sways side to side with the beat, and tips right up on a flourish
      const lift = swell(flourish);
      const sway = idle ? Math.sin(t * 0.7) * 1.5 : Math.sin(Math.PI * (index + phase)) * 5 + bob * 2;
      s.tip += (sway - lift * 26 - s.tip) * 0.2;
      $('sax').setAttribute('transform', `rotate(${f1(s.tip)} ${MOUTH[0]} ${MOUTH[1]})`);
      // the hands ride the keys wherever the sax goes, the fingers working them with the melody
      s.finger += ((idle ? 0 : a.live ? a.treble * 2.2 : 0.6 + Math.sin(t * 5) * 0.4) - s.finger) * 0.3;
      const press = idle ? 0 : Math.abs(Math.sin(t * (6 + s.finger * 6))) * Math.min(1, s.finger) * 2.5;
      const hi = turned(KEYS_HI, MOUTH, s.tip);
      const lo = turned(KEYS_LO, MOUTH, s.tip);
      bend($, 'arm-l', { to: [hi[0], hi[1] + press], wrist: s.tip * 0.6 });
      bend($, 'arm-r', { to: [lo[0], lo[1] - press * 0.6], wrist: s.tip * 0.6 });

      // a note floats out of the bell on each beat (a burst of them on a flourish)
      if (index !== s.beat && a.playing) {
        s.notes[s.next] = t;
        s.next = (s.next + 1) % NOTES;
      }
      if (flourish && Math.floor(t * 6) !== Math.floor((t - 1 / 60) * 6)) {
        s.notes[s.next] = t;
        s.next = (s.next + 1) % NOTES;
      }
      s.beat = index;
      const [bx, by] = turned(BELL, MOUTH, s.tip).map((d, i) => d + BELL[i]);
      svg.querySelectorAll<SVGElement>('[data-note]').forEach((n, i) => {
        const age = s.notes[i] < 0 ? 9 : t - s.notes[i];
        const p = Math.min(1, age / 2.2);
        n.style.opacity = age > 2.2 ? '0' : (Math.min(1, age * 6) * (1 - p)).toFixed(2);
        n.setAttribute('transform', `translate(${f1(bx + p * 50 + Math.sin(age * 4 + i) * 6)} ${f1(by - p * 120)}) rotate(${f1(Math.sin(age * 3 + i) * 14)}) scale(${(0.7 + p * 0.5).toFixed(2)})`);
      });

      // the city's windows light up and go dark with the highs; the bulbs pulse on the beat
      svg.querySelectorAll<SVGElement>('[data-win]').forEach((w, i) => {
        const on = a.playing ? Math.sin(i * 12.9898 + Math.floor(t * (0.5 + a.treble * 3)) * 3.7) > 0.1 - a.mid * 0.5 : i % 3 !== 0;
        w.style.opacity = on ? '0.95' : '0.2';
      });
      if (a.beat) s.pulse = (s.pulse + 1) % 3;
      svg.querySelectorAll<SVGElement>('[data-bulb]').forEach((b, i) => {
        b.style.opacity = (a.playing ? ((i + s.pulse) % 3 === 0 ? 0.6 + bob * 0.4 : 0.55) : 0.45 + Math.sin(t * 0.8 + i) * 0.1).toFixed(2);
      });
    },
    { still, nod: 5, talk: false },
  );

  return (
    <CritterFrame ref={root} kind="sax" species={species} label={`A ${species.noun} playing the saxophone on a city rooftop at night`}>
      {/* night sky, a crescent moon, the skyline with its windows, a water tower */}
      <rect className="city-sky" x="0" y="0" width="400" height="340" />
      <path className="moon-disc" d="M116 88 A 24 24 0 1 0 140 128 A 18 18 0 1 1 116 88 Z" />
      {BUILDINGS.map(([x, w, h]) => <rect key={x} className="building" x={x} y={340 - h} width={w} height={h} />)}
      {WINDOWS.map(([x, y]) => <rect key={`${x},${y}`} data-win="" className="city-window" x={x} y={y} width="7" height="9" rx="1" />)}
      <g className="water-tower">
        <path className="tower-leg" d="M318 316 L 326 252 M362 316 L 354 252 M322 286 H358 M324 268 L 356 300 M356 268 L 324 300" strokeWidth="3" fill="none" />
        <path className="tower-tank ol-thin" d="M318 252 V214 Q 340 206 362 214 V252 Q 340 258 318 252 Z" />
        <path className="tower-roof ol-thin" d="M314 216 L 340 192 L 366 216 Q 340 208 314 216 Z" />
        <path d="M324 224 V248 M332 222 V252 M340 222 V254 M348 222 V252 M356 224 V248" stroke="rgb(0 0 0 / 0.25)" strokeWidth="1.5" />
      </g>
      {/* the string of lights across the top */}
      <path className="light-wire" d={`M0 46 Q 200 ${f1(46 + 26 * 2)} 400 46`} fill="none" strokeWidth="1.5" />
      {BULBS.map(([x, y], i) => (
        <g key={x}>
          <path className="light-wire" d={`M${x} ${f1(y - 1)} v 5`} strokeWidth="1.5" />
          <circle data-bulb="" className={`led led-${i % 3}`} cx={x} cy={f1(y + 8)} r="4.5" filter="url(#critter-glow)" />
        </g>
      ))}
      {/* the roof: a ledge along the back, the tar floor */}
      <rect className="parapet ol-thin" x="-4" y="316" width="408" height="26" />
      <path className="parapet-cap" d="M-4 316 H404" strokeWidth="5" />
      <rect className="roof-floor" x="0" y="340" width="400" height="60" />
      <path className="roof-seam" d="M0 362 H400 M0 384 H400 M60 340 L 40 400 M190 340 L 186 400 M320 340 L 340 400" strokeWidth="1.5" fill="none" />

      <Shadow cx={200} cy={364} rx={64} />
      <Legs species={species} shoe="sneaker" />

      <Body species={species}>
        {/* a roll-neck jumper: the rolled collar and ribbing */}
        <path className="rollneck ol-thin" d="M168 242 Q 200 258 232 242 L 234 256 Q 200 274 166 256 Z" />
        <path d="M178 250 v 10 M190 254 v 10 M200 256 v 10 M210 254 v 10 M222 250 v 10" stroke="rgb(0 0 0 / 0.18)" strokeWidth="2" />
        <BodyOutfits />
      </Body>
      <Skirt species={species} style="aline" />

      <Head
        species={species}
        hat={
          <g data-part="adjust" className="own-hat">
            {/* a beret, tipped to one side */}
            <g transform="rotate(-6 200 110)">
            <path className="beret ol" d="M134 118 Q 128 78 194 74 Q 268 72 272 106 Q 272 124 248 126 Q 200 132 150 128 Q 134 126 134 118 Z" />
            <path d="M146 116 Q 200 124 262 114" stroke="rgb(0 0 0 / 0.2)" strokeWidth="3" fill="none" />
            <path className="beret ol-thin" d="M196 76 l 2 -9 l 5 1 l -2 9 Z" />
            </g>
          </g>
        }
      />

      {/* the sax, from the mouthpiece down to the bell */}
      <g data-part="sax">
        <path className="sax-edge" d="M210 240 Q 224 238 226 256" fill="none" strokeWidth="10" strokeLinecap="round" />
        <path className="sax-brass" d="M210 240 Q 224 238 226 256" fill="none" strokeWidth="7" strokeLinecap="round" />
        <path className="sax-mouthpiece" d="M204 235 L 214 237 L 214 244 L 204 243 Z" />
        <path className="sax-edge" d="M226 256 L 232 322 Q 236 346 254 342 Q 270 338 270 318 L 272 298" fill="none" strokeWidth="22" strokeLinecap="round" />
        <path className="sax-brass" d="M226 256 L 232 322 Q 236 346 254 342 Q 270 338 270 318 L 272 298" fill="none" strokeWidth="18" strokeLinecap="round" />
        <path className="sax-bell ol" d="M261 306 L 259 292 Q 256 272 270 264 Q 290 256 302 270 L 284 306 Z" />
        <ellipse className="sax-bell-mouth ol-thin" cx="286" cy="266" rx="18" ry="7" transform="rotate(24 286 266)" />
        <path className="sax-shine" d="M229 266 L 234 318" fill="none" strokeWidth="3" strokeLinecap="round" />
        {[[226, 268], [227, 280], [228, 292], [229, 304], [231, 316]].map(([x, y]) => (
          <circle key={y} className="sax-key ol-thin" cx={x + 4} cy={y} r="4" />
        ))}
        <path className="sax-guard" d="M246 336 q 12 -4 14 -18" fill="none" strokeWidth="2.5" />
      </g>

      {/* the upper hand reaches across from the left of the picture, the lower hand from the right */}
      <Arm part="arm-l" d="M138 268 Q 140 306 220 280" hand={[222, 278]} />
      <Arm part="arm-r" d="M262 268 Q 282 318 236 318" hand={[234, 316]} />

      {/* notes floating out of the bell */}
      {Array.from({ length: NOTES }, (_, i) => (
        <g key={i} data-note="" style={{ opacity: 0 }}>
          <path className="sax-note" d={i % 2 ? 'M0 0 V-16 L 12 -20 V-4' : 'M0 0 V-18 Q 8 -14 10 -8'} fill="none" strokeWidth="2.6" strokeLinecap="round" />
          <ellipse className="sax-note-head" cx="-3" cy="0" rx="4.5" ry="3.4" transform="rotate(-20 -3 0)" />
          {i % 2 ? <ellipse className="sax-note-head" cx="9" cy="-4" rx="4.5" ry="3.4" transform="rotate(-20 9 -4)" /> : null}
        </g>
      ))}
    </CritterFrame>
  );
}
