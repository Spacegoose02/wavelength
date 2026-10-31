import { useRef } from 'react';
import { playGuitar, newGuitarHands } from './guitar';
import { Arm, BodyOutfits, Head, CritterFrame, Tail, TORSO } from './parts';
import { useCritterRig } from './rig';

/**
 * Country raccoon on a porch in front of a fence: cowboy hat, plaid shirt and bandana in the skin's colours,
 * an acoustic guitar, and a boot that taps the beat. Paused, he tips his hat now and then.
 */
export function Country({ still }: { still?: boolean }) {
  const root = useRef<SVGSVGElement>(null);
  const hands = useRef(newGuitarHands());

  useCritterRig(
    root,
    (f) => {
      playGuitar(f, hands.current, 22);
      f.$('boot').setAttribute('transform', `rotate(${(f.a.live ? -f.bob * 16 : f.idle ? 0 : -Math.max(0, Math.sin(f.t * 6)) * 12).toFixed(2)} 236 362)`);
    },
    { still },
  );

  return (
    <CritterFrame ref={root} kind="country" label="A country raccoon playing guitar">
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

      <Tail />

      {/* legs and boots */}
      <path className="legs" d="M160 296 H186 V352 H160 Z M214 296 H240 V352 H214 Z" />
      <path className="boot" d="M156 346 H190 V364 H148 Q 148 352 156 346 Z" />
      <path data-part="boot" className="boot" d="M210 346 H244 Q 252 352 252 364 H210 Z" />

      <g data-part="body">
        <path className="top" d={TORSO} />
        <path d={TORSO} fill="url(#raccoon-plaid)" />
        <path d="M178 246 L 200 262 L 222 246" fill="none" stroke="rgb(0 0 0 / 0.3)" strokeWidth="3" />
        <path className="bandana" d="M166 244 Q 200 254 234 244 L 200 280 Z" />
        <circle cx="192" cy="256" r="2" fill="#fff" opacity="0.7" /><circle cx="208" cy="256" r="2" fill="#fff" opacity="0.7" /><circle cx="200" cy="267" r="2" fill="#fff" opacity="0.7" />
        <BodyOutfits />
      </g>

      <Head
        own={
          <g data-part="adjust" className="own-hat">
            <path className="cowboy" d="M150 118 Q 148 78 172 72 Q 186 70 200 82 Q 214 70 228 72 Q 252 78 250 118 Z" />
            <path className="cowboy-dark" d="M196 84 Q 200 100 204 84" fill="none" strokeWidth="3" />
            <rect className="hat-band" x="150" y="104" width="100" height="10" />
            <path className="cowboy" d="M92 116 Q 120 132 200 114 Q 280 132 308 116 Q 312 132 286 136 Q 200 124 114 136 Q 88 132 92 116 Z" />
          </g>
        }
      />

      {/* acoustic guitar, neck up to the right */}
      <g data-part="guitar">
        <g transform="translate(170 318) rotate(-22)">
          <rect className="neck" x="74" y="-7" width="130" height="14" rx="2" />
          {[100, 124, 146, 166, 184].map((x) => <path key={x} d={`M${x} -7 V7`} stroke="#c9b48a" strokeWidth="1.2" />)}
          <path className="neck" d="M202 -10 L 232 -12 L 232 12 L 202 10 Z" />
          {[210, 222].map((x) => <g key={x}><circle cx={x} cy="-13" r="3" fill="#d8d8de" /><circle cx={x} cy="13" r="3" fill="#d8d8de" /></g>)}
          <circle className="wood" cx="0" cy="0" r="44" />
          <circle className="wood" cx="50" cy="0" r="32" />
          <path className="wood" d="M0 -40 Q 30 -22 52 -30 L 52 30 Q 30 22 0 40 Z" />
          <circle cx="0" cy="0" r="44" className="wood-edge" fill="none" strokeWidth="3" />
          <circle cx="44" cy="0" r="13" fill="#2a1608" />
          <circle cx="44" cy="0" r="16" fill="none" stroke="#6e4220" strokeWidth="2" />
          <rect x="-24" y="-12" width="8" height="24" rx="2" fill="#3a2210" />
          <g data-part="strings">
            {[-4.5, -1.5, 1.5, 4.5].map((y) => <path key={y} d={`M-20 ${y} H228`} stroke="#f2ead8" strokeWidth="0.9" />)}
          </g>
        </g>
      </g>

      <Arm part="arm-l" d="M138 268 Q 146 300 182 308" hand={[184, 308]} thumb={[190, 302]} />
      <Arm part="arm-r" d="M262 268 Q 292 286 304 266" hand={[306, 264]} thumb={[300, 258]} />
    </CritterFrame>
  );
}
