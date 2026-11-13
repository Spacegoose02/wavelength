import { useRef } from 'react';
import { beatClock, bend } from './arm';
import { swell } from './flourish';
import { Arm, Body, BodyOutfits, CritterFrame, Head, Legs, Shadow, Skirt } from './parts';
import type { ActProps } from './species';
import { useCritterRig } from './rig';

/** The mirror ball: centre and radius. */
const BALL: [number, number, number] = [200, 46, 26];
/** The light-up floor: rows of tiles from the back (y, height) and how many tiles across. */
const ROWS: [number, number][] = [[300, 24], [324, 32], [356, 44]];
const ACROSS = 7;
/** Glints round the room off the mirror ball: x, y, size. */
const GLINTS: [number, number, number][] = [[40, 60, 5], [96, 120, 4], [330, 90, 5], [362, 160, 4], [60, 200, 4], [300, 30, 3], [130, 30, 3], [372, 236, 5], [24, 140, 3]];

const f1 = (n: number) => n.toFixed(1);

/** One floor tile, as a quad that widens towards the viewer: row `r`, column `c`. */
function tile(r: number, c: number) {
  const [y, h] = ROWS[r];
  // the floor spreads out from a vanishing point above the middle
  const spread = (yy: number) => 0.62 + ((yy - 300) / 100) * 0.62;
  const x = (yy: number, k: number) => 200 + (k / ACROSS - 0.5) * 400 * spread(yy) * 1.4;
  const y1 = y + h;
  return `M${f1(x(y, c))} ${y} L ${f1(x(y, c + 1))} ${y} L ${f1(x(y1, c + 1))} ${y1} L ${f1(x(y1, c))} ${y1} Z`;
}

/**
 * Disco night: the critter sings into a hand mic on a light-up dance floor under a spinning mirror ball, in a
 * shirt with a huge collar, a medallion and round tinted glasses (girls: a fringed skirt). The shirt, the
 * glasses and the floor take the skin's colours. The free hand does the disco point, up to the ceiling for two
 * beats then down across for two; the mic hand sways with the beat, held beside the face so the whole mouth
 * shows while they sing. The floor's tiles light up in a new pattern on every beat, the ball turns and throws
 * glints round the room, brighter with the highs. Flourish: the point held high while the whole floor lights up
 * and the ball flashes. Paused, the hands rest and the floor dims.
 */
