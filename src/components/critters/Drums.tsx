import { useRef } from 'react';
import { tube } from './bodies';
import { Arm, Body, BodyOutfits, CritterFrame, Head, Legs, Shadow, Skirt } from './parts';
import type { ActProps } from './species';
import { useCritterRig } from './rig';
import { swell } from './flourish';
import { armJoint, beatClock, bend, lift } from './arm';

/** Bubbles: x, size, where in the climb each starts (0..1), speed. */
/** Where the sticks' tips land, whatever the species' reach: the snare's head, the crash's edge, the floor tom's head. */
const SNARE_AT: [number, number] = [94, 315];
const CRASH_AT: [number, number] = [322, 243];
const TOM_AT: [number, number] = [304, 312];

const angle = (from: readonly [number, number], to: readonly [number, number]) => (Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI;
/** -180..180 */
const wrap = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;

const BUBBLES: [number, number, number, number][] = [
  [30, 5, 0, 1], [70, 3, 0.45, 1.3], [128, 4, 0.7, 0.9], [176, 3, 0.2, 1.2],
  [238, 5, 0.85, 1], [282, 3, 0.35, 1.4], [352, 4, 0.6, 1.1], [384, 3, 0.1, 0.8],
];

/**
 * Drummer shark under the sea, behind a drum kit. A striped sailor tee, the drum shells and the kick drum's
 * logo take the skin's colours. The sticks swing from the elbows: the snare hand hits every beat (harder on 2
 * and 4), the other hand crashes the cymbal at the top of each bar and on strong highs and swings down to the
 * floor tom for the rest. The octopus gets two more tentacles with sticks: one on the hi-hat on the off-beats, one
 * on the floor tom. What gets hit reacts: the crash rocks and rings, the tom and snare dip, the kick thumps, the bubbles rise faster with the bass and the seaweed sways. Flourish: a quick fill
 * with both sticks, ending on the crash. Paused, the sticks rest.
 */
export function Drums({ species, still }: ActProps) {
  const root = useRef<SVGSVGElement>(null);
  const state = useRef({ rise: 0, tom: 0, tomHit: 0, crashHit: 0, beat: -1 });

  useCritterRig(
    root,
    (f) => {
      const { t, a, idle, bob, hit, rock, flourish, $ } = f;
      const s = state.current;
      const svg = root.current!;
      const { phase, index } = beatClock(f);
      const newBeat = index !== s.beat;
      s.beat = index;
      // the sticks swing from the elbow: up between beats, down onto the drum on each one
      const up = idle ? 0 : lift(phase);
      // snare hand: every beat, a harder backbeat on 2 and 4
      const back = index % 2 === 1 ? 1.25 : 1;
      bend($, 'arm-l', { turn: idle ? 1 + Math.sin(t * 1.1) : up * 30 * back, wrist: up * 14 });
      $('arm-l').setAttribute('transform', `rotate(${(idle ? 0 : up * 4).toFixed(2)} 138 268)`);
      // the other hand: the crash on the first beat of each bar (and on strong highs), the floor tom on the
      // rest. For the tom the forearm swings down and the wrist turns the stick onto the tom's head; the stick
      // strikes from the elbow either way
      const next = (index + 1) % 4;
      const onTom = !idle && !hit && next !== 0 ? 1 : 0;
      s.tom += (onTom - s.tom) * 0.18;
      if (newBeat && !idle) {
        if (index % 4 === 0 || hit) s.crashHit = 1;
        else s.tomHit = 1;
      }
      s.crashHit *= 0.9;
      s.tomHit *= 0.8;
      $('arm-r').setAttribute('transform', `rotate(${(idle ? Math.sin(t * 0.9) * 1.5 : 0).toFixed(2)} 262 268)`);
      const j = armJoint($, 'arm-r');
      let aim = 0;
      let to: [number, number] = [0, 0];
      if (j && s.tom > 0.01) {
        const h = [j.hx, j.hy] as const;
        const len = Math.hypot(CRASH_AT[0] - h[0], CRASH_AT[1] - h[1]);
        // the hand just up and left of the tom, so the stick reaches its head at a slant
        const want = [TOM_AT[0] - len * Math.cos(Math.PI / 5) - h[0], TOM_AT[1] - len * Math.sin(Math.PI / 5) - h[1]];
        to = [want[0] * s.tom, want[1] * s.tom];
        const [dx, dy, rot] = bend($, 'arm-r', { to });
        aim = wrap(angle([h[0] + dx, h[1] + dy], TOM_AT) - angle(h, CRASH_AT) - rot) * s.tom;
      }
      bend($, 'arm-r', { to, turn: idle ? 0 : -up * 30 + (hit ? rock * 6 : 0), wrist: aim - up * 14 });
      // flourish: a fast drum fill, both sticks alternating, ending on a crash
      if (flourish) {
        const fill = flourish < 0.75 ? Math.sin(t * 40) : 0;
        bend($, 'arm-l', { turn: 10 + fill * 26 });
        $('arm-r').setAttribute('transform', `rotate(${(flourish < 0.75 ? 0 : -16 * swell((flourish - 0.75) * 4)).toFixed(2)} 262 268)`);
        bend($, 'arm-r', { turn: flourish < 0.75 ? -fill * 26 : 0 });
        if (flourish > 0.75) s.crashHit = Math.max(s.crashHit, 1 - flourish);
      }
      // what the sticks land on shakes: the crash rocks and rings, the toms and snare dip, the kick thumps
      const ring = Math.sin(t * 38) * 9 * s.crashHit;
      $('crash').setAttribute('transform', `rotate(${(hit ? rock * 7 : ring + bob * 2).toFixed(2)} 344 236)`);
      $('tom').setAttribute('transform', `translate(300 314) scale(${(1 + s.tomHit * 0.05).toFixed(3)} ${(1 - s.tomHit * 0.08).toFixed(3)}) translate(-300 -314)`);
      $('snare').setAttribute('transform', `translate(0 ${(a.playing ? bob * 2.5 * back : 0).toFixed(2)})`);
      $('hihat').setAttribute('transform', `translate(0 ${(a.playing ? -(1 - bob) * 3 : 0).toFixed(2)})`);
      const k = 1 + (a.playing ? bob * 0.06 : 0);
      $('kick').setAttribute('transform', `translate(200 344) scale(${k.toFixed(3)}) translate(-200 -344)`);

      // the octopus's extra arms: the hi-hat on the off-beats, the floor tom between the other hand's hits
      if (species.id === 'octopus') {
        const off = idle ? 0 : lift((phase + 0.5) % 1);
        $('octo-hat').setAttribute('transform', `rotate(${(-off * 14 + (idle ? Math.sin(t) : 0)).toFixed(2)} 150 300)`);
        $('octo-tom').setAttribute('transform', `rotate(${(off * 12 + (flourish ? Math.sin(t * 40) * 10 : 0)).toFixed(2)} 250 300)`);
        if (!idle && phase > 0.45 && phase < 0.55) s.tomHit = Math.max(s.tomHit, 0.6);
      }
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
    <CritterFrame ref={root} kind="drums" species={species} label={`A ${species.noun} playing the drums under the sea`}>
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

      <Legs species={species} />

      <Body species={species}>
        <path d="M144 262 H256 M126 278 H274 M118 294 H282" className="tee-stripe" strokeWidth="6" />
        <path className="neckline" d="M184 246 L 200 266 L 216 246 Z" />
        <BodyOutfits />
      </Body>
      <Skirt species={species} style="pleated" trim="skirt-trim" />

      <Head species={species} />

      {/* the kit: hi-hat, snare, kick with a tom on it, floor tom, crash */}
      <Shadow cx={200} cy={392} rx={74} ry={7} />
      {[[44, 378, 22], [104, 368, 22], [300, 372, 38], [344, 378, 22]].map(([cx, cy, rx]) => <Shadow key={cx} cx={cx} cy={cy} rx={rx} ry={4} />)}
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
      <g data-part="tom">
        <rect className="drum-shell" x="268" y="314" width="64" height="38" rx="2" />
        <ellipse className="drum-head" cx="300" cy="314" rx="32" ry="8" />
      </g>
      <g data-part="crash">
        <ellipse className="cymbal" cx="344" cy="236" rx="42" ry="7" transform="rotate(-12 344 236)" />
        <circle className="cymbal-bell" cx="344" cy="235" r="5" />
      </g>

      {/* the octopus plays with four: two more tentacles with sticks, on the hi-hat and the floor tom */}
      {species.id === 'octopus' && (
        <>
          <g data-part="octo-hat">
            <path className="stick" d="M84 254 L 30 286" strokeWidth="4" strokeLinecap="round" />
            <path d={tube([152, 300], [104, 306], [84, 258], 15, 8)} className="bare ol-thin" />
            <path d="M84 258 q -8 -6 -4 -14 q 6 -4 10 2" fill="none" className="tentacle-tip" strokeWidth="7" strokeLinecap="round" />
            <circle cx="108" cy="300" r="2" className="sucker" />
          </g>
          <g data-part="octo-tom">
            <path className="stick" d="M334 270 L 292 312" strokeWidth="4" strokeLinecap="round" />
            <path d={tube([248, 300], [300, 312], [334, 272], 15, 8)} className="bare ol-thin" />
            <path d="M334 272 q 8 -6 4 -14 q -6 -4 -10 2" fill="none" className="tentacle-tip" strokeWidth="7" strokeLinecap="round" />
            <circle cx="302" cy="306" r="2" className="sucker" />
          </g>
        </>
      )}

      {/* fins with sticks: snare hand (left of picture), cymbal hand (right) */}
      <Arm part="arm-l" d="M138 268 Q 118 286 116 300" hand={[116, 302]}>
        {([x, y]) => <path className="stick" d={`M${x} ${y} L ${SNARE_AT[0]} ${SNARE_AT[1]}`} strokeWidth="4" strokeLinecap="round" />}
      </Arm>
      <Arm part="arm-r" d="M262 268 Q 282 278 294 264" hand={[296, 262]}>
        {([x, y]) => <path className="stick" d={`M${x} ${y} L ${CRASH_AT[0]} ${CRASH_AT[1]}`} strokeWidth="4" strokeLinecap="round" />}
      </Arm>
    </CritterFrame>
  );
}
