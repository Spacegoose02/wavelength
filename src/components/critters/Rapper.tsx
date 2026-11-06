import { useRef } from 'react';
import { swell } from './flourish';
import { Arm, Body, BodyOutfits, CritterFrame, Head, Legs, Shadow, Skirt } from './parts';
import type { ActProps } from './species';
import { useCritterRig } from './rig';

/**
 * Rapper raccoon between two speaker stacks: a gold chain, no hat, a mic in one hand
 * and the other hand riding the beat. His mouth moves with the mids while playing and the speaker cones pump with
 * the bass. Flourish: the hype hand thrown high. Paused, the mic and hand drop.
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