export function Disco({ species, still }: ActProps) {
  const root = useRef<SVGSVGElement>(null);
  const state = useRef({ point: 0, spin: 0 });

  useCritterRig(
    root,
    (f) => {
      const { t, a, idle, bob, flourish, $ } = f;
      const s = state.current;
      const svg = root.current!;
      const { phase, index } = beatClock(f);
      const big = swell(flourish);

      // the disco point: up to the ceiling on beats 1 and 2, down across the body on 3 and 4
      const up = idle ? 0.5 : index % 4 < 2 ? 1 : 0;
      s.point += (Math.max(up, big) - s.point) * 0.22;
      $('arm-r').setAttribute('transform', `rotate(${f1(70 - s.point * 80 + (idle ? 0 : bob * 4))} 262 268)`);
      bend($, 'arm-r', { turn: (1 - s.point) * 40 - big * 10, wrist: idle ? 0 : Math.sin(Math.PI * (index + phase)) * 6 });
      // the mic hand sways with the beat beside the face
      const sway = idle ? Math.sin(t * 0.8) * 1.5 : Math.sin(Math.PI * (index + phase)) * 4;
      $('arm-l').setAttribute('transform', `rotate(${f1(sway * 0.4)} 138 268)`);
      bend($, 'arm-l', { turn: sway, wrist: -sway * 0.8 });

      // the floor lights a new pattern on every beat (all of it on a flourish); dim while paused
      svg.querySelectorAll<SVGElement>('[data-tile]').forEach((el) => {
        const [r, c] = el.dataset.tile!.split(',').map(Number);
        const on = idle ? 0.3 : big > 0.3 ? 1 : (r * 3 + c * 5 + index * 7) % 4 < 2 ? 0.95 : 0.25;
        el.style.opacity = on.toFixed(2);
      });
      // the ball turns (its facets slide round), and throws glints round the room, brighter with the highs
      s.spin = (s.spin + (idle ? 0.1 : 0.5 + a.treble) / 60) % 1;
      $('facets').setAttribute('transform', `translate(${f1(-s.spin * 12)} 0)`);
      svg.querySelectorAll<SVGElement>('[data-glint]').forEach((g, i) => {
        const tw = Math.abs(Math.sin(t * 2.4 + i * 1.7 + s.spin * 12));
        g.style.opacity = ((idle ? 0.2 : 0.35 + (a.playing ? a.treble * 0.5 : 0)) * tw + big * 0.6).toFixed(2);
        g.setAttribute('transform', `translate(${GLINTS[i][0]} ${GLINTS[i][1]}) rotate(${f1(t * 40 + i * 20)}) scale(${(0.8 + tw * 0.5 + big * 0.6).toFixed(2)})`);
      });
      $('ball-flash').style.opacity = Math.min(1, (a.playing ? bob * 0.4 : 0) + big).toFixed(2);
      svg.querySelectorAll<SVGElement>('[data-ray]').forEach((ray, i) => {
        ray.setAttribute('transform', `rotate(${f1(Math.sin(t * 0.5 + i * 2.1) * 18)} ${BALL[0]} ${BALL[1]})`);
        ray.style.opacity = (idle ? 0.06 : 0.1 + (a.playing ? a.mid * 0.16 : 0) + big * 0.2).toFixed(2);
      });
    },
    { still, nod: 10 },
  );

  return (
    <CritterFrame ref={root} kind="disco" species={species} label={`A ${species.noun} singing on a disco dance floor under a mirror ball`}>
      {/* coloured beams down from the ball */}
      {[['ray-a', -38], ['ray-b', 0], ['ray-c', 38]].map(([cls, k], i) => (
        <g key={i} data-ray="" style={{ opacity: 0.1 }}>
          <path className={cls as string} d={`M${BALL[0]} ${BALL[1]} L ${BALL[0] + (k as number) * 4 - 50} 310 L ${BALL[0] + (k as number) * 4 + 50} 310 Z`} />
        </g>
      ))}
      {/* the light-up floor */}
      <rect className="disco-floor" x="0" y="298" width="400" height="102" />
      {ROWS.map((_, r) =>
        Array.from({ length: ACROSS }, (_, c) => (
          <path key={`${r},${c}`} data-tile={`${r},${c}`} className={`disco-tile disco-tile-${(r + c) % 3}`} d={tile(r, c)} />
        )),
      )}
      {ROWS.map(([y]) => <path key={y} d={`M0 ${y} H400`} stroke="rgb(0 0 0 / 0.5)" strokeWidth="2" />)}

      {/* the mirror ball on its chain, with glints thrown round the room */}
      <path className="ball-chain" d={`M${BALL[0]} 0 V${BALL[1] - BALL[2]}`} strokeWidth="2" />
      <circle data-part="ball-flash" className="ball-flash" cx={BALL[0]} cy={BALL[1]} r={BALL[2] + 16} filter="url(#critter-blur)" style={{ opacity: 0 }} />
      <defs>
        <clipPath id="disco-ball">
          <circle cx={BALL[0]} cy={BALL[1]} r={BALL[2]} />
        </clipPath>
      </defs>
      <circle className="ball ol" cx={BALL[0]} cy={BALL[1]} r={BALL[2]} />
      <g clipPath="url(#disco-ball)">
        <g data-part="facets">
          {Array.from({ length: 7 }, (_, row) =>
            Array.from({ length: 9 }, (_, col) => {
              const x = BALL[0] - BALL[2] + col * 8 + (row % 2) * 4;
              const y = BALL[1] - BALL[2] + row * 8;
              return <rect key={`${row},${col}`} className={(row * 3 + col) % 4 ? 'facet' : 'facet facet-lit'} x={x} y={y} width="6.5" height="6.5" rx="1" />;
            }),
          )}
        </g>
        <circle cx={BALL[0]} cy={BALL[1]} r={BALL[2]} fill="url(#critter-vinyl)" />
      </g>
      {GLINTS.map(([x, y, r], i) => (
        <g key={i} data-glint="" transform={`translate(${x} ${y})`}>
          <path className="glint" d={`M0 ${-r * 2} L ${r * 0.4} ${-r * 0.4} L ${r * 2} 0 L ${r * 0.4} ${r * 0.4} L 0 ${r * 2} L ${-r * 0.4} ${r * 0.4} L ${-r * 2} 0 L ${-r * 0.4} ${-r * 0.4} Z`} />
        </g>
      ))}

      <Shadow cx={200} cy={386} rx={70} />
      <Legs species={species} shoe="platform" />

      <Body species={species}>
        {/* a shirt open at the neck with a huge pointed collar, and a medallion */}
        <path className="disco-neck" d="M178 240 L 200 300 L 222 240 Z" />
        <path className="disco-collar ol-thin" d="M178 240 L 150 252 L 132 300 L 190 276 Z M222 240 L 250 252 L 268 300 L 210 276 Z" />
        <path className="medallion-chain" d="M184 246 Q 200 286 216 246" fill="none" strokeWidth="2" />
        <circle className="medallion ol-thin" cx="200" cy="284" r="8" />
        <path d="M100 330 H300" stroke="rgb(0 0 0 / 0.12)" strokeWidth="2" />
        <BodyOutfits />
      </Body>
      <Skirt species={species} style="fringe" className="disco-skirt" />

      <Head
        species={species}
        eyewear={
          <g className="own-eyewear">
            {/* big round tinted glasses on a gold rim */}
            <circle className="disco-lens" cx="166" cy="168" r="23" />
            <circle className="disco-lens" cx="234" cy="168" r="23" />
            <circle className="disco-rim" cx="166" cy="168" r="23" fill="none" strokeWidth="3" />
            <circle className="disco-rim" cx="234" cy="168" r="23" fill="none" strokeWidth="3" />
            <path className="disco-rim" d="M189 164 Q 200 156 211 164" fill="none" strokeWidth="3" />
            <path d="M152 158 Q 158 150 168 150 M220 158 Q 226 150 236 150" fill="none" stroke="rgb(255 255 255 / 0.55)" strokeWidth="3" strokeLinecap="round" />
          </g>
        }
      />

      {/* a hand mic beside the face, and the free hand pointing */}
      <Arm part="arm-l" d="M138 268 Q 112 280 140 248" hand={[142, 246]}>
        {([x, y]) => (
          <g>
            <path className="mic-body ol-thin" d={`M${x - 4} ${y + 8} L ${x - 5} ${y - 16} H${x + 5} L ${x + 4} ${y + 8} Z`} />
            <circle className="mic-grille ol-thin" cx={x} cy={y - 22} r="9" />
            <path d={`M${x - 7} ${y - 25} H${x + 7} M${x - 8} ${y - 21} H${x + 8} M${x - 7} ${y - 17} H${x + 7}`} stroke="#6e6e78" strokeWidth="1.1" />
          </g>
        )}
      </Arm>
      <Arm part="arm-r" d="M262 268 Q 300 262 316 232" hand={[318, 228]}>
        <path className="point-finger" d="M318 228 L 328 210" strokeWidth="7" strokeLinecap="round" />
      </Arm>
    </CritterFrame>
  );
}
