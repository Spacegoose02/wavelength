import { useRef } from 'react';
import { swell, windUp } from './flourish';
import { playGuitar, newGuitarHands } from './guitar';
import { Arm, ArmHand, Body, BodyOutfits, CritterFrame, Head, Legs, Shadow, Skirt } from './parts';
import type { ActProps } from './species';
import { useCritterRig } from './rig';

/**
 * Country raccoon on a porch in front of a fence: cowboy hat, plaid shirt and bandana in the skin's colours,
 * a five-string banjo rolled in time, and a boot that taps the beat. Flourish: spins the banjo a full turn
 * on its pot and tips the hat. Paused, he tips his hat now and then.
 */
export function Country({ species, still }: ActProps) {
  const root = useRef<SVGSVGElement>(null);
  const hands = useRef(newGuitarHands());

  useCritterRig(
    root,
    (f) => {
      // a banjo roll: four picking strokes a beat
      playGuitar(f, hands.current, 22, 1, 4);
      if (f.flourish) {
        const up = swell(f.flourish);
        f.$('guitar').setAttribute('transform', `rotate(${(360 * windUp(f.flourish)).toFixed(1)} 170 318)`);
        f.$('arm-l').setAttribute('transform', `rotate(${(-28 * up).toFixed(2)} 138 268)`);
        f.$('arm-r').setAttribute('transform', `rotate(${(-18 * up).toFixed(2)} 262 268)`);
        f.$('adjust').setAttribute('transform', `translate(0 ${(-10 * up).toFixed(2)}) rotate(${(-8 * up).toFixed(2)} 200 110)`);
      }
      f.$('boot').setAttribute('transform', `rotate(${(f.a.live ? -f.bob * 16 : f.idle ? 0 : -Math.max(0, Math.sin(f.t * 6)) * 12).toFixed(2)} 236 362)`);
    },
    { still },
  );

  return (
    <CritterFrame ref={root} kind="country" species={species} label={`A country ${species.noun} playing guitar`}>
      <defs>
        <pattern id="raccoon-plaid" width="18" height="18" patternUnits="userSpaceOnUse">
          <rect x="0" y="0" width="18" height="6" fill="rgb(0 0 0 / 0.22)" />
          <rect x="0" y="0" width="6" height="18" fill="rgb(0 0 0 / 0.22)" />
          <path d="M12 0 V18 M0 12 H18" stroke="rgb(255 255 255 / 0.25)" strokeWidth="1" />
        </pattern>
      </defs>

      {/* fence and porch */}
      {[34, 104, 296, 366].map((x) => (
        <rect key={x} className="fence" x={x - 7} y="196" width="14" height="128" rx="2" />
      ))}
      <rect className="fence-dark" x="16" y="224" width="368" height="11" rx="2" />
      <rect className="fence-dark" x="16" y="272" width="368" height="11" rx="2" />
      <rect className="porch" x="0" y="320" width="400" height="80" />
      {[340, 362, 384].map((y) => (
        <path key={y} d={`M0 ${y} H400`} className="porch-line" strokeWidth="2" />
      ))}

      {[34, 104, 296, 366].map((x) => <Shadow key={x} cx={x + 4} cy={324} rx={12} ry={3} />)}
      <Shadow cx={200} cy={366} rx={66} />

      {/* legs and boots */}
      <Legs species={species} shoe="boot" />

      <Body species={species}>
        <rect x="100" y="200" width="200" height="200" fill="url(#raccoon-plaid)" />
        <path d="M178 246 L 200 262 L 222 246" fill="none" stroke="rgb(0 0 0 / 0.3)" strokeWidth="3" />
        <path className="bandana" d="M166 244 Q 200 254 234 244 L 200 280 Z" />
        <circle cx="192" cy="256" r="2" fill="#fff" opacity="0.7" /><circle cx="208" cy="256" r="2" fill="#fff" opacity="0.7" /><circle cx="200" cy="267" r="2" fill="#fff" opacity="0.7" />
        <BodyOutfits />
      </Body>
      <Skirt species={species} style="fringe" className="skirt-denim" />

      <Head
        species={species}
        hat={
          <g data-part="adjust" className="own-hat">
            <path className="cowboy" d="M150 118 Q 148 78 172 72 Q 186 70 200 82 Q 214 70 228 72 Q 252 78 250 118 Z" />
            <path className="cowboy-dark" d="M196 84 Q 200 100 204 84" fill="none" strokeWidth="3" />
            <rect className="hat-band" x="150" y="104" width="100" height="10" />
            <path className="cowboy" d="M92 116 Q 120 132 200 114 Q 280 132 308 116 Q 312 132 286 136 Q 200 124 114 136 Q 88 132 92 116 Z" />
          </g>
        }
      />

      <Arm part="arm-r" d="M262 268 Q 262 308 306 264" hand={[306, 264]} handLater />

      {/* five-string banjo, neck up to the right: a drum-head pot with a metal rim, a long thin neck and the
          short fifth string's peg halfway up */}
      <g data-part="guitar">
        <g transform="translate(170 318) rotate(-22)">
          <rect className="neck" x="36" y="-6" width="176" height="12" rx="2" />
          {[64, 86, 106, 124, 140, 154, 168, 180, 192].map((x) => <path key={x} d={`M${x} -6 V6`} stroke="#c9b48a" strokeWidth="1.2" />)}
          {[96, 132, 160].map((x) => <circle key={x} cx={x} cy="0" r="1.6" fill="#f2ead8" />)}
          <path className="neck" d="M210 -9 L 240 -12 Q 246 0 240 12 L 210 9 Z" />
          {[218, 230].map((x) => <g key={x}><circle cx={x} cy="-13" r="3" fill="#d8d8de" /><circle cx={x} cy="13" r="3" fill="#d8d8de" /></g>)}
          <circle cx="112" cy="9" r="3" fill="#d8d8de" />
          <circle className="banjo-rim" cx="0" cy="0" r="42" />
          {Array.from({ length: 16 }, (_, i) => {
            const a = (i / 16) * Math.PI * 2;
            return <circle key={i} cx={(Math.cos(a) * 38.5).toFixed(1)} cy={(Math.sin(a) * 38.5).toFixed(1)} r="1.8" fill="#8a8a93" />;
          })}
          <circle className="banjo-head" cx="0" cy="0" r="35" />
          <path d="M-38 0 H-30" stroke="#8a8a93" strokeWidth="5" strokeLinecap="round" />
          <path d="M-34 -6 L -14 -4 L -14 4 L -34 6 Z" fill="#9a9aa4" />
          <rect x="4" y="-7" width="4" height="14" rx="1" fill="#6e4220" />
          <g data-part="strings">
            {[-4, -2, 0, 2].map((y) => <path key={y} d={`M-30 ${y} H226`} stroke="#5a5a62" strokeWidth="0.8" />)}
            <path d="M-30 4 H112" stroke="#5a5a62" strokeWidth="0.8" />
          </g>
        </g>
      </g>

      {/* the strumming arm goes over the guitar body; only the fretting arm is behind the neck */}
      <Arm part="arm-l" d="M138 268 Q 146 300 182 308" hand={[184, 308]} />
      <ArmHand part="arm-r" d="M262 268 Q 262 308 306 264" hand={[306, 264]} />
    </CritterFrame>
  );
}
