import { useRef } from 'react';
import { beatClock, bend, lift } from './arm';
import { swell, windUp } from './flourish';
import { Arm, Body, BodyOutfits, CritterFrame, Head, Legs, Shadow, Skirt } from './parts';
import type { ActProps } from './species';
import { useCritterRig } from './rig';

/** Where each stick's tip lands on the drum's head: left of centre for the left hand, right for the right. */
const HIT_L: [number, number] = [178, 334];
const HIT_R: [number, number] = [222, 334];
/** The drum: centre of its head, and the head's half-width and half-height. */
const DRUM: [number, number] = [200, 336];
const HEAD: [number, number] = [72, 16];
/** Blossom petals drifting down: x, where in the fall each starts (0..1), speed, size. */
const PETALS: [number, number, number, number][] = [
  [262, 0, 1, 5], [300, 0.3, 0.8, 4], [340, 0.6, 1.2, 5], [376, 0.15, 0.9, 4], [230, 0.75, 1.1, 4],
  [318, 0.45, 0.7, 5], [358, 0.9, 1, 4], [196, 0.5, 0.85, 4],
];
/** Paper lanterns on the string across the top left: x, y. */
const LANTERNS: [number, number][] = [[30, 70], [86, 88], [142, 80]];
/** Blossom clusters on the branch: x, y, size. */
const BLOSSOM: [number, number, number][] = [
  [396, 40, 26], [360, 26, 20], [330, 58, 18], [300, 30, 16], [372, 84, 18], [276, 66, 14], [252, 40, 12], [404, 110, 16],
];

const f1 = (n: number) => n.toFixed(1);

/**
 * Taiko under the cherry blossom: the critter beats a big barrel drum on a stand in a temple garden at dusk, in
 * a happi coat and a headband tied at the side with its tails flying. Paper lanterns hang on a string, a torii
 * gate stands in the distance and petals drift down from a blossoming branch. The coat, the lanterns and the
 * drum's crest take the skin's colours; the garden and the drum are fixed. The left stick strikes on every beat
 * and the right on the off-beats, and on the last beat of each bar both arms swing up high and come down
 * together on the one. The head gives under each hit, the lanterns glow with the bass and the petals fall
 * faster the louder it gets. Flourish: a fast roll with both sticks, then both thrown up overhead. Paused, the
 * sticks rest on the head.
 */
