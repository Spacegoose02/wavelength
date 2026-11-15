import { useRef } from 'react';
import { beatClock, bend } from './arm';
import { swell } from './flourish';
import { Arm, Body, BodyOutfits, CritterFrame, Head, Legs, Shadow, Skirt, trefoil } from './parts';
import type { ActProps } from './species';
import { useCritterRig } from './rig';

/** The cracked reactor vessel behind the critter: centre and radius. */
const CORE: [number, number] = [200, 150];
const CORE_R = 112;
/** Rings of radiation pulsing out of the core: how many can be out at once. */
const RINGS = 4;
/** Cracks in the vessel, glowing from inside. */
const CRACKS = [
  'M108 86 L 126 104 L 120 122 L 140 138',
  'M292 82 L 276 104 L 286 120 L 266 140',
  'M96 186 L 120 188 L 128 206',
  'M306 180 L 284 194 L 290 214',
  'M200 38 L 194 58 L 206 70',
];
/** Goo drips running down the vessel: x, where it starts, how far it runs. */
const DRIPS: [number, number, number][] = [[118, 210, 70], [150, 236, 60], [262, 230, 70], [290, 200, 90], [228, 250, 40]];
/** Bubbles rising in the goo puddles: x, size, start, speed. */
const BUBBLES: [number, number, number, number][] = [[46, 3, 0, 1], [70, 2.4, 0.5, 1.4], [336, 3, 0.3, 1.1], [360, 2.2, 0.8, 1.3], [312, 2, 0.1, 0.9]];

const f1 = (n: number) => n.toFixed(1);

/**
 * Meltdown: the reactor's core has cracked and the critter sings through it into a hand mic, in hi-vis
 * coveralls with goggles pushed up on the forehead. Radiation pulses out of the core in glowing green rings on
 * every beat, the whole room flushes green with the bass, the cracks glow brighter on loud notes, red alarm
 * lights spin and flash, green goo drips down the vessel into bubbling puddles that glow with the bass, and the
 * temperature gauge creeps into the red. The free hand pumps a fist on the beat. The coveralls' stripes and the
 * mic take the skin's colours; the radiation stays radioactive green. Flourish: the core blows a big flash and a
 * burst of rings with the fist held high. Paused, the rings stop and the glow sinks low.
 */
