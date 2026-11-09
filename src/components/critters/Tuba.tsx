import { useRef } from 'react';
import { beatClock, bend } from './arm';
import { swell } from './flourish';
import { Arm, Body, BodyOutfits, CritterFrame, Head, Legs, Shadow, Skirt } from './parts';
import type { ActProps } from './species';
import { useCritterRig } from './rig';

/** Snowflakes: x, where in the fall each starts (0..1), speed, size. */
const SNOW = Array.from({ length: 40 }, (_, i) => [((i * 89) % 410) - 5, (i * 0.29) % 1, 0.5 + ((i * 7) % 5) / 10, 1.4 + (i % 3) * 0.8] as const);
/** Houses round the square: x, width, wall height, roof height. */
const HOUSES: [number, number, number, number][] = [[-10, 92, 110, 50], [78, 78, 140, 44], [246, 86, 120, 52], [326, 94, 96, 46]];
/** The bell's mouth: puffs come out of here. */
const BELL: [number, number] = [302, 172];
const PUFFS = 6;

const f1 = (n: number) => n.toFixed(1);

/**
 * Tuba in a snowy town square at dusk: a marching-band hat with a plume and a band jacket with gold braid,
 * oom-pahing on a big brass tuba, with snow falling on the rooftops and a snowman nodding along. The jacket
 * and the plume take the skin's colours; the brass, the town and the snow are fixed. On each beat the tuba
 * bounces, a valve goes down and a puff of breath and snow blows out of the bell; the snow falls harder with
 * the bass and the windows glow with the mids. Flourish: one big blast, the tuba lifting and a burst of
 * snowflakes out of the bell. Paused, the tuba rests and the snow drifts down. The mouthpiece is at their
 * lips, so they don't sing along.
 */
