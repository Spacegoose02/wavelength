import { useRef } from 'react';
import { beatClock, bend } from './arm';
import { swell, windUp } from './flourish';
import { Arm, Body, BodyOutfits, CritterFrame, Head, Legs, Shadow, Skirt } from './parts';
import type { ActProps } from './species';
import { useCritterRig } from './rig';

/** Where the neck meets the soundbox (top left of the harp), and the foot of the soundbox. */
const JOINT: [number, number] = [258, 208];
const FOOT: [number, number] = [326, 350];
/** The pillar's x, from the base up to the crown. */
const PILLAR = 366;
/** The neck, from the joint over to the pillar: a gentle S. */
const neckY = (x: number) => JOINT[1] - (x - JOINT[0]) * 0.36 - Math.sin(((x - JOINT[0]) / (PILLAR - JOINT[0])) * Math.PI * 2) * 9;
/** Where a string at `x` meets the soundbox (or the base, past its foot). */
const boxY = (x: number) => Math.min(348, JOINT[1] + ((x - JOINT[0]) * (FOOT[1] - JOINT[1])) / (FOOT[0] - JOINT[0]));
/** The strings' x, low (long, by the pillar) to high (short, by the joint) reading right to left. */
const STRINGS = Array.from({ length: 14 }, (_, i) => 267 + i * 7);
/** Which strings each hand plays: the near hand the short ones, the far hand the long ones. */
const NEAR = [0, 1, 2, 3, 4];
const FAR = [5, 6, 7, 8, 9, 10, 11];
/** Where each hand rests, as drawn: the near hand (left of the picture, across the body) and the far hand. */
const HAND_NEAR: [number, number] = [280, 244];
const HAND_FAR: [number, number] = [308, 274];
/** Small clouds drifting across: y, size, speed, where they start (0..1). */
const CLOUDS: [number, number, number, number][] = [[70, 1, 0.012, 0.1], [118, 0.7, 0.02, 0.55], [40, 0.55, 0.016, 0.8]];
const BIRDS: [number, number][] = [[70, 150], [96, 136], [120, 156]];

const f1 = (n: number) => n.toFixed(1);

/** A puffy cloud, `s` big, its middle at `x`,`y`. */
const puff = (x: number, y: number, s: number) =>
  `M${f1(x - 44 * s)} ${f1(y)} a ${f1(16 * s)} ${f1(16 * s)} 0 0 1 ${f1(18 * s)} ${f1(-18 * s)} a ${f1(22 * s)} ${f1(22 * s)} 0 0 1 ${f1(40 * s)} ${f1(-6 * s)} a ${f1(18 * s)} ${f1(18 * s)} 0 0 1 ${f1(30 * s)} ${f1(14 * s)} a ${f1(12 * s)} ${f1(12 * s)} 0 0 1 ${f1(0)} ${f1(10 * s)} Z`;

/**
 * Harp in the clouds at sunrise: a laurel wreath and a toga with a drape over one shoulder, standing on a
 * cloud at a golden harp, with a rainbow behind, little clouds drifting by and birds flapping past. The drape
 * and the plucked strings take the skin's colours; the sky, the clouds and the harp are fixed. The hands take
 * turns on the beat, each going to the string the melody is on in its range (the near hand the short, high
 * strings, the far hand the long, low ones) and plucking it: the string lights up and shimmers. Flourish: a
 * glissando, the far hand sweeping across every string in turn as they light up. Paused, the hands rest on the
 * strings.
 */
