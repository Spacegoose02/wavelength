import { useRef } from 'react';
import { beatClock } from './arm';
import { swell, windUp } from './flourish';
import { playGuitar, newGuitarHands } from './guitar';
import { Arm, ArmHand, Body, BodyOutfits, CritterFrame, Head, Legs, Shadow, Skirt } from './parts';
import type { ActProps } from './species';
import { useCritterRig } from './rig';

/** Baubles and lights on the tree: x, y, which of three colours. */
const LIGHTS: [number, number, number][] = [
  [62, 112, 0], [44, 140, 1], [78, 146, 2], [36, 180, 2], [62, 176, 0], [92, 186, 1],
  [26, 222, 1], [52, 216, 2], [80, 228, 0], [104, 220, 2], [20, 262, 0], [46, 258, 1], [74, 268, 2], [104, 262, 0], [120, 272, 1],
];
/** The string of lights along the top: how many bulbs. */
const BULBS = 12;
/** Snowflakes: x, size, start (0..1), speed. */
const FLAKES: [number, number, number, number][] = Array.from({ length: 16 }, (_, i) => [
  (i * 53 + 17) % 400,
  1.6 + ((i * 7) % 5) * 0.5,
  (i * 0.37) % 1,
  0.7 + ((i * 3) % 5) * 0.12,
]);

const f1 = (n: number) => n.toFixed(1);

/**
 * Christmas: the critter plays a candy-cane striped guitar in the snow beside a decorated tree, in a Christmas
 * jumper and a Santa hat. The tree's lights twinkle in a new pattern on each beat and its star glows with the
 * bass, a string of lights along the top chases the beat, snow falls (thicker as the music gets louder), and
 * a snowman on the right bobs his top hat to the beat. Presents sit under the tree. The jumper, the hat's trim
 * and some of the lights take the skin's colours. Strums like the Rocker. Flourish: a windmill strum while every
 * light comes on and the star bursts. Paused, the lights glow softly and the snow keeps falling.
 */
