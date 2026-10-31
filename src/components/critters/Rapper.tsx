import { useRef } from 'react';
import { Arm, Body, BodyOutfits, CritterFrame, Head, Legs, TORSO } from './parts';
import type { ActProps } from './species';
import { useCritterRig } from './rig';

/**
 * Rapper raccoon between two speaker stacks: snapback, shades and gold chain, a mic in one hand and the
 * other hand riding the beat. His mouth moves with the mids while playing and the speaker cones pump with
 * the bass. Paused, the mic and hand drop and he straightens his cap now and then.
 */
export function Rapper({ species, still }: ActProps) {
  const { Tail } = species;
  const root = useRef<SVGSVGElement>(null);
  const state = useRef({ down: 1, pulse: 0 });

  useCritterRig(
    root,
    ({ t, a, idle, bob, $ }) => {
      const s = state.current;
      const svg = root.current!;
      s.down += ((idle ? 1 : 0) - s.down) * 0.06;
      $('arm-l').setAttribute('transform', `rotate(${(s.down * -48 + (idle ? 0 : Math.sin(t * 2) * 2)).toFixed(2)} 138 268)`);
      const hype = a.live ? -bob * 22 : idle ? 0 : -Math.max(0, Math.sin(t * 4)) * 14;
      $('arm-r').setAttribute('transform', `rotate(${(s.down * 62 + hype).toFixed(2)} 262 268)`);

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
    <CritterFrame ref={root} kind="rapper" species={species.id} label={`A rapper ${species.noun} with a microphone`}>
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

      {Tail && <Tail />}

      {/* baggy jeans and sneakers */}
      <Legs species={species}>
        <path className="legs" d="M154 296 H190 L188 352 H156 Z M210 296 H246 L244 352 H212 Z" />
        <path className="sneaker" d="M150 348 H192 Q 196 360 190 366 H146 Q 142 354 150 348 Z" />
        <path className="sneaker" d="M208 348 H250 Q 258 354 254 366 H210 Q 204 360 208 348 Z" />
        <path className="sneaker-stripe" d="M156 356 L 182 352 M216 352 L 242 356" strokeWidth="3" strokeLinecap="round" />
      </Legs>

      <Body species={species}>
        <path className="top" d={TORSO} />
        <path d="M156 250 Q 200 304 244 250" fill="none" className="chain" strokeWidth="5" strokeDasharray="6 3" />
        <circle cx="200" cy="284" r="13" className="medallion" />
        <text x="200" y="289.5" textAnchor="middle" fontSize="15" fontWeight="900" className="medallion-mark">W</text>
        <BodyOutfits />
      </Body>

      <Head
        species={species}
        hat={
          <g data-part="adjust" className="own-hat">
            <path className="cap" d="M140 128 Q 142 70 200 68 Q 258 70 260 128 Z" />
            <path d="M200 70 V128 M168 76 Q 160 100 162 128 M232 76 Q 240 100 238 128" fill="none" stroke="rgb(0 0 0 / 0.2)" strokeWidth="2" />
            <ellipse className="cap-brim" cx="262" cy="126" rx="46" ry="9" transform="rotate(14 262 126)" />
            <circle className="cap" cx="200" cy="69" r="5" />
            <circle className="cap-logo" cx="200" cy="104" r="9" />
          </g>
        }
        eyewear={
          <g className="own-eyewear">
            <path d="M144 156 H192 V166 Q 192 180 176 180 H160 Q 144 180 144 166 Z M208 156 H256 V166 Q 256 180 240 180 H224 Q 208 180 208 166 Z" fill="#0b0b0d" />
            <path d="M192 160 H208" stroke="#0b0b0d" strokeWidth="4" />
            <path data-glow="" d="M150 162 L 160 160 M214 162 L 224 160" className="shade-glint" strokeWidth="2.5" strokeLinecap="round" />
          </g>
        }
      />

      {/* mic hand (left of picture), hype hand (right) */}
      <g data-part="arm-l">
        <path className="sleeve" d="M138 268 Q 124 242 164 226" fill="none" strokeWidth="20" strokeLinecap="round" />
        <path d="M168 228 L 156 252" stroke="#1a1a1e" strokeWidth="9" strokeLinecap="round" />
        <circle cx="176" cy="216" r="11" fill="#c9c9d1" />
        <path d="M168 212 H184 M167 217 H185 M169 222 H183" stroke="#8a8a93" strokeWidth="1.2" />
        <circle className="hand" cx="164" cy="230" r="11" />
        <circle className="fur-dark thumb" cx="170" cy="224" r="3.5" />
      </g>
      <Arm part="arm-r" d="M262 268 Q 300 256 302 222" hand={[302, 218]} thumb={[296, 222]} />
    </CritterFrame>
  );
}