export function Taiko({ species, still }: ActProps) {
  const root = useRef<SVGSVGElement>(null);
  const state = useRef({ fall: 0, dip: 0, beat: -1, half: -1 });

  useCritterRig(
    root,
    (f) => {
      const { t, a, idle, bob, flourish, $ } = f;
      const s = state.current;
      const svg = root.current!;
      const { phase, index } = beatClock(f);
      // the left stick lifts between beats and strikes on each; the right half a beat behind, on the off-beats
      const upL = idle ? 0 : lift(phase);
      const upR = idle ? 0 : lift((phase + 0.5) % 1);
      // the last beat of the bar: both arms swing up high from the shoulder, and come down together on the one
      const big = idle ? 0 : index % 4 === 3 ? Math.sin(Math.PI * phase) ** 0.6 : 0;
      const roll = flourish && flourish < 0.7 ? Math.sin(t * 44) : 0;
      const throwUp = flourish > 0.7 ? swell((flourish - 0.7) / 0.3) : 0;
      const armUp = Math.max(big, throwUp);
      $('arm-l').setAttribute('transform', `rotate(${f1(-armUp * 105 - upL * 55 * (1 - armUp) + (idle ? Math.sin(t * 0.9) * 1.2 : 0))} 138 268)`);
      $('arm-r').setAttribute('transform', `rotate(${f1(armUp * 105 + upR * 55 * (1 - armUp) - (idle ? Math.sin(t * 0.9) * 1.2 : 0))} 262 268)`);
      bend($, 'arm-l', { turn: flourish && !throwUp ? -14 - roll * 18 : -upL * 40 * (1 - big) - big * 30, wrist: -upL * 20 - big * 20 - throwUp * 20 });
      bend($, 'arm-r', { turn: flourish && !throwUp ? 14 + roll * 18 : upR * 40 * (1 - big) + big * 30, wrist: upR * 20 + big * 20 + throwUp * 20 });

      // the head gives under each strike, a big one on the one
      if (!idle && index !== s.beat) s.dip = index % 4 === 0 ? 1.6 : 1;
      if (!idle && (phase >= 0.5 ? index : -1) !== s.half && phase >= 0.5) s.dip = Math.max(s.dip, 0.7);
      s.beat = index;
      s.half = phase >= 0.5 ? index : -1;
      if (roll) s.dip = Math.max(s.dip, 0.5 + Math.abs(roll) * 0.4);
      s.dip *= 0.82;
      $('drum-head').setAttribute('transform', `translate(${DRUM[0]} ${DRUM[1]}) scale(${(1 - s.dip * 0.015).toFixed(3)} ${(1 - s.dip * 0.12).toFixed(3)}) translate(${-DRUM[0]} ${-DRUM[1]})`);
      $('drum').setAttribute('transform', `translate(0 ${f1(a.playing ? s.dip * 1.4 : 0)})`);

      // lanterns swing on their string and glow with the bass (data-glow); petals fall, faster with the band
      svg.querySelectorAll<SVGElement>('[data-lantern]').forEach((l, i) => {
        const [x, y] = LANTERNS[i];
        l.setAttribute('transform', `rotate(${f1(Math.sin(t * 1.1 + i * 1.7) * (3 + (a.playing ? bob * 3 : 0)))} ${x} ${y - 16})`);
      });
      s.fall += (0.06 + (a.playing ? (a.mid + a.bass) * 0.12 : 0) + (flourish ? 0.2 : 0)) / 60;
      svg.querySelectorAll<SVGElement>('[data-petal]').forEach((p, i) => {
        const [x, start, speed] = PETALS[i];
        const u = (s.fall * speed + start) % 1;
        p.setAttribute('transform', `translate(${f1(x - u * 140 + Math.sin(t * 1.6 + i * 2) * 10)} ${f1(40 + u * 330)}) rotate(${f1(t * 90 * speed + i * 40)})`);
        p.style.opacity = (u > 0.85 ? (1 - u) / 0.15 : 0.9).toFixed(2);
      });
      $('branch').setAttribute('transform', `rotate(${f1(Math.sin(t * 0.7) * 1.2 + (a.playing ? bob * 0.8 : 0))} 420 0)`);
      // the headband's tails fly out with the swing of the head
      $('band-tails').setAttribute('transform', `rotate(${f1(Math.sin(t * 6) * 6 + (a.playing ? bob * 10 : 0) - windUp(flourish) * 12)} 258 132)`);
    },
    { still, nod: 12 },
  );

  return (
    <CritterFrame ref={root} kind="taiko" species={species} label={`A ${species.noun} playing a taiko drum under a cherry tree`}>
      {/* the garden: a torii gate far off, the ground, a string of paper lanterns and a blossoming branch */}
      <g className="torii">
        <rect x="62" y="226" width="7" height="74" />
        <rect x="111" y="226" width="7" height="74" />
        <path d="M46 222 Q 90 216 134 222 L 136 214 Q 90 206 44 214 Z" />
        <rect x="54" y="232" width="72" height="5" />
        <rect x="87" y="222" width="6" height="12" />
      </g>
      <rect className="garden-ground" x="0" y="298" width="400" height="102" />
      <path className="garden-stones" d="M20 330 q 14 -4 28 0 M330 322 q 18 -5 36 0 M60 372 q 16 -5 32 0 M300 380 q 20 -6 40 0" fill="none" strokeWidth="2.5" strokeLinecap="round" />
      <path className="lantern-string" d="M-6 46 Q 86 82 176 58" fill="none" strokeWidth="1.5" />
      {LANTERNS.map(([x, y], i) => (
        <g key={x} data-lantern="">
          <path className="lantern-string" d={`M${x} ${y - 24} V${y - 16}`} strokeWidth="1.5" />
          <ellipse data-glow="" className="lantern-glow" cx={x} cy={y} rx="20" ry="22" filter="url(#critter-blur)" />
          <rect className="lantern-cap" x={x - 7} y={y - 18} width="14" height="5" rx="1.5" />
          <ellipse className={`lantern ol-thin${i % 2 ? ' lantern-2' : ''}`} cx={x} cy={y} rx="13" ry="15" />
          <path d={`M${x - 12} ${y - 5} H${x + 12} M${x - 13} ${y} H${x + 13} M${x - 12} ${y + 5} H${x + 12}`} stroke="rgb(0 0 0 / 0.18)" strokeWidth="1.2" />
          <rect className="lantern-cap" x={x - 7} y={y + 13} width="14" height="5" rx="1.5" />
        </g>
      ))}
      <g data-part="branch">
        <path className="branch" d="M420 -6 Q 370 20 330 52 Q 300 76 270 70 M370 22 Q 360 60 380 92 M330 52 Q 300 34 254 42" fill="none" strokeWidth="7" strokeLinecap="round" />
        {BLOSSOM.map(([x, y, r]) => (
          <g key={`${x},${y}`}>
            <circle className="blossom" cx={x} cy={y} r={r} />
            <circle className="blossom-2" cx={x - r * 0.35} cy={y - r * 0.3} r={r * 0.55} />
            <circle className="blossom-eye" cx={x + r * 0.2} cy={y + r * 0.1} r={r * 0.14} />
          </g>
        ))}
      </g>

      <Shadow cx={200} cy={396} rx={100} ry={6} />
      <Legs species={species} shoe="tabi" />

      <Body species={species}>
        {/* a happi coat: a white collar band down the front, crossing left over right, and a hem stripe */}
        <path className="happi-band" d="M178 238 L 214 400 M222 238 L 196 330" fill="none" strokeWidth="12" />
        <path className="happi-hem" d="M90 352 H310" strokeWidth="8" />
        <BodyOutfits />
      </Body>
      <Skirt species={species} style="pleated" className="hakama" />

      <Head
        species={species}
        hat={
          <g data-part="adjust" className="own-hat">
            {/* a headband, knotted at the side with its tails flying */}
            <g data-part="band-tails">
              <path className="headband ol-thin" d="M256 126 Q 278 128 290 144 L 282 150 Q 272 138 256 136 Z M256 130 Q 282 146 284 168 L 274 168 Q 272 150 254 138 Z" />
            </g>
            <path className="headband ol-thin" d="M138 128 Q 200 108 262 128 L 262 142 Q 200 124 138 142 Z" />
            <path className="headband-stripe" d="M140 135 Q 200 116 260 135" fill="none" strokeWidth="3" />
            <circle className="headband ol-thin" cx="258" cy="134" r="6" />
          </g>
        }
      />

      {/* the drum on its stand: a barrel with a studded rim and a crest, the head tipped up to the player */}
      <g className="taiko-stand">
        <path d="M130 398 L 170 352 M270 398 L 230 352" fill="none" strokeWidth="9" strokeLinecap="round" />
      </g>
      <g data-part="drum">
        <path className="taiko-shell ol" d={`M${DRUM[0] - HEAD[0]} ${DRUM[1]} Q ${DRUM[0] - HEAD[0] - 12} 368 ${DRUM[0] - HEAD[0] + 6} 396 Q 200 410 ${DRUM[0] + HEAD[0] - 6} 396 Q ${DRUM[0] + HEAD[0] + 12} 368 ${DRUM[0] + HEAD[0]} ${DRUM[1]} Z`} />
        <path d={`M${DRUM[0] - HEAD[0]} ${DRUM[1]} Q ${DRUM[0] - HEAD[0] - 12} 368 ${DRUM[0] - HEAD[0] + 6} 396 Q 200 410 ${DRUM[0] + HEAD[0] - 6} 396 Q ${DRUM[0] + HEAD[0] + 12} 368 ${DRUM[0] + HEAD[0]} ${DRUM[1]} Z`} fill="url(#critter-vinyl)" />
        <path className="taiko-stave" d="M158 350 Q 154 374 162 400 M242 350 Q 246 374 238 400" fill="none" strokeWidth="2" />
        {/* the crest: three commas swirling in a ring */}
        <circle className="taiko-crest-ring" cx="200" cy="374" r="16" fill="none" strokeWidth="4" />
        {[0, 120, 240].map((r) => (
          <path key={r} className="taiko-crest" d="M200 374 m 0 -10 a 6 6 0 1 1 -1.5 12 q 6 -4.5 1.5 -12 Z" transform={`rotate(${r} 200 374)`} />
        ))}
        <circle className="taiko-ring ol-thin" cx="134" cy="372" r="6" fill="none" strokeWidth="3" />
        <circle className="taiko-ring ol-thin" cx="266" cy="372" r="6" fill="none" strokeWidth="3" />
        <g data-part="drum-head">
          <ellipse className="taiko-rim ol-thin" cx={DRUM[0]} cy={DRUM[1]} rx={HEAD[0] + 4} ry={HEAD[1] + 4} />
          <ellipse className="taiko-head" cx={DRUM[0]} cy={DRUM[1]} rx={HEAD[0] - 4} ry={HEAD[1] - 3} />
          {Array.from({ length: 18 }, (_, i) => {
            const u = (i / 18) * Math.PI * 2;
            return <circle key={i} className="taiko-stud" cx={f1(DRUM[0] + Math.cos(u) * (HEAD[0] + 1))} cy={f1(DRUM[1] + Math.sin(u) * (HEAD[1] + 1))} r="1.8" />;
          })}
        </g>
      </g>

      {/* the sticks: each lands on its side of the head */}
      <Arm part="arm-l" d="M138 268 Q 124 300 158 300" hand={[160, 298]}>
        {([x, y]) => {
          const d = `M${x - 10} ${y - 10} L ${HIT_L[0]} ${HIT_L[1]}`;
          return (
            <>
              <path className="limb-outline" d={d} strokeWidth="9" strokeLinecap="round" />
              <path className="bachi" d={d} strokeWidth="6" strokeLinecap="round" />
            </>
          );
        }}
      </Arm>
      <Arm part="arm-r" d="M262 268 Q 276 300 242 300" hand={[240, 298]}>
        {([x, y]) => {
          const d = `M${x + 10} ${y - 10} L ${HIT_R[0]} ${HIT_R[1]}`;
          return (
            <>
              <path className="limb-outline" d={d} strokeWidth="9" strokeLinecap="round" />
              <path className="bachi" d={d} strokeWidth="6" strokeLinecap="round" />
            </>
          );
        }}
      </Arm>

      {/* petals drifting down in front */}
      {PETALS.map(([x, , , r], i) => (
        <path key={i} data-petal="" className="petal" transform={`translate(${x} 40)`} d={`M0 ${-r} Q ${r} 0 0 ${r} Q ${-r} 0 0 ${-r} Z`} />
      ))}
    </CritterFrame>
  );
}