export function Christmas({ species, still }: ActProps) {
  const root = useRef<SVGSVGElement>(null);
  const hands = useRef(newGuitarHands());
  const state = useRef({ fall: 0 });

  useCritterRig(
    root,
    (f) => {
      const { t, a, idle, bob, flourish, $ } = f;
      const s = state.current;
      const svg = root.current!;
      playGuitar(f, hands.current, 24, 1.1, 2);
      const big = swell(flourish);
      if (flourish) {
        $('arm-l').setAttribute('transform', `rotate(${f1(-360 * windUp(flourish))} 138 268)`);
        $('guitar').setAttribute('transform', `rotate(${f1(-10 * big)} 200 320)`);
      }
      const { index } = beatClock(f);

      // tree lights: a new twinkle pattern each beat, all on for the flourish, a soft glow when paused
      svg.querySelectorAll<SVGElement>('[data-light]').forEach((el, i) => {
        const on = idle ? 0.55 : big > 0.3 ? 1 : (i * 5 + index * 3) % 4 < 2 ? 1 : 0.3;
        el.style.opacity = on.toFixed(2);
      });
      // the string along the top chases the beat
      svg.querySelectorAll<SVGElement>('[data-bulb]').forEach((el, i) => {
        el.style.opacity = idle ? '0.6' : big > 0.3 || (i + index) % 3 === 0 ? '1' : '0.35';
      });
      const star = idle ? 0.5 : Math.min(1, 0.5 + (a.playing ? a.bass * 0.4 + bob * 0.3 : 0) + big);
      $('star-glow').style.opacity = star.toFixed(2);
      $('star').setAttribute('transform', `rotate(${f1(Math.sin(t * 0.8) * 4)} 62 84) scale(${(1 + big * 0.25).toFixed(2)})`);

      // the snowman's hat bobs with the beat
      $('snowman-hat').setAttribute('transform', `translate(0 ${f1(a.playing ? -bob * 5 : 0)}) rotate(${f1(a.playing ? Math.sin(Math.PI * index) * 6 : 0)} 352 214)`);

      // snow falls, a little faster with the music
      s.fall += (0.05 + (a.playing ? a.mid * 0.08 : 0)) / 60;
      svg.querySelectorAll<SVGElement>('[data-flake]').forEach((el, i) => {
        const [x, , start, speed] = FLAKES[i];
        const p = (s.fall * speed * 4 + start) % 1;
        el.setAttribute('cx', f1(x + Math.sin(t * 0.9 + i) * 10));
        el.setAttribute('cy', f1(-10 + p * 380));
      });
    },
    { still, nod: 14 },
  );

  return (
    <CritterFrame ref={root} kind="christmas" species={species} label={`A ${species.noun} playing guitar in the snow by a Christmas tree`}>
      {/* a string of lights across the top */}
      <path className="light-wire" d={`M0 18 ${Array.from({ length: BULBS }, (_, i) => `Q ${f1((i + 0.5) * (400 / BULBS))} 38 ${f1((i + 1) * (400 / BULBS))} 18`).join(' ')}`} fill="none" strokeWidth="2" />
      {Array.from({ length: BULBS }, (_, i) => {
        const x = (i + 0.5) * (400 / BULBS);
        return <ellipse key={i} data-bulb="" className={`xmas-bulb xmas-${i % 3} ol-thin`} cx={f1(x)} cy="32" rx="4" ry="6" />;
      })}

      {/* the snowy ground */}
      <path className="snow-ground" d="M0 330 Q 100 314 200 326 Q 300 336 400 320 V400 H0 Z" />
      <path d="M0 360 Q 120 352 220 364 Q 320 374 400 358" className="snow-shade" fill="none" strokeWidth="3" />

      {/* the tree on the left with its star, lights and presents */}
      <rect className="tree-trunk" x="54" y="300" width="16" height="30" />
      <path className="tree ol" d="M62 92 L 100 150 L 84 150 L 118 206 L 98 206 L 134 276 Q 62 300 -8 276 L 26 206 L 6 206 L 40 150 L 24 150 Z" />
      <path d="M62 92 L 100 150 L 84 150 L 118 206 L 98 206 L 134 276 Q 62 300 -8 276 L 26 206 L 6 206 L 40 150 L 24 150 Z" fill="url(#critter-vinyl)" />
      <path className="tinsel" d="M38 156 Q 70 168 92 152 M22 214 Q 66 230 112 210 M8 272 Q 66 290 124 268" fill="none" strokeWidth="3" />
      {LIGHTS.map(([x, y, c], i) => <circle key={i} data-light="" className={`xmas-light xmas-${c}`} cx={x} cy={y} r="4.6" />)}
      <circle data-part="star-glow" className="star-glow" cx="62" cy="84" r="24" filter="url(#critter-blur)" />
      <g data-part="star">
        <path className="xmas-star ol-thin" d="M62 66 L 67 78 L 80 79 L 70 87 L 74 100 L 62 92 L 50 100 L 54 87 L 44 79 L 57 78 Z" />
      </g>
      {[[20, 314, 30, 'present-a'], [56, 322, 26, 'present-b'], [96, 316, 24, 'present-c']].map(([x, y, w, cls]) => (
        <g key={x as number}>
          <rect className={`${cls} ol-thin`} x={x as number} y={y as number} width={w as number} height={(w as number) * 0.8} rx="2" />
          <path d={`M${(x as number) + (w as number) / 2} ${y} v ${(w as number) * 0.8} M${x} ${(y as number) + (w as number) * 0.4} h ${w}`} className="ribbon" strokeWidth="4" />
          <path d={`M${(x as number) + (w as number) / 2} ${y} q -8 -10 -12 -2 q 4 6 12 2 q 8 -10 12 -2 q -4 6 -12 2`} className="ribbon" strokeWidth="2.4" fill="none" />
        </g>
      ))}

      {/* the snowman on the right */}
      <Shadow cx={352} cy={344} rx={40} ry={5} />
      <circle className="snowball ol" cx="352" cy="306" r="36" />
      <circle className="snowball ol" cx="352" cy="248" r="26" />
      <circle cx="352" cy="294" r="3" fill="#1b1b1f" /><circle cx="352" cy="310" r="3" fill="#1b1b1f" />
      <path className="snow-scarf ol-thin" d="M328 266 Q 352 276 376 266 L 378 274 Q 352 284 326 274 Z M360 274 L 368 300 L 376 298 L 370 272 Z" />
      <circle cx="344" cy="242" r="2.8" fill="#1b1b1f" /><circle cx="360" cy="242" r="2.8" fill="#1b1b1f" />
      <path d="M352 250 L 370 254 L 352 256 Z" fill="#f08a24" />
      <path d="M342 260 Q 352 266 362 260" fill="none" stroke="#1b1b1f" strokeWidth="2" strokeDasharray="1 4" strokeLinecap="round" />
      <path d="M326 300 L 300 282 M378 300 L 398 280" stroke="#5a3a24" strokeWidth="3" strokeLinecap="round" />
      <g data-part="snowman-hat">
        <rect x="334" y="218" width="36" height="5" rx="2" fill="#1b1b1f" />
        <rect x="340" y="194" width="24" height="26" rx="2" fill="#1b1b1f" />
        <rect x="340" y="212" width="24" height="5" className="snowman-band" />
      </g>

      <Shadow cx={200} cy={366} rx={66} />
      <Legs species={species} shoe="boot-black" />

      <Body species={species}>
        {/* a Christmas jumper: a white zigzag band and little snowflakes */}
        <path className="jumper-band" d="M148 292 L 158 284 L 168 292 L 178 284 L 188 292 L 198 284 L 208 292 L 218 284 L 228 292 L 238 284 L 248 292" fill="none" strokeWidth="4" strokeLinejoin="round" />
        {[[164, 312], [200, 306], [236, 312]].map(([x, y]) => (
          <path key={x} d={`M${x - 6} ${y} H${x + 6} M${x} ${y - 6} V${y + 6} M${x - 4} ${y - 4} L ${x + 4} ${y + 4} M${x + 4} ${y - 4} L ${x - 4} ${y + 4}`} className="jumper-flake" strokeWidth="2" strokeLinecap="round" />
        ))}
        <path className="jumper-cuff" d="M150 326 Q 200 336 250 326" fill="none" strokeWidth="6" />
        <BodyOutfits />
      </Body>
      <Skirt species={species} style="ruffle" className="xmas-skirt" />

      <Head
        species={species}
        hat={
          <g className="own-hat">
            {/* a Santa hat flopping over to the right, with a white trim and bobble */}
            <path className="santa-hat ol" d="M130 126 Q 140 66 206 60 Q 262 58 292 104 Q 300 118 294 132 Q 284 106 262 92 Q 270 112 270 128 Z" />
            <path d="M130 126 Q 140 66 206 60 Q 262 58 292 104 Q 300 118 294 132 Q 284 106 262 92 Q 270 112 270 128 Z" fill="url(#critter-vinyl)" />
            <path className="santa-trim ol" d="M118 122 Q 200 106 282 122 Q 288 134 280 142 Q 200 126 120 142 Q 112 132 118 122 Z" />
            <circle className="santa-trim ol" cx="296" cy="136" r="12" />
          </g>
        }
      />

      {Array.from({ length: FLAKES.length }, (_, i) => <circle key={i} data-flake="" className="flake" cx={FLAKES[i][0]} cy={f1(FLAKES[i][2] * 380)} r={FLAKES[i][1]} />)}

      <Arm part="arm-r" d="M262 268 Q 258 312 296 266" hand={[296, 266]} handLater />

      {/* a candy-cane striped guitar, neck up to the right */}
      <g data-part="guitar">
        <g transform="translate(178 318) rotate(-24)">
          <defs>
            <pattern id="candy-stripes" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(40)">
              <rect width="12" height="12" fill="#fbf7f2" />
              <rect width="6" height="12" fill="#d62a32" />
            </pattern>
          </defs>
          <rect className="fretboard" x="36" y="-6" width="136" height="12" rx="1" />
          {[64, 88, 110, 130, 148, 164].map((x) => <path key={x} d={`M${x} -6 V6`} stroke="#9a9aa4" strokeWidth="1" />)}
          <path className="fretboard" d="M170 -8 L 204 -12 L 204 12 L 170 8 Z" />
          <path className="ol-thin" fill="url(#candy-stripes)" d="M44 -10 Q 30 -26 6 -22 Q -14 -36 -40 -28 Q -66 -18 -64 4 Q -62 30 -36 34 Q -12 38 6 24 Q 30 26 44 10 Z" />
          <path d="M44 -10 Q 30 -26 6 -22 Q -14 -36 -40 -28 Q -66 -18 -64 4 Q -62 30 -36 34 Q -12 38 6 24 Q 30 26 44 10 Z" fill="url(#critter-vinyl)" />
          <circle cx="-6" cy="0" r="10" fill="#1b1b1f" />
          <path className="guitar-holly" d="M-40 -14 q 6 -8 12 -2 q -6 2 -6 8 q -6 -2 -6 -6 Z" />
          <circle cx="-30" cy="-6" r="3" fill="#d62a32" />
          <g data-part="strings">
            {[-4, -1.3, 1.3, 4].map((y) => <path key={y} d={`M-30 ${y} H200`} stroke="#eef" strokeWidth="0.9" />)}
          </g>
        </g>
      </g>

      <Arm part="arm-l" d="M138 268 Q 146 302 178 314" hand={[180, 314]} />
      <ArmHand part="arm-r" d="M262 268 Q 258 312 296 266" hand={[296, 266]} />
    </CritterFrame>
  );
}
