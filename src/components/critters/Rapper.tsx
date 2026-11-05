import { useRef } from 'react';
import { swell } from './flourish';
import { Arm, Body, BodyOutfits, CritterFrame, Head, Legs, Shadow } from './parts';
import type { ActProps } from './species';
import { useCritterRig } from './rig';

/**
 * Rapper raccoon between two speaker stacks: a snapback worn backwards and a gold chain, a mic in one hand
 * and the other hand riding the beat. His mouth moves with the mids while playing and the speaker cones pump with
 * the bass. Flourish: the hype hand thrown high. Paused, the mic and hand drop and he straightens his cap now and then.
 */
export function Rapper({ species, still }: ActProps) {
  const root = useRef<SVGSVGElement>(null);
  const state = useRef({ down: 1, pulse: 0 });

  useCritterRig(
    root,
    ({ t, a, idle, bob, flourish, $ }) => {
      const s = state.current;
      const svg = root.current!;
      s.down += ((idle ? 1 : 0) - s.down) * 0.06;
      $('arm-l').setAttribute('transform', `rotate(${(s.down * -48 + (idle ? 0 : Math.sin(t * 2) * 2)).toFixed(2)} 138 268)`);
      const hype = a.live ? -bob * 22 : idle ? 0 : -Math.max(0, Math.sin(t * 4)) * 14;
      const show = swell(flourish);
      $('arm-r').setAttribute('transform', `rotate(${(s.down * 62 + hype - show * 30).toFixed(2)} 262 268)`);

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

      <Head
        species={species}
        hat={
          <g data-part="adjust" className="own-hat">
            {/* worn backwards: the brim sticks out behind on the left, the strap's gap shows over the brow */}
            <g transform="translate(200 178) scale(0.84) translate(-204 -168)">
              <path className="cap-brim ol" d="M114 120 Q 92 110 78 118 Q 94 134 120 134 Z" />
              <path className="cap ol" d="M118 140 C 112 74, 300 74, 294 140 Q 206 126 118 140 Z" />
              <path d="M118 140 C 112 74, 300 74, 294 140 Q 206 126 118 140 Z" fill="url(#critter-vinyl)" />
              <path className="cap-gap ol-thin" d="M178 132 Q 180 112 206 110 Q 232 112 234 132 Q 206 128 178 132 Z" />
              <path className="cap-strap" d="M180 124 H 232" strokeWidth="3" strokeLinecap="round" />
              <circle className="cap-logo ol-thin" cx="206" cy="84" r="5" />
            </g>
          </g>
        }
      />

      {/* mic hand (left of picture), hype hand (right) */}
      <Arm part="arm-l" d="M138 268 Q 124 242 164 226" hand={[164, 230]}>
        <path d="M168 228 L 156 252" stroke="#1a1a1e" strokeWidth="9" strokeLinecap="round" />
        <circle cx="176" cy="216" r="11" fill="#c9c9d1" />
        <path d="M168 212 H184 M167 217 H185 M169 222 H183" stroke="#8a8a93" strokeWidth="1.2" />
      </Arm>
      <Arm part="arm-r" d="M262 268 Q 300 256 302 222" hand={[302, 218]} />
    </CritterFrame>
  );
}
