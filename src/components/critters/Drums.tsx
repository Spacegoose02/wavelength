import { useRef } from 'react';
import { Arm, Body, BodyOutfits, CritterFrame, Head, Legs, TORSO } from './parts';
import type { ActProps } from './species';
import { useCritterRig } from './rig';

/** Bubbles: x, size, where in the climb each starts (0..1), speed. */
const BUBBLES: [number, number, number, number][] = [
  [30, 5, 0, 1], [70, 3, 0.45, 1.3], [128, 4, 0.7, 0.9], [176, 3, 0.2, 1.2],
  [238, 5, 0.85, 1], [282, 3, 0.35, 1.4], [352, 4, 0.6, 1.1], [384, 3, 0.1, 0.8],
];

/**
 * Drummer shark under the sea, behind a drum kit. A striped sailor tee, the drum shells and the kick drum's
 * logo take the skin's colours. The snare hand hits on the beat, the cymbal hand crashes on strong highs,
 * the kick drum thumps, the bubbles rise faster with the bass and the seaweed sways. Paused, the sticks rest.
 */
export function Drums({ species, still }: ActProps) {
  const { Tail } = species;
  const root = useRef<SVGSVGElement>(null);
  const state = useRef({ rise: 0 });

  useCritterRig(
    root,
    ({ t, a, idle, bob, hit, rock, $ }) => {
      const s = state.current;
      const svg = root.current!;
      // snare hand lifts between beats and comes down on them; cymbal hand crashes on sharp highs
      const lift = idle ? 1 + Math.sin(t * 1.1) : a.live ? (1 - bob) * 14 : Math.abs(Math.sin(t * 4)) * 12;
      $('arm-l').setAttribute('transform', `rotate(${lift.toFixed(2)} 138 268)`);
      const crash = idle ? Math.sin(t * 0.9) * 1.5 : hit ? -Math.abs(rock) * 14 : a.live ? -a.mid * 10 : -Math.max(0, Math.sin(t * 2)) * 8;
      $('arm-r').setAttribute('transform', `rotate(${crash.toFixed(2)} 262 268)`);
      $('crash').setAttribute('transform', `rotate(${(hit ? rock * 7 : bob * 2).toFixed(2)} 344 236)`);
      $('snare').setAttribute('transform', `translate(0 ${(a.playing ? bob * 1.5 : 0).toFixed(2)})`);
      $('hihat').setAttribute('transform', `translate(0 ${(a.playing ? -(1 - bob) * 3 : 0).toFixed(2)})`);
      const k = 1 + (a.playing ? bob * 0.05 : 0);
      $('kick').setAttribute('transform', `translate(200 344) scale(${k.toFixed(3)}) translate(-200 -344)`);

      s.rise += (0.08 + (a.playing ? a.bass * 0.35 : 0)) / 60;
      svg.querySelectorAll<SVGElement>('[data-bubble]').forEach((b, i) => {
        const [, , start, speed] = BUBBLES[i];
        const p = (s.rise * speed + start) % 1;
        b.setAttribute('cy', (340 - p * 330).toFixed(1));
        b.setAttribute('cx', (BUBBLES[i][0] + Math.sin(t * 2 + i) * 4).toFixed(1));
        b.style.opacity = (p < 0.85 ? 0.7 : (1 - p) * 4.6).toFixed(2);
      });
      svg.querySelectorAll<SVGElement>('[data-weed]').forEach((w, i) => {
        w.setAttribute('transform', `rotate(${(Math.sin(t * 1.1 + i * 1.7) * (6 + a.bass * 6)).toFixed(2)})`);
      });
    },
    { still, nod: 12 },
  );

  return (
    <CritterFrame ref={root} kind="drums" species={species.id} label={`A ${species.noun} playing the drums under the sea`}>
      {/* sunlight through the water, sea floor, seaweed and bubbles */}
      <path d="M40 0 L 90 0 L 150 340 L 120 340 Z M200 0 L 240 0 L 270 340 L 230 340 Z M320 0 L 350 0 L 380 340 L 350 340 Z" fill="rgb(255 255 255 / 0.05)" />
      <path className="sand" d="M0 350 Q 100 338 200 348 T 400 346 V400 H0 Z" />
      <path className="sand-dark" d="M24 372 q 20 -6 40 0 M300 384 q 24 -6 48 0 M150 390 q 16 -5 32 0" fill="none" strokeWidth="2.5" strokeLinecap="round" />
      {[[14, 0], [32, 1], [378, 0], [392, 1]].map(([x, shade]) => (
        <g key={x} transform={`translate(${x} 352)`}>
          <path data-weed="" className={shade ? 'weed weed-2' : 'weed'} d="M0 0 C -12 -30, 12 -50, 0 -80 C -12 -110, 10 -130, 0 -160" fill="none" strokeWidth="9" strokeLinecap="round" />
        </g>
      ))}
      {BUBBLES.map(([x, r], i) => <circle key={i} data-bubble="" cx={x} cy="340" r={r} fill="rgb(255 255 255 / 0.12)" stroke="rgb(255 255 255 / 0.6)" strokeWidth="1.5" />)}

      {Tail && <Tail />}
      <Legs species={species}>{null}</Legs>

      <Body species={species}>
        <path className="top" d={TORSO} />
        <path d="M144 262 H256 M126 278 H274 M118 294 H282" className="tee-stripe" strokeWidth="6" />
        <path className="neckline" d="M184 246 L 200 266 L 216 246 Z" />
        <BodyOutfits />
      </Body>

      <Head species={species} />

      {/* the kit: hi-hat, snare, kick with a tom on it, floor tom, crash */}
      <path className="stand" d="M44 276 V366 M44 366 L 30 378 M44 366 L 58 378 M104 334 V352 L 88 368 M104 352 L 120 368 M344 236 V366 L 330 378 M344 366 L 358 378 M276 350 V372 M324 350 V372" fill="none" strokeWidth="3" strokeLinecap="round" />
      <ellipse className="cymbal" cx="44" cy="294" rx="30" ry="5" />
      <ellipse data-part="hihat" className="cymbal" cx="44" cy="288" rx="30" ry="5" />
      <g data-part="kick">
        <circle className="drum-shell" cx="200" cy="344" r="50" />
        <circle className="drum-head" cx="200" cy="344" r="42" />
        <circle className="drum-hoop" cx="200" cy="344" r="46" fill="none" strokeWidth="4" />
        <text x="200" y="356" textAnchor="middle" fontSize="34" fontWeight="900" className="drum-logo">W</text>
      </g>
      <rect className="drum-shell" x="176" y="286" width="48" height="20" rx="2" />
      <ellipse className="drum-head" cx="200" cy="286" rx="24" ry="6" />
      <g data-part="snare">
        <rect className="drum-shell" x="70" y="316" width="68" height="18" rx="2" />
        <path d="M74 322 V332 M86 322 V332 M98 322 V332 M110 322 V332 M122 322 V332 M134 322 V332" className="stand" strokeWidth="1.5" />
        <ellipse className="drum-head" cx="104" cy="316" rx="34" ry="8" />
      </g>
      <rect className="drum-shell" x="268" y="314" width="64" height="38" rx="2" />
      <ellipse className="drum-head" cx="300" cy="314" rx="32" ry="8" />
      <g data-part="crash">
        <ellipse className="cymbal" cx="344" cy="236" rx="42" ry="7" transform="rotate(-12 344 236)" />
        <circle className="cymbal-bell" cx="344" cy="235" r="5" />
      </g>

      {/* fins with sticks: snare hand (left of picture), cymbal hand (right) */}
      <Arm part="arm-l" d="M138 268 Q 118 286 116 300" hand={[116, 302]} thumb={[124, 298]}>
        <path className="stick" d="M116 302 L 80 318" strokeWidth="4" strokeLinecap="round" />
      </Arm>
      <Arm part="arm-r" d="M262 268 Q 282 278 294 264" hand={[296, 262]} thumb={[290, 256]}>
        <path className="stick" d="M296 262 L 330 242" strokeWidth="4" strokeLinecap="round" />
      </Arm>
    </CritterFrame>
  );
}
