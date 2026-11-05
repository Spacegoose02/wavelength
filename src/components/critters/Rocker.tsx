import { useRef } from 'react';
import { playGuitar, newGuitarHands } from './guitar';
import { swell, windUp } from './flourish';
import { Arm, Body, FretArm, FretHand, BodyOutfits, CritterFrame, Head, Legs, Shadow } from './parts';
import type { ActProps } from './species';
import { useCritterRig } from './rig';

/**
 * Rocker raccoon in front of two amp stacks: a flying-V in the skin's colours, a studded
 * leather jacket, and a proper headbang on the beat. The amp lights follow the bass, mids and highs.
 * Strums eighth notes in time. Flourish: a full windmill strum with the guitar tipped up. Paused, he rests.
 */
export function Rocker({ species, still }: ActProps) {
  const root = useRef<SVGSVGElement>(null);
  const hands = useRef(newGuitarHands());

  useCritterRig(
    root,
    (f) => {
      playGuitar(f, hands.current, 24, 1.3, 2);
      if (f.flourish) {
        f.$('arm-l').setAttribute('transform', `rotate(${(-360 * windUp(f.flourish)).toFixed(1)} 138 268)`);
        f.$('guitar').setAttribute('transform', `rotate(${(-10 * swell(f.flourish)).toFixed(2)} 200 320)`);
      }
      const levels = [f.a.bass, f.a.mid, f.a.treble * 1.6];
      root.current!.querySelectorAll<SVGElement>('[data-level]').forEach((led) => {
        const [band, step] = led.dataset.level!.split(':').map(Number);
        led.style.opacity = levels[band] * 5 > step ? '1' : '0.15';
      });
    },
    { still, nod: 18 },
  );

  return (
    <CritterFrame ref={root} kind="rocker" species={species} label={`A rocker ${species.noun} playing electric guitar`}>
      {/* amp stacks and stage */}
      {[12, 308].map((x) => (
        <g key={x}>
          <rect className="amp" x={x} y="150" width="80" height="44" rx="4" />
          <rect data-glow="" className="amp-logo" x={x + 14} y="158" width="52" height="7" rx="3.5" />
          {[0, 1, 2, 3].map((i) => <circle key={i} cx={x + 16 + i * 16} cy="182" r="4" fill="#3a3a42" stroke="#9a9aa4" strokeWidth="1" />)}
          <rect className="amp" x={x} y="198" width="80" height="148" rx="4" />
          <rect className="grille" x={x + 7} y="205" width="66" height="134" rx="3" />
          <rect x={x + 30} y="326" width="20" height="5" rx="1" fill="#c9c9d1" />
        </g>
      ))}
      <rect className="stage" x="0" y="340" width="400" height="60" />
      {[0, 1, 2].map((band) =>
        Array.from({ length: 5 }, (_, step) => (
          <rect key={`${band}-${step}`} data-level={`${band}:${step}`} className={`led led-${band}`} x={110 + band * 64 + step * 11} y="376" width="8" height="8" rx="2" />
        )),
      )}

      {[52, 348].map((cx) => <Shadow key={cx} cx={cx} cy={346} rx={46} ry={5} />)}
      <Shadow cx={200} cy={366} rx={66} />

      {/* ripped black jeans and boots */}
      <Legs species={species} shoe="boot-black" />

      <Body species={species}>
        <path className="leather" d="M116 304 C 116 262, 150 246, 186 246 L 178 304 Z" />
        <path className="leather" d="M284 304 C 284 262, 250 246, 214 246 L 222 304 Z" />
        <path d="M186 246 L 170 274 L 182 280 M214 246 L 230 274 L 218 280" fill="none" stroke="#3a3a42" strokeWidth="2.5" />
        {[[140, 262], [152, 256], [164, 252], [260, 262], [248, 256], [236, 252]].map(([cx, cy]) => <circle key={cx} cx={cx} cy={cy} r="2.6" fill="#d8d8de" />)}
        <BodyOutfits />
      </Body>

      <Head species={species} />


      {/* the fretting arm hangs behind the guitar; only its hand is in front, on the neck */}
      <FretArm hand={[296, 266]} />

      {/* flying-V, neck up to the right */}
      <g data-part="guitar">
        <g transform="translate(178 318) rotate(-24)">
          <rect className="fretboard" x="36" y="-6" width="136" height="12" rx="1" />
          {[64, 88, 110, 130, 148, 164].map((x) => <path key={x} d={`M${x} -6 V6`} stroke="#9a9aa4" strokeWidth="1" />)}
          {[76, 120, 156].map((x) => <circle key={x} cx={x} cy="0" r="1.8" fill="#e8e8ee" />)}
          <path className="fretboard" d="M170 -8 L 206 -14 L 198 0 L 206 12 L 170 8 Z" />
          <path className="axe" d="M44 -9 L -54 -42 L -60 -30 L -22 0 L -60 30 L -54 42 L 44 9 Z" />
          <path d="M30 -8 L -20 -26 L -4 0 L -20 26 L 30 8 Z" fill="rgb(255 255 255 / 0.85)" />
          <rect x="6" y="-9" width="8" height="18" rx="2" fill="#16161a" />
          <rect x="22" y="-9" width="8" height="18" rx="2" fill="#16161a" />
          <circle cx="-32" cy="-26" r="3.5" fill="#d8d8de" /><circle cx="-32" cy="26" r="3.5" fill="#d8d8de" />
          <g data-part="strings">
            {[-4, -1.3, 1.3, 4].map((y) => <path key={y} d={`M-6 ${y} H200`} stroke="#eef" strokeWidth="0.9" />)}
          </g>
        </g>
      </g>

      <Arm part="arm-l" d="M138 268 Q 146 302 178 314" hand={[180, 314]} />
      <FretHand hand={[296, 266]} />
    </CritterFrame>
  );
}
