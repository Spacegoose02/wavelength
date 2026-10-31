import { useRef } from 'react';
import { Arm, BodyOutfits, CritterFrame, Head, TORSO } from './parts';
import type { ActProps } from './species';
import { useCritterRig } from './rig';

/** Pines: x, height, half-width at the base. */
const PINES = [[34, 230, 46], [96, 170, 36], [286, 130, 28], [372, 210, 42]];

const FIREFLIES = [[40, 230], [96, 180], [300, 200], [360, 250], [70, 290], [340, 160]];

/**
 * A bear in the woods at night by a campfire, playing an accordion. Black or brown fur (two picks, one
 * drawing); the beanie, sweater and bellows take the skin's colours. The bellows squeeze in and out faster
 * with the bass and puff on the beat, the campfire flares with the bass, fireflies blink with the highs.
 * Paused, the bellows breathe slowly and he pulls his beanie straight now and then.
 */
export function Accordion({ species, still }: ActProps) {
  const { Face, Tail } = species;
  const root = useRef<SVGSVGElement>(null);
  const state = useRef({ ph: 0 });

  useCritterRig(
    root,
    ({ t, a, idle, bob, $ }) => {
      const s = state.current;
      const svg = root.current!;
      s.ph += (idle ? 0.8 : a.live ? 2.5 + a.bass * 6 : 3.5) / 60;
      const dx = Math.sin(s.ph) * (idle ? 3 : 9) + (a.playing ? bob * 4 : 0);
      $('bellows').setAttribute('transform', `translate(200 0) scale(${(1 + dx / 44).toFixed(3)} 1) translate(-200 0)`);
      $('acc-l').setAttribute('transform', `translate(${(-dx).toFixed(2)} 0)`);
      $('acc-r').setAttribute('transform', `translate(${dx.toFixed(2)} 0)`);
      const deg = (dx / 32) * 57.3;
      $('arm-l').setAttribute('transform', `rotate(${deg.toFixed(2)} 138 268)`);
      $('arm-r').setAttribute('transform', `rotate(${(-deg).toFixed(2)} 262 268)`);

      const flare = 1 + (a.playing ? a.bass * 0.35 + bob * 0.15 : 0) + Math.sin(t * 13) * 0.05 + Math.sin(t * 7.3) * 0.04;
      $('flame').setAttribute('transform', `translate(332 352) scale(${(1 + Math.sin(t * 9) * 0.04).toFixed(3)} ${flare.toFixed(3)}) translate(-332 -352)`);
      svg.querySelectorAll<SVGElement>('[data-fly]').forEach((f, i) => {
        const [x, y] = FIREFLIES[i];
        f.setAttribute('cx', (x + Math.sin(t * 0.7 + i * 2) * 10).toFixed(1));
        f.setAttribute('cy', (y + Math.cos(t * 0.9 + i) * 8).toFixed(1));
        f.style.opacity = Math.max(0, Math.sin(t * (1.5 + i * 0.3) + i) * 0.7 + (a.playing ? a.treble * 0.6 : 0.1)).toFixed(2);
      });
    },
    { still, nod: 12 },
  );

  return (
    <CritterFrame ref={root} kind="accordion" species={species.id} label={`A ${species.noun} playing the accordion by a campfire`}>
      {/* moon, pines, ground, campfire, fireflies */}
      <circle className="moon-disc" cx="330" cy="68" r="24" />
      {PINES.map(([x, h, w]) => (
        <path key={x} className="pine" d={`M${x} ${340 - h} L ${x + w * 0.65} ${340 - h * 0.42} H ${x - w * 0.65} Z M${x} ${340 - h * 0.7} L ${x + w} 340 H ${x - w} Z`} />
      ))}
      <path className="forest-floor" d="M0 338 Q 200 326 400 338 V400 H0 Z" />
      <path className="log" d="M300 360 L 364 346 L 368 356 L 304 370 Z M300 346 L 364 360 L 360 370 L 296 356 Z" />
      <circle data-glow="" className="fire-glow" cx="332" cy="340" r="34" />
      <g data-part="flame">
        <path className="flame-a" d="M332 352 C 312 340 316 318 326 300 C 328 316 336 314 334 296 C 352 312 352 340 332 352 Z" />
        <path className="flame-b" d="M332 352 C 322 344 324 330 330 320 C 332 330 338 330 338 322 C 346 334 342 348 332 352 Z" />
      </g>
      {FIREFLIES.map(([x, y]) => <circle key={`${x},${y}`} data-fly="" className="firefly" cx={x} cy={y} r="2.6" />)}

      {Tail && <Tail />}

      {/* legs and big paws */}
      <path className="bear-fur" d="M158 296 H190 V350 H158 Z M210 296 H242 V350 H210 Z" />
      <ellipse className="bear-fur" cx="172" cy="352" rx="22" ry="10" />
      <ellipse className="bear-fur" cx="228" cy="352" rx="22" ry="10" />
      <path className="bear-fur-dark" d="M160 352 v 6 M170 354 v 6 M180 352 v 6 M220 352 v 6 M230 354 v 6 M240 352 v 6" stroke="rgb(0 0 0 / 0.3)" strokeWidth="2" />

      <g data-part="body">
        <path className="top" d={TORSO} />
        <path d="M122 294 H278" stroke="rgb(0 0 0 / 0.2)" strokeWidth="8" />
        <path d="M166 248 Q 200 262 234 248" fill="none" stroke="rgb(0 0 0 / 0.25)" strokeWidth="6" />
        <BodyOutfits />
      </g>

      <Head
        face={<Face />}
        own={
          <g data-part="adjust" className="own-hat">
            <path className="beanie" d="M134 132 Q 134 72 200 70 Q 266 72 266 132 Z" />
            <path d="M160 82 V128 M180 74 V128 M200 72 V128 M220 74 V128 M240 82 V128" stroke="rgb(0 0 0 / 0.15)" strokeWidth="3" />
            <rect className="beanie-cuff" x="130" y="116" width="140" height="20" rx="9" />
            <circle className="beanie-pom" cx="200" cy="66" r="13" />
          </g>
        }
      />

      {/* accordion: buttons on the left box, keys on the right, bellows between */}
      <g data-part="bellows">
        <rect className="bellows" x="156" y="272" width="88" height="62" rx="2" />
        {Array.from({ length: 10 }, (_, i) => <path key={i} d={`M${160 + i * 9} 272 V334`} stroke="rgb(0 0 0 / 0.35)" strokeWidth="2" />)}
        <path d="M156 272 H244 M156 334 H244" stroke="#d8d8de" strokeWidth="2" />
      </g>
      <g data-part="acc-l">
        <rect className="acc-box" x="130" y="266" width="28" height="74" rx="4" />
        {[0, 1, 2, 3, 4].map((i) => <circle key={i} cx="144" cy={280 + i * 11} r="3.2" fill="#ececf1" />)}
      </g>
      <g data-part="acc-r">
        <rect className="acc-box" x="242" y="266" width="28" height="74" rx="4" />
        <rect x="248" y="272" width="16" height="62" rx="2" fill="#ececf1" />
        {Array.from({ length: 7 }, (_, i) => <path key={i} d={`M248 ${280 + i * 8} H264`} stroke="#9a9aa4" strokeWidth="1" />)}
        {[0, 1, 3, 4, 5].map((i) => <rect key={i} x="256" y={278 + i * 8} width="8" height="4.5" fill="#16161a" />)}
      </g>

      <Arm part="arm-l" d="M138 268 Q 128 290 142 304" hand={[144, 306]} thumb={[150, 300]} />
      <Arm part="arm-r" d="M262 268 Q 272 290 258 304" hand={[256, 306]} thumb={[250, 300]} />
    </CritterFrame>
  );
}