export function Meltdown({ species, still }: ActProps) {
  const root = useRef<SVGSVGElement>(null);
  const state = useRef({ beat: 0, next: 0, rings: Array.from({ length: RINGS }, () => -9), spin: 0, pump: 0, drip: 0, gauge: 0.6, burst: false });

  useCritterRig(
    root,
    (f) => {
      const { t, a, idle, bob, flourish, $ } = f;
      const s = state.current;
      const svg = root.current!;
      const { phase, index } = beatClock(f);
      const big = swell(flourish);
      const onBeat = index !== s.beat;
      s.beat = index;

      // a ring of radiation pulses out on every beat (and a burst of them on a flourish)
      if (a.playing && !idle && onBeat) {
        s.rings[s.next] = t;
        s.next = (s.next + 1) % RINGS;
      }
      if (flourish && !s.burst) {
        s.rings = s.rings.map((_, i) => t - i * 0.12);
        s.burst = true;
      }
      if (!flourish) s.burst = false;
      svg.querySelectorAll<SVGElement>('[data-ring]').forEach((el, i) => {
        const age = t - s.rings[i];
        const p = age / 1.2;
        if (p < 0 || p > 1) {
          el.style.opacity = '0';
          return;
        }
        el.setAttribute('r', f1(CORE_R * 0.6 + p * 210));
        el.style.opacity = ((1 - p) * 0.85).toFixed(2);
        el.setAttribute('stroke-width', f1(14 - p * 10));
      });

      // the core and its cracks glow with the beat and the bass; the room flushes green
      const glow = idle ? 0.3 + Math.sin(t * 1.2) * 0.05 : Math.min(1, 0.4 + (a.playing ? bob * 0.4 + a.bass * 0.4 : 0) + big * 0.5);
      $('core').style.opacity = glow.toFixed(2);
      $('halo').style.opacity = Math.min(0.95, glow * 0.8).toFixed(2);
      $('wash').style.opacity = (idle ? 0.04 : (a.playing ? bob * 0.12 + a.bass * 0.1 : 0) + big * 0.35).toFixed(2);
      $('cracks').style.opacity = Math.min(1, 0.5 + glow * 0.5 + (a.playing ? a.treble * 0.4 : 0)).toFixed(2);
      $('core-flash').style.opacity = (big * 0.9).toFixed(2);

      // red alarms: a turn every beat, flashing; stopped when paused
      if (a.playing) s.spin += (f.tempo.locked ? f.tempo.bpm / 60 : 1.6) / 60;
      const turn = Math.cos(s.spin * Math.PI * 2);
      ['alarm-beam-l', 'alarm-beam-r'].forEach((name, i) => {
        const k = i ? -turn : turn;
        $(name).setAttribute('transform', `scale(${f1(k)} 1)`);
        $(name).style.opacity = a.playing ? (0.25 + Math.abs(k) * 0.55).toFixed(2) : '0';
      });
      svg.querySelectorAll<SVGElement>('[data-alarm]').forEach((el) => {
        el.style.opacity = a.playing ? (0.5 + Math.abs(turn) * 0.5).toFixed(2) : '0.4';
      });

      // the gauge creeps into the red with the music's energy, wobbling
      const want = idle ? 0.6 : Math.min(1, 0.7 + (a.playing ? a.bass * 0.25 + a.mid * 0.15 : 0) + big * 0.3);
      s.gauge += (want - s.gauge) * 0.08;
      $('gauge-needle').setAttribute('transform', `rotate(${f1(-70 + s.gauge * 140 + (a.playing ? Math.sin(t * 23) * 3 : 0))} 362 252)`);

      // goo drips run down the vessel; puddles glow and bubble with the bass
      s.drip += (idle ? 0.05 : 0.18 + (a.playing ? a.bass * 0.25 : 0)) / 60;
      svg.querySelectorAll<SVGElement>('[data-drip]').forEach((el, i) => {
        const [x, y0, run] = DRIPS[i];
        const p = (s.drip * (1 + i * 0.2) + i * 0.27) % 1;
        el.setAttribute('d', `M${x - 3} ${y0} Q ${x} ${f1(y0 - 4)} ${x + 3} ${y0} V ${f1(y0 + p * run)} Q ${x} ${f1(y0 + p * run + 7)} ${x - 3} ${f1(y0 + p * run)} Z`);
      });
      svg.querySelectorAll<SVGElement>('[data-puddle]').forEach((el) => {
        el.style.opacity = (idle ? 0.6 : 0.65 + (a.playing ? a.bass * 0.35 : 0)).toFixed(2);
      });
      svg.querySelectorAll<SVGElement>('[data-bubble]').forEach((el, i) => {
        const [x, , start, speed] = BUBBLES[i];
        const p = (t * 0.5 * speed + start) % 1;
        el.setAttribute('cy', f1(372 - p * 16));
        el.setAttribute('cx', f1(x + Math.sin(t * 3 + i) * 2));
        el.style.opacity = a.playing ? (1 - p).toFixed(2) : '0';
      });

      // the free hand pumps a fist on the beat, thrown high on a flourish; the mic hand sways
      const pump = idle ? 0 : Math.max(0, Math.cos(Math.PI * 2 * phase)) ** 2;
      s.pump += (pump - s.pump) * 0.4;
      $('arm-r').setAttribute('transform', `rotate(${f1(-20 - s.pump * 26 - big * 60)} 262 268)`);
      bend($, 'arm-r', { turn: -s.pump * 30 - big * 20, wrist: -s.pump * 10 });
      const sway = idle ? Math.sin(t * 0.8) * 1.5 : Math.sin(Math.PI * (index + phase)) * 4;
      $('arm-l').setAttribute('transform', `rotate(${f1(sway * 0.4)} 138 268)`);
      bend($, 'arm-l', { turn: sway, wrist: -sway * 0.8 });
    },
    { still, nod: 14 },
  );

  return (
    <CritterFrame ref={root} kind="meltdown" species={species} label={`A ${species.noun} singing in front of a melting-down nuclear reactor`}>
      <defs>
        <radialGradient id="meltdown-core-grad">
          <stop offset="0" stopColor="#f6ffe6" />
          <stop offset="0.4" stopColor="#9dff5a" />
          <stop offset="1" stopColor="#1f8a2e" />
        </radialGradient>
        <pattern id="meltdown-hazard" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="16" height="16" fill="#f4c20d" />
          <rect width="8" height="16" fill="#1b1b1f" />
        </pattern>
      </defs>

      {/* the green wash over the whole room, flushing with the beat */}
      <rect data-part="wash" className="meltdown-wash" x="0" y="0" width="400" height="400" style={{ opacity: 0 }} />

      {/* the vessel: a halo, the cracked steel shell, the core showing through a window, cracks glowing */}
      <circle data-part="halo" className="meltdown-halo" cx={CORE[0]} cy={CORE[1]} r="150" filter="url(#critter-blur)" />
      {Array.from({ length: RINGS }, (_, i) => (
        <circle key={i} data-ring="" className="radiation-ring" cx={CORE[0]} cy={CORE[1]} r={CORE_R} fill="none" style={{ opacity: 0 }} />
      ))}
      <circle className="vessel ol" cx={CORE[0]} cy={CORE[1]} r={CORE_R + 8} />
      <circle data-part="core" cx={CORE[0]} cy={CORE[1]} r={CORE_R - 18} fill="url(#meltdown-core-grad)" />
      <circle data-part="core-flash" cx={CORE[0]} cy={CORE[1]} r={CORE_R + 30} className="core-flash" filter="url(#critter-blur)" style={{ opacity: 0 }} />
      <circle className="vessel-rim" cx={CORE[0]} cy={CORE[1]} r={CORE_R - 18} fill="none" strokeWidth="8" />
      <g data-part="cracks" className="meltdown-cracks" fill="none" strokeLinecap="round" strokeLinejoin="round">
        {CRACKS.map((d) => <path key={d} d={d} strokeWidth="5" filter="url(#critter-glow)" />)}
      </g>
      {DRIPS.map(([x, y]) => <path key={x} data-drip="" className="goo-drip" d={`M${x} ${y}`} />)}

      {/* red alarm lights on the walls, with a sweeping beam each */}
      {[34, 366].map((x, i) => (
        <g key={x}>
          <g transform={`translate(${x} 64)`}>
            <path data-part={i ? 'alarm-beam-r' : 'alarm-beam-l'} className="alarm-beam" d="M0 -4 L 64 -20 L 64 20 L 0 4 Z" style={{ opacity: 0 }} />
          </g>
          <rect className="beacon-base ol-thin" x={x - 12} y="70" width="24" height="10" rx="2" />
          <path data-alarm="" className="alarm" d={`M${x - 10} 70 Q ${x - 10} 50 ${x} 50 Q ${x + 10} 50 ${x + 10} 70 Z`} />
        </g>
      ))}

      {/* a tilted warning sign on the left, the temperature gauge on the right */}
      <g transform="rotate(-12 40 150)">
        <rect className="sign" x="14" y="124" width="52" height="52" rx="6" />
        <circle cx="40" cy="150" r="19" fill="#1b1b1f" />
        <circle cx="40" cy="150" r="17" fill="#f4c20d" />
        <path d={trefoil(40, 150, 15)} fill="#1b1b1f" />
      </g>
      <rect className="gauge ol-thin" x="334" y="222" width="56" height="44" rx="5" />
      <path className="gauge-dial" d="M342 256 A 20 20 0 0 1 382 256 Z" />
      <path d="M372 240 A 20 20 0 0 1 382 256 L 362 256 Z" fill="#e2312a" opacity="0.8" />
      <path data-part="gauge-needle" d="M362 252 V 236" stroke="#1b1b1f" strokeWidth="2.2" strokeLinecap="round" />

      {/* the floor: steel plates behind a hazard stripe, glowing puddles of goo */}
      <rect className="bunker-floor" x="0" y="344" width="400" height="56" />
      <path className="bunker-seam" d="M0 372 H400 M60 344 V400 M160 344 V400 M260 344 V400 M360 344 V400" fill="none" strokeWidth="2" />
      <rect x="0" y="338" width="400" height="9" fill="url(#meltdown-hazard)" />
      <ellipse data-puddle="" className="goo ol-thin" cx="58" cy="374" rx="44" ry="10" />
      <ellipse data-puddle="" className="goo ol-thin" cx="340" cy="376" rx="52" ry="11" />
      {BUBBLES.map(([x, r], i) => <circle key={i} data-bubble="" className="goo-bubble" cx={x} cy="372" r={r} style={{ opacity: 0 }} />)}

      <Shadow cx={200} cy={366} rx={66} />
      <Legs species={species} shoe="boot-black" />

      <Body species={species}>
        {/* hi-vis coveralls: reflective stripes across, a zip, a radiation patch */}
        <path d="M200 252 V 330" className="coverall-zip" strokeWidth="2.4" />
        <path d="M148 300 H 252" className="coverall-stripe" strokeWidth="6" />
        <path d="M148 312 H 252" className="coverall-stripe-2" strokeWidth="3" />
        <circle cx="228" cy="276" r="9" fill="#f4c20d" stroke="#1b1b1f" strokeWidth="1.5" />
        <path d={trefoil(228, 276, 8)} fill="#1b1b1f" />
        <BodyOutfits />
      </Body>
      <Skirt species={species} trim="coat-trim" />

      <Head
        species={species}
        hat={
          <g className="own-hat">
            {/* goggles pushed up on the forehead */}
            <path className="goggle-strap" d="M118 132 Q 200 104 282 132" fill="none" strokeWidth="9" />
            {[170, 230].map((x) => (
              <g key={x}>
                <circle className="goggle-rim ol-thin" cx={x} cy="118" r="17" />
                <circle className="goggle-lens" cx={x} cy="118" r="11" />
                <path d={`M${x - 6} ${112} q 4 -4 9 -3`} stroke="rgb(255 255 255 / 0.7)" strokeWidth="2.4" fill="none" strokeLinecap="round" />
              </g>
            ))}
          </g>
        }
      />

      {/* a hand mic beside the face, and the free hand pumping a fist */}
      <Arm part="arm-l" d="M138 268 Q 112 280 140 248" hand={[142, 246]}>
        {([x, y]) => (
          <g>
            <path className="mic-body ol-thin" d={`M${x - 4} ${y + 8} L ${x - 5} ${y - 16} H${x + 5} L ${x + 4} ${y + 8} Z`} />
            <circle className="meltdown-mic ol-thin" cx={x} cy={y - 22} r="9" />
            <path d={`M${x - 7} ${y - 25} H${x + 7} M${x - 8} ${y - 21} H${x + 8} M${x - 7} ${y - 17} H${x + 7}`} stroke="rgb(0 0 0 / 0.35)" strokeWidth="1.1" />
          </g>
        )}
      </Arm>
      <Arm part="arm-r" d="M262 268 Q 300 270 312 238" hand={[312, 236]} />
    </CritterFrame>
  );
}