export function Tuba({ species, still }: ActProps) {
  const root = useRef<SVGSVGElement>(null);
  const state = useRef({ snow: 0, beat: -1, puffs: Array.from({ length: PUFFS }, () => -9), next: 0, valve: 0 });

  useCritterRig(
    root,
    (f) => {
      const { t, a, bob, flourish, $ } = f;
      const s = state.current;
      const svg = root.current!;
      const { index } = beatClock(f);

      // oom on the beat, pah after: the tuba bounces and a puff blows out of the bell
      if (index !== s.beat && a.playing) {
        s.puffs[s.next] = t;
        s.next = (s.next + 1) % PUFFS;
        s.valve = (s.valve + 1) % 3;
      }
      s.beat = index;
      const blast = swell(flourish);
      if (flourish && Math.floor(t * 10) !== Math.floor((t - 1 / 60) * 10)) {
        s.puffs[s.next] = t;
        s.next = (s.next + 1) % PUFFS;
      }
      const lift = (a.playing ? bob * 4 : Math.sin(t * 0.9) * 0.8) + blast * 10;
      const tip = a.playing ? -bob * 2 - blast * 8 : 0;
      $('tuba').setAttribute('transform', `translate(0 ${f1(-lift)}) rotate(${f1(tip)} 200 300)`);
      // the hands ride the tuba: one holds the coil, the other's fingers on the valves
      bend($, 'arm-l', { to: [0, -lift] });
      bend($, 'arm-r', { to: [0, -lift + (a.playing ? bob * 3 : 0)], wrist: a.playing ? bob * 8 : 0 });
      svg.querySelectorAll<SVGElement>('[data-valve]').forEach((v, i) => {
        const down = a.playing && i === s.valve ? bob * 5 : 0;
        v.setAttribute('transform', `translate(0 ${f1(down)})`);
      });

      // puffs of breath and snow from the bell, drifting up and out
      svg.querySelectorAll<SVGElement>('[data-puff]').forEach((p, i) => {
        const age = t - s.puffs[i];
        const k = Math.min(1, age / 1.6);
        p.style.opacity = age > 1.6 ? '0' : (Math.min(1, age * 8) * (1 - k) * 0.9).toFixed(2);
        p.setAttribute('transform', `translate(${f1(BELL[0] + Math.sin(i * 2.1) * 18 * k)} ${f1(BELL[1] - lift - k * 70)}) scale(${(0.5 + k * 1.3).toFixed(2)})`);
      });

      // snow falls harder with the bass; the snowman nods along; the windows glow with the mids
      s.snow += (0.5 + (a.playing ? a.bass * 1.2 : 0)) / 60;
      svg.querySelectorAll<SVGElement>('[data-flake]').forEach((d, i) => {
        const [x, start, speed] = SNOW[i];
        const p = (s.snow * speed * 0.6 + start) % 1;
        d.setAttribute('transform', `translate(${f1(x + Math.sin(t * 0.8 + i) * 8)} ${f1(-10 + p * 360)})`);
      });
      $('snowman-head').setAttribute('transform', `rotate(${f1(a.playing ? (index % 2 ? 1 : -1) * bob * 8 : Math.sin(t * 0.5) * 2)} 56 268)`);
      svg.querySelectorAll<SVGElement>('[data-win]').forEach((w, i) => {
        w.style.opacity = (0.7 + (a.playing ? a.mid * 0.3 : 0) + Math.sin(t * 1.3 + i) * 0.05).toFixed(2);
      });
    },
    { still, nod: 6, talk: false },
  );

  return (
    <CritterFrame ref={root} kind="tuba" species={species} label={`A ${species.noun} playing the tuba in a snowy town square`}>
      <defs>
        <linearGradient id="tuba-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1c2550" />
          <stop offset="1" stopColor="#5a6aa0" />
        </linearGradient>
      </defs>
      {/* a dusk sky, houses with snowy roofs and lit windows round the square */}
      <rect x="0" y="0" width="400" height="340" fill="url(#tuba-sky)" />
      {HOUSES.map(([x, w, h, r]) => {
        const top = 336 - h;
        return (
          <g key={x}>
            <rect className="house ol-thin" x={x} y={top} width={w} height={h} />
            <path className="house-roof ol-thin" d={`M${x - 8} ${top} L ${x + w / 2} ${top - r} L ${x + w + 8} ${top} Z`} />
            <path className="roof-snow" d={`M${x - 10} ${top + 1} L ${x + w / 2} ${top - r - 2} L ${x + w + 10} ${top + 1} Q ${x + w * 0.75} ${top - r * 0.45 + 8} ${x + w / 2} ${top - r + 12} Q ${x + w * 0.25} ${top - r * 0.45 + 8} ${x - 10} ${top + 1} Z`} />
            {[0.25, 0.68].map((u) => (
              <g key={u}>
                <rect data-win="" className="house-window" x={f1(x + w * u - 9)} y={top + 18} width="18" height="22" rx="2" />
                <path className="house-mullion" d={`M${f1(x + w * u)} ${top + 18} v 22 M${f1(x + w * u - 9)} ${top + 29} h 18`} strokeWidth="2" />
              </g>
            ))}
          </g>
        );
      })}
      {/* the snowy square */}
      <path className="snow-ground" d="M0 330 Q 200 318 400 330 V400 H0 Z" />
      <path className="snow-shade" d="M0 372 Q 120 360 220 370 Q 320 380 400 368 V400 H0 Z" />

      {/* a snowman, nodding along */}
      <Shadow cx={56} cy={360} rx={34} ry={5} />
      <circle className="snowman ol" cx="56" cy="326" r="30" />
      <circle className="snowman ol" cx="56" cy="282" r="21" />
      {[312, 326, 340].map((y) => <circle key={y} className="coal" cx="56" cy={y} r="2.6" />)}
      <path className="snowman-arm" d="M36 284 L 12 266 M18 270 l -6 -2 M76 284 L 100 270 M94 273 l 6 -4" strokeWidth="3" strokeLinecap="round" fill="none" />
      <g data-part="snowman-head">
        <circle className="snowman ol" cx="56" cy="248" r="16" />
        <circle className="coal" cx="50" cy="244" r="2.2" />
        <circle className="coal" cx="62" cy="244" r="2.2" />
        <path className="carrot" d="M56 249 L 72 252 L 56 253 Z" />
        <path className="snowman-scarf" d="M42 260 Q 56 268 70 260 L 70 266 Q 56 274 42 266 Z M62 264 L 66 284 L 58 284 L 58 266 Z" />
        <rect className="snowman-hat ol-thin" x="44" y="220" width="24" height="16" rx="2" />
        <rect className="snowman-hat ol-thin" x="38" y="234" width="36" height="5" rx="2" />
      </g>

      <Shadow cx={200} cy={364} rx={64} />
      <Legs species={species} shoe="boot-black" />

      <Body species={species}>
        {/* a band jacket: gold braid across the chest and a row of buttons */}
        {[262, 280, 298, 316].map((y) => (
          <path key={y} className="braid" d={`M172 ${y} Q 186 ${y + 4} 200 ${y} Q 214 ${y + 4} 228 ${y}`} fill="none" strokeWidth="3" strokeLinecap="round" />
        ))}
        {[262, 280, 298, 316].map((y) => <circle key={y} className="braid-button" cx="200" cy={y} r="3" />)}
        <path className="jacket-collar ol-thin" d="M170 244 Q 200 256 230 244 L 230 254 Q 200 266 170 254 Z" />
        <BodyOutfits />
      </Body>
      <Skirt species={species} style="pleated" />

      <Head
        species={species}
        hat={
          <g data-part="adjust" className="own-hat">
            {/* a marching-band hat: a tall crown, a peak, a badge and a plume */}
            <path className="shako ol" d="M150 128 L 156 52 Q 200 44 244 52 L 250 128 Z" />
            <path className="shako-band" d="M152 112 H248 L 249 126 H151 Z" />
            <path className="shako-peak ol" d="M146 128 Q 200 120 254 128 Q 252 140 200 138 Q 150 140 146 128 Z" />
            <path className="braid" d="M154 64 Q 200 56 246 64" fill="none" strokeWidth="3" />
            <circle className="braid-button ol-thin" cx="200" cy="88" r="10" />
            <path className="shako-plume ol-thin" d="M200 52 Q 186 26 198 8 Q 214 26 206 52 Z" />
          </g>
        }
      />

      {/* the tuba: a coil in front, valves on top, the bell up past the shoulder */}
      <g data-part="tuba">
        <path className="tuba-edge" d="M180 272 Q 186 252 204 240" fill="none" strokeWidth="8" strokeLinecap="round" />
        <path className="tuba-brass" d="M180 272 Q 186 252 204 240" fill="none" strokeWidth="5" strokeLinecap="round" />
        <circle className="tuba-mouthpiece" cx="205" cy="240" r="4" />
        <path className="tuba-edge" d="M228 304 Q 262 300 274 278 L 284 198" fill="none" strokeWidth="24" strokeLinecap="round" />
        <path className="tuba-brass" d="M228 304 Q 262 300 274 278 L 284 198" fill="none" strokeWidth="20" strokeLinecap="round" />
        <path className="tuba-bell ol" d="M276 206 L 266 182 Q 262 168 268 164 L 336 164 Q 342 168 338 182 L 296 206 Z" />
        <ellipse className="tuba-bell-mouth ol" cx="302" cy="166" rx="36" ry="9" />
        <ellipse className="tuba-bell-inside" cx="302" cy="167" rx="28" ry="5.5" />
        <circle className="tuba-edge" cx="200" cy="304" r="32" fill="none" strokeWidth="22" />
        <circle className="tuba-brass" cx="200" cy="304" r="32" fill="none" strokeWidth="18" />
        <path className="tuba-shine" d="M176 290 A 30 30 0 0 1 200 274" fill="none" strokeWidth="3" strokeLinecap="round" />
        <path className="tuba-shine" d="M278 270 L 286 206" fill="none" strokeWidth="3" strokeLinecap="round" />
        {/* three valves on top of the coil */}
        {[204, 216, 228].map((x, i) => (
          <g key={x}>
            <rect className="tuba-valve ol-thin" x={x - 4.5} y="268" width="9" height="18" rx="2" />
            <g data-valve={i}>
              <rect className="tuba-valve ol-thin" x={x - 2} y="261" width="4" height="8" />
              <ellipse className="tuba-key ol-thin" cx={x} cy="260" rx="5.5" ry="2.6" />
            </g>
          </g>
        ))}
      </g>

      {/* one hand round the coil, the other on the valves */}
      <Arm part="arm-l" d="M138 268 Q 124 300 158 310" hand={[160, 310]} />
      <Arm part="arm-r" d="M262 268 Q 258 250 218 258" hand={[216, 258]} />

      {/* puffs of breath and snow out of the bell */}
      {Array.from({ length: PUFFS }, (_, i) => (
        <g key={i} data-puff="" style={{ opacity: 0 }}>
          <circle className="puff" cx="-8" cy="0" r="7" />
          <circle className="puff" cx="6" cy="-4" r="9" />
          <circle className="puff" cx="2" cy="6" r="6" />
          <path className="puff-flake" d="M-14 -12 v 6 M-17 -9 h 6 M16 8 v 6 M13 11 h 6" strokeWidth="1.6" strokeLinecap="round" />
        </g>
      ))}
      {/* snow over everything */}
      {SNOW.map(([, , , r], i) => <circle key={i} data-flake="" className="flake" cx="0" cy="0" r={r} />)}
    </CritterFrame>
  );
}