export function Harp({ species, still }: ActProps) {
  const root = useRef<SVGSVGElement>(null);
  const state = useRef({
    beat: -1,
    near: 2,
    far: 8,
    hit: Array.from({ length: STRINGS.length }, () => -9),
    pull: [0, 0],
    reach: [[0, 0], [0, 0]] as [number, number][],
    drift: 0,
  });

  useCritterRig(
    root,
    (f) => {
      const { t, a, idle, flourish, $ } = f;
      const s = state.current;
      const svg = root.current!;
      const { index } = beatClock(f);

      // on each beat one hand plucks: the string its range's melody is on (the highs pick it), taking turns
      if (index !== s.beat && a.playing && !flourish) {
        const near = index % 2 === 0;
        const pick = (range: number[]) => range[Math.min(range.length - 1, Math.floor((a.live ? a.treble * 1.6 + Math.sin(index * 1.7) * 0.25 : (Math.sin(index * 2.3) + 1) / 2) * range.length))];
        if (near) s.near = pick(NEAR);
        else s.far = pick(FAR);
        s.hit[near ? s.near : s.far] = t;
        s.pull[near ? 0 : 1] = 1;
      }
      s.beat = index;
      // flourish: a glissando, the far hand sweeping across from the short strings to the long ones
      const gl = flourish ? windUp(flourish) : 0;
      if (flourish) {
        const at = Math.max(0, Math.min(STRINGS.length - 1, Math.round(gl * (STRINGS.length - 1))));
        if (t - s.hit[at] > 0.3) s.hit[at] = t;
        s.far = at;
      }

      // each hand goes to its string and pulls it towards the body as it plucks
      const go = (i: number, which: 0 | 1, rest: [number, number]) => {
        const x = STRINGS[i];
        const want: [number, number] = [x - rest[0], 0];
        s.reach[which][0] += (want[0] - s.reach[which][0]) * 0.25;
        s.reach[which][1] += (want[1] - s.reach[which][1]) * 0.25;
        s.pull[which] *= 0.85;
        return [s.reach[which][0] - s.pull[which] * 7, s.reach[which][1] - s.pull[which] * 2] as [number, number];
      };
      const lift = flourish ? swell(flourish) : 0;
      bend($, 'arm-l', { to: idle ? [0, 0] : go(s.near, 0, HAND_NEAR), wrist: -s.pull[0] * 14 - lift * 20 });
      $('arm-l').setAttribute('transform', `rotate(${f1(-lift * 18)} 138 268)`);
      bend($, 'arm-r', { to: idle ? [0, 0] : go(s.far, 1, HAND_FAR), wrist: -s.pull[1] * 14 });

      // the plucked strings light up and shimmer, fading out
      svg.querySelectorAll<SVGElement>('[data-string]').forEach((el, i) => {
        const age = t - s.hit[i];
        const k = age < 1.4 ? Math.max(0, 1 - age / 1.4) : 0;
        const x = STRINGS[i];
        const top = neckY(x) + 3;
        const bot = boxY(x) - 2;
        const wob = k * 3 * Math.sin(age * 70 + i);
        el.setAttribute('d', `M${f1(x)} ${f1(top)} Q ${f1(x + wob)} ${f1((top + bot) / 2)} ${f1(x)} ${f1(bot)}`);
        el.style.opacity = (0.15 + k * 0.85).toFixed(2);
      });

      // little clouds drift by, the birds flap past, the rainbow glows with the music
      s.drift += 1 / 60;
      svg.querySelectorAll<SVGElement>('[data-cloud]').forEach((c, i) => {
        const [, , speed, start] = CLOUDS[i];
        const p = (s.drift * speed + start) % 1;
        c.setAttribute('transform', `translate(${f1(-80 + p * 560)} 0)`);
      });
      $('birds').setAttribute('transform', `translate(${f1(((s.drift * 14) % 520) - 120)} ${f1(Math.sin(t * 0.8) * 6)})`);
      svg.querySelectorAll<SVGElement>('[data-wing]').forEach((w, i) => {
        w.setAttribute('transform', `scale(1 ${(0.5 + Math.abs(Math.sin(t * 7 + i)) * 0.7).toFixed(2)})`);
      });
      $('rainbow').style.opacity = (0.45 + (a.playing ? a.mid * 0.4 : 0)).toFixed(2);
    },
    { still, nod: 6 },
  );

  // the neck as a smooth line along `neckY`
  const neck = Array.from({ length: 25 }, (_, i) => {
    const x = JOINT[0] + ((PILLAR - JOINT[0]) * i) / 24;
    return `${i ? 'L' : 'M'}${f1(x)} ${f1(neckY(x))}`;
  }).join(' ');

  return (
    <CritterFrame ref={root} kind="harp" species={species} label={`A ${species.noun} playing the harp in the clouds at sunrise`}>
      <defs>
        <linearGradient id="harp-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8ec5ff" />
          <stop offset="0.55" stopColor="#ffcfe4" />
          <stop offset="1" stopColor="#ffe6b0" />
        </linearGradient>
      </defs>
      {/* a sunrise sky, the sun coming up, a rainbow, drifting clouds and birds */}
      <rect x="0" y="0" width="400" height="400" fill="url(#harp-sky)" />
      <circle className="harp-sun" cx="96" cy="300" r="56" />
      <g data-part="rainbow">
        {['#ff6b6b', '#ffa94d', '#ffe066', '#69db7c', '#4dabf7', '#9775fa'].map((c, i) => (
          <path key={c} d={`M${-10 + i * 9} 330 A ${210 - i * 9} ${190 - i * 9} 0 0 1 ${410 - i * 9} 330`} fill="none" stroke={c} strokeWidth="9" />
        ))}
      </g>
      {CLOUDS.map(([y, size], i) => (
        <g key={i} data-cloud="">
          <path className="harp-cloud" d={puff(0, y, size)} />
        </g>
      ))}
      <g data-part="birds">
        {BIRDS.map(([x, y], i) => (
          <g key={x} transform={`translate(${x} ${y})`}>
            <g data-wing={i}>
              <path className="harp-bird" d="M-8 0 Q -4 -5 0 0 Q 4 -5 8 0" fill="none" strokeWidth="2" strokeLinecap="round" />
            </g>
          </g>
        ))}
      </g>
      {/* the cloud they stand on */}
      <path className="harp-cloud ol-thin" d="M-10 400 V352 Q 10 326 44 336 Q 60 312 96 324 Q 120 304 152 320 Q 178 302 208 318 Q 240 300 268 320 Q 300 304 326 324 Q 360 310 380 332 Q 404 330 410 352 V400 Z" />
      <path className="harp-cloud-shade" d="M-10 400 V372 Q 100 356 200 366 Q 300 356 410 372 V400 Z" />

      <Shadow cx={200} cy={364} rx={64} />
      <Legs species={species} legs="bare" shoe="sandal" />

      <Body species={species}>
        {/* a toga: a drape over one shoulder, held with a gold brooch */}
        <path className="toga-drape ol-thin" d="M150 250 Q 168 240 186 244 L 262 340 L 226 340 Z" />
        <path d="M168 252 L 236 338 M182 250 L 250 338" stroke="rgb(0 0 0 / 0.15)" strokeWidth="2" fill="none" />
        <circle className="brooch ol-thin" cx="170" cy="252" r="6" />
        <BodyOutfits />
      </Body>
      <Skirt species={species} style="ruffle" />

      <Head
        species={species}
        hat={
          <g data-part="adjust" className="own-hat">
            {/* a laurel wreath round the brow, tied at the back */}
            <path className="laurel-band" d="M140 128 Q 200 108 260 128" fill="none" strokeWidth="4" />
            {Array.from({ length: 9 }, (_, i) => {
              const u = i / 8;
              const x = 142 + u * 116;
              const y = 128 - Math.sin(u * Math.PI) * 14;
              const r = (u - 0.5) * 40;
              return (
                <g key={i} transform={`translate(${f1(x)} ${f1(y)}) rotate(${f1(r)})`}>
                  <path className="laurel-leaf ol-thin" d="M0 0 Q -8 -8 -2 -16 Q 6 -8 0 0 Z" />
                  <path className="laurel-leaf ol-thin" d="M0 0 Q 8 -4 12 -12 Q 2 -10 0 0 Z" />
                </g>
              );
            })}
          </g>
        }
      />

      {/* the harp: the soundbox leaning on the shoulder, the neck over to the pillar, the strings between */}
      <g data-part="harp">
        <path className="harp-base ol" d="M314 346 H376 V358 H314 Z" />
        <path className="harp-wood-edge" d={`M${JOINT[0]} ${JOINT[1]} L ${FOOT[0]} ${FOOT[1]}`} strokeWidth="22" strokeLinecap="round" />
        <path className="harp-wood" d={`M${JOINT[0]} ${JOINT[1]} L ${FOOT[0]} ${FOOT[1]}`} strokeWidth="18" strokeLinecap="round" />
        <path className="harp-gold-edge" d={`M${PILLAR} 350 V${f1(neckY(PILLAR) - 6)}`} strokeWidth="13" strokeLinecap="round" />
        <path className="harp-gold" d={`M${PILLAR} 350 V${f1(neckY(PILLAR) - 6)}`} strokeWidth="9" strokeLinecap="round" />
        <path className="harp-gold-edge" d={neck} fill="none" strokeWidth="14" strokeLinecap="round" />
        <path className="harp-gold" d={neck} fill="none" strokeWidth="10" strokeLinecap="round" />
        <circle className="harp-gold ol" cx={PILLAR} cy={f1(neckY(PILLAR) - 12)} r="9" />
        <path d={neck} fill="none" stroke="rgb(255 255 255 / 0.5)" strokeWidth="2" transform="translate(-1 -2)" />
        {STRINGS.map((x, i) => (
          <g key={x}>
            <path className={i % 7 === 3 ? 'harp-string red' : 'harp-string'} d={`M${f1(x)} ${f1(neckY(x) + 3)} V${f1(boxY(x) - 2)}`} strokeWidth="1.3" />
            <path data-string={i} className="harp-string-lit" d={`M${f1(x)} ${f1(neckY(x) + 3)} V${f1(boxY(x) - 2)}`} strokeWidth="2.6" fill="none" style={{ opacity: 0.15 }} />
          </g>
        ))}
        {STRINGS.map((x) => <circle key={x} className="harp-peg" cx={f1(x)} cy={f1(neckY(x) + 1)} r="1.6" />)}
      </g>

      {/* the near hand reaches across for the short strings, the far hand plays the long ones */}
      <Arm part="arm-l" d="M138 268 Q 196 300 278 246" hand={HAND_NEAR} />
      <Arm part="arm-r" d="M262 268 Q 292 300 308 274" hand={HAND_FAR} />
    </CritterFrame>
  );
}
