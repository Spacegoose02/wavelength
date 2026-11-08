import { useRef } from 'react';
import { beatClock, bend } from './arm';
import { swell } from './flourish';
import { Arm, Body, BodyOutfits, CritterFrame, Head, Legs, Shadow, Skirt } from './parts';
import type { ActProps } from './species';
import { useCritterRig } from './rig';

/**
 * Rapper raccoon between two speaker stacks: a gold chain, no hat, a mic in one hand
 * bobbing at the mouth and the other hand changing move every bar (chopping on the beat, waving side to side,
 * raising the roof, pointing at the crowd), all from the elbow. His mouth moves with the mids while playing and the speaker cones pump with
 * the bass. Flourish: the hype hand thrown high. Paused, the mic and hand drop.
 */
export function Rapper({ species, still }: ActProps) {
  const root = useRef<SVGSVGElement>(null);
  const state = useRef({ down: 1, pulse: 0, turn: 0, shoulder: 0 });

  useCritterRig(
    root,
    (f) => {
      const { t, a, idle, bob, flourish, $ } = f;
      const s = state.current;
      const svg = root.current!;
      const { phase, index } = beatClock(f);
      s.down += ((idle ? 1 : 0) - s.down) * 0.06;
      // the mic: held at the mouth, bobbing with the beat and tipped with the flow
      $('arm-l').setAttribute('transform', `rotate(${(s.down * -48 + (idle ? 0 : Math.sin(t * 2) * 2)).toFixed(2)} 138 268)`);
      bend($, 'arm-l', { turn: idle ? 0 : bob * 6 + Math.sin(Math.PI * (index + phase)) * 4, wrist: idle ? 0 : Math.sin(t * 3.1) * 6 });

      // the free hand changes move every bar: chops down on each beat, waves side to side over two beats,
      // raises the roof (pushing up on the beat), points out at the crowd on the beat
      const show = swell(flourish);
      const swing = Math.sin(Math.PI * (index + phase));
      const move = Math.floor(index / 4) % 4;
      const [shoulder, turn] = idle
        ? [0, 0]
        : move === 0
          ? [-6, 34 * bob - 10]
          : move === 1
            ? [-18, swing * 34]
            : move === 2
              ? [-24, -16 - bob * 26]
              : [12 - bob * 10, 40 - bob * 30];
      s.shoulder += (shoulder - s.shoulder) * 0.15;
      s.turn += (turn - s.turn) * 0.35;
      $('arm-r').setAttribute('transform', `rotate(${(s.down * 62 + s.shoulder - show * 30).toFixed(2)} 262 268)`);
      bend($, 'arm-r', { turn: s.turn * (1 - show) - show * 20, wrist: idle ? 0 : s.turn * 0.4 });

      svg.querySelectorAll<SVGElement>('[data-cone]').forEach((c) => {
        const [cx, cy] = c.dataset.cone!.split(',').map(Number);
        const k = 1 + (a.playing ? a.bass * 0.14 + bob * 0.06 : 0);
        c.setAttribute('transform', `translate(${cx} ${cy}) scale(${k.toFixed(3)}) translate(${-cx} ${-cy})`);
      });
      const strip = svg.querySelectorAll<SVGElement>('[data-strip]');
      if (a.beat) s.pulse = (s.pulse + 1) % strip.length;
      strip.forEach((el, i) => (el.style.opacity = a.playing ? ((i + s.pulse) % 3 === 0 ? '1' : '0.3') : '0.15'));
    },
    { still, nod: 12 },
  );

  return (
    <CritterFrame ref={root} kind="rapper" species={species} label={`A rapper ${species.noun} with a microphone`}>
      {/* speaker stacks and stage */}
      {[14, 316].map((x) => (
        <g key={x}>
          <rect className="speaker-box" x={x} y="196" width="70" height="150" rx="6" />
          {[[248, 20], [312, 27]].map(([cy, r]) => (
            <g key={cy} data-cone={`${x + 35},${cy}`}>
              <circle className="cone-rim" cx={x + 35} cy={cy} r={r + 4} />
              <circle className="cone" cx={x + 35} cy={cy} r={r} />
              <circle className="cone-cap" cx={x + 35} cy={cy} r={r * 0.32} />
            </g>
          ))}
        </g>
      ))}
      <rect className="stage" x="0" y="340" width="400" height="60" />
      {Array.from({ length: 12 }, (_, i) => (
        <rect key={i} data-strip="" className={`led led-${i % 3}`} x={26 + i * 30} y="378" width="18" height="6" rx="3" />
      ))}

      {[49, 351].map((cx) => <Shadow key={cx} cx={cx} cy={346} rx={42} ry={5} />)}
      <Shadow cx={200} cy={366} rx={66} />

      {/* baggy jeans and sneakers */}
      <Legs species={species} shoe="sneaker" />

      <Body species={species}>
        <path d="M156 250 Q 200 304 244 250" fill="none" className="chain" strokeWidth="5" strokeDasharray="6 3" />
        <circle cx="200" cy="284" r="13" className="medallion" />
        <text x="200" y="289.5" textAnchor="middle" fontSize="15" fontWeight="900" className="medallion-mark">W</text>
        <BodyOutfits />
      </Body>
      <Skirt species={species} style="pleated" className="skirt-alt" />

      <Head species={species} />

      {/* mic hand (left of picture), hype hand (right) */}
      {/* held low beside the chin, tipped up at the mouth, so it doesn't hide the face */}
      <Arm part="arm-l" d="M138 268 Q 120 270 146 256" hand={[146, 258]}>
        <path d="M150 256 L 140 278" stroke="#1a1a1e" strokeWidth="9" strokeLinecap="round" />
        <circle cx="157" cy="245" r="10" fill="#c9c9d1" className="ol-thin" />
        <path d="M150 241 H164 M149 246 H165 M151 251 H163" stroke="#8a8a93" strokeWidth="1.2" />
      </Arm>
      <Arm part="arm-r" d="M262 268 Q 300 256 302 222" hand={[302, 218]} />
    </CritterFrame>
  );
}
