import { useRef } from 'react';
import { beatClock } from './arm';
import { swell, windUp } from './flourish';
import { playGuitar, newGuitarHands } from './guitar';
import { Arm, ArmHand, Body, BodyOutfits, CritterFrame, Glow, Head, Legs, Shadow, Skirt } from './parts';
import type { ActProps } from './species';
import { useCritterRig } from './rig';

/** The crater at the top of the volcano behind, on the right: centre of its lava pool. */
const CRATER: [number, number] = [318, 86];
/** Lava bombs thrown up out of the crater: how many can be in the air at once. */
const BOMBS = 7;
/** How hard the bombs fall back, units/s². */
const GRAVITY = 300;
/** Embers rising off the lava cracks: x, size, where in the climb each starts (0..1), speed. */
const EMBERS: [number, number, number, number][] = [
  [28, 2, 0, 1], [74, 1.6, 0.35, 1.3], [118, 2.2, 0.7, 0.9], [262, 1.8, 0.15, 1.2],
  [292, 2.4, 0.55, 1], [346, 1.6, 0.85, 1.4], [384, 2, 0.4, 0.8], [154, 1.4, 0.9, 1.1],
];
/** Lava flows down the volcano's flanks: the path, and how long it is (for the dashes that run down it). */
const FLOWS = [
  'M306 92 Q 290 140 304 188 Q 318 236 292 288 Q 280 316 288 344',
  'M332 92 Q 352 146 342 204 Q 334 258 364 300 Q 380 324 376 344',
];
/** Glowing cracks in the rock floor. */
const CRACKS = 'M0 362 L 40 356 L 64 368 L 104 360 M120 388 L 150 378 L 176 384 M244 382 L 270 374 L 300 386 L 330 378 M340 360 L 372 368 L 400 358';

const f1 = (n: number) => n.toFixed(1);

/**
 * On the volcano: the critter shreds a flame-shaped guitar on the black rock at the foot of an erupting volcano.
 * The crater spits lava bombs that arc up and fall on each beat, the lava running down the flanks pulses and
 * flows faster with the bass, cracks in the rock glow with it, embers drift up and an ash cloud hangs over the
 * crater. A smaller volcano smokes in the distance. The tank top's flames, the bandana and the guitar take the
 * skin's colours; the lava stays lava. Strums like the Rocker. Flourish: an eruption, every bomb at once and a
 * flash from the crater, with a windmill strum. Paused, the lava dims and nothing is thrown.
 */
export function Volcano({ species, still }: ActProps) {
  const root = useRef<SVGSVGElement>(null);
  const hands = useRef(newGuitarHands());
  const state = useRef({
    beat: 0,
    flow: 0,
    rise: 0,
    next: 0,
    bombs: Array.from({ length: BOMBS }, () => ({ t0: -9, vx: 0, vy: 0 })),
    erupted: false,
  });

  useCritterRig(
    root,
    (f) => {
      const { t, a, idle, bob, flourish, $ } = f;
      const s = state.current;
      const svg = root.current!;
      playGuitar(f, hands.current, 24, 1.3, 2);
      if (flourish) {
        $('arm-l').setAttribute('transform', `rotate(${f1(-360 * windUp(flourish))} 138 268)`);
        $('guitar').setAttribute('transform', `rotate(${f1(-10 * swell(flourish))} 200 320)`);
      }

      // lava bombs: one or two thrown on each beat (more when the band is loud), the lot on a flourish
      const { index } = beatClock(f);
      const onBeat = index !== s.beat;
      s.beat = index;
      const launch = () => {
        const b = s.bombs[s.next];
        s.next = (s.next + 1) % BOMBS;
        b.t0 = t;
        b.vx = -70 + Math.random() * 110;
        b.vy = 150 + Math.random() * 90 + (a.playing ? a.bass * 60 : 0);
      };
      if (a.playing && !idle && onBeat) {
        launch();
        if (a.bass > 0.55) launch();
      }
      if (flourish && !s.erupted) {
        for (let i = 0; i < BOMBS; i++) launch();
        s.erupted = true;
      }
      if (!flourish) s.erupted = false;
      svg.querySelectorAll<SVGElement>('[data-bomb]').forEach((el, i) => {
        const b = s.bombs[i];
        const age = t - b.t0;
        const y = CRATER[1] - b.vy * age + 0.5 * GRAVITY * age * age;
        if (age < 0 || y > 340) {
          el.style.opacity = '0';
          return;
        }
        el.style.opacity = '1';
        el.setAttribute('transform', `translate(${f1(CRATER[0] + b.vx * age)} ${f1(y)})`);
      });

      // the crater and the lava glow and flow with the bass, and flash on a flourish
      const heat = idle ? 0.35 : Math.min(1, 0.45 + (a.playing ? a.bass * 0.45 + bob * 0.25 : 0));
      const flash = swell(flourish);
      $('crater-glow').style.opacity = Math.min(1, heat * 0.8 + flash).toFixed(2);
      $('crater-flash').style.opacity = (flash * 0.85).toFixed(2);
      s.flow += (idle ? 4 : 14 + (a.playing ? a.bass * 40 : 0)) / 60;
      svg.querySelectorAll<SVGElement>('[data-flow]').forEach((el) => {
        el.style.strokeDashoffset = f1(-s.flow);
      });
      svg.querySelectorAll<SVGElement>('[data-lava]').forEach((el) => {
        el.style.opacity = heat.toFixed(2);
      });
      $('cracks').style.opacity = (idle ? 0.35 : 0.4 + (a.playing ? a.bass * 0.6 : 0)).toFixed(2);

      // the ash cloud drifts; embers rise faster with the bass
      $('ash').setAttribute('transform', `translate(${f1(Math.sin(t * 0.2) * 10)} 0)`);
      s.rise += (0.08 + (a.playing ? a.bass * 0.3 : 0)) / 60;
      svg.querySelectorAll<SVGElement>('[data-ember]').forEach((m, i) => {
        const [x, , start, speed] = EMBERS[i];
        const p = (s.rise * speed + start) % 1;
        m.setAttribute('cy', f1(370 - p * 320));
        m.setAttribute('cx', f1(x + Math.sin(t * 1.4 + i) * 6));
        m.style.opacity = (p < 0.75 ? 0.9 : (1 - p) * 3.6).toFixed(2);
      });
      // the far volcano's smoke puffs drift up
      svg.querySelectorAll<SVGElement>('[data-puff]').forEach((el, i) => {
        const p = (t * 0.06 + i / 3) % 1;
        el.setAttribute('transform', `translate(${f1(60 + p * 18)} ${f1(178 - p * 90)}) scale(${(0.6 + p * 0.9).toFixed(2)})`);
        el.style.opacity = ((1 - p) * 0.5).toFixed(2);
      });
    },
    { still, nod: 18 },
  );

  return (
    <CritterFrame ref={root} kind="volcano" species={species} label={`A ${species.noun} playing guitar in front of an erupting volcano`}>
      <defs>
        <linearGradient id="volcano-rock" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a2a2a" />
          <stop offset="1" stopColor="#1a1214" />
        </linearGradient>
        <radialGradient id="volcano-lava">
          <stop offset="0" stopColor="#fff2a8" />
          <stop offset="0.4" stopColor="#ffb02e" />
          <stop offset="1" stopColor="#e2401a" />
        </radialGradient>
      </defs>

      {/* the far volcano on the left, smoking */}
      <path className="volcano-far" d="M0 300 L 44 196 Q 60 184 76 196 L 140 300 Z" />
      {[0, 1, 2].map((i) => <circle key={i} data-puff="" className="smoke-puff" r="14" style={{ opacity: 0 }} />)}

      {/* the volcano behind, on the right: a glow over the crater, ash above, lava down its flanks */}
      <Glow id="glow-crater" color="#ff7a1a" data-part="crater-glow" className="crater-glow" cx={CRATER[0]} cy={CRATER[1]} r={60} />
      <g data-part="ash">
        <path className="ash" d="M250 46 Q 254 22 282 26 Q 296 6 324 16 Q 352 4 366 26 Q 394 28 392 50 Q 370 62 340 54 Q 318 66 296 56 Q 266 64 250 46 Z" />
      </g>
      <path className="volcano ol" d="M150 344 L 274 96 Q 296 80 318 84 Q 342 80 364 96 L 420 210 V344 Z" />
      <path d="M150 344 L 274 96 Q 296 80 318 84 Q 342 80 364 96 L 420 210 V344 Z" fill="url(#critter-vinyl)" />
      <ellipse className="lava-pool" cx={CRATER[0]} cy={CRATER[1] + 2} rx="38" ry="7" fill="url(#volcano-lava)" />
      <Glow id="glow-crater-flash" color="#ffd27a" data-part="crater-flash" className="crater-flash" cx={CRATER[0]} cy={CRATER[1] - 20} rx={70} ry={50} style={{ opacity: 0 }} />
      {FLOWS.map((d) => (
        <g key={d}>
          <path data-lava="" d={d} className="lava-flow" fill="none" strokeWidth="11" strokeLinecap="round" />
          <path data-flow="" d={d} className="lava-run" fill="none" strokeWidth="5" strokeLinecap="round" strokeDasharray="14 22" />
        </g>
      ))}

      {/* lava bombs in the air */}
      {Array.from({ length: BOMBS }, (_, i) => (
        <g key={i} data-bomb="" style={{ opacity: 0 }}>
          <circle r="7" className="bomb-trail" />
          <circle r="5" className="bomb ol-thin" />
        </g>
      ))}

      {/* the black rock floor with glowing cracks, a couple of boulders */}
      <rect x="0" y="340" width="400" height="60" fill="url(#volcano-rock)" />
      <path data-part="cracks" className="lava-crack" d={CRACKS} fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path className="boulder ol-thin" d="M8 344 Q 10 316 36 314 Q 62 316 64 344 Z" />
      <path className="boulder ol-thin" d="M346 344 Q 350 324 372 322 Q 394 326 396 344 Z" />
      {EMBERS.map(([x, r], i) => <circle key={i} data-ember="" className="ember" cx={x} cy="370" r={r} />)}

      <Shadow cx={200} cy={366} rx={66} />
      <Legs species={species} shoe="boot-black" />

      <Body species={species}>
        {/* a tank top with flames licking up from the hem */}
        <path className="tank-flame" d="M150 330 Q 156 304 166 316 Q 170 290 182 312 Q 190 284 200 310 Q 210 282 218 312 Q 230 290 234 316 Q 244 304 250 330 Z" />
        <path className="tank-flame-in" d="M164 330 Q 170 314 178 322 Q 186 304 196 322 Q 206 300 214 322 Q 224 310 236 330 Z" />
        <BodyOutfits />
      </Body>
      <Skirt species={species} style="tutu" className="skirt-tutu" />

      <Head
        species={species}
        hat={
          <g className="own-hat">
            {/* a bandana tied round the head, the knot's tails flying out on the right */}
            <path className="bandana ol" d="M124 140 Q 200 108 276 140 L 274 124 Q 200 92 126 124 Z" />
            <path className="bandana ol-thin" d="M272 128 Q 292 124 300 138 Q 288 140 280 136 Q 290 152 284 160 Q 274 148 270 136 Z" />
            {[150, 176, 202, 228, 254].map((x) => <circle key={x} cx={x} cy={x === 202 ? 116 : 120 + Math.abs(x - 202) * 0.06} r="2.6" fill="rgb(255 255 255 / 0.7)" />)}
          </g>
        }
      />

      <Arm part="arm-r" d="M262 268 Q 258 312 296 266" hand={[296, 266]} handLater />

      {/* the guitar: a body shaped like flames, neck up to the right */}
      <g data-part="guitar">
        <g transform="translate(178 318) rotate(-24)">
          <rect className="fretboard" x="36" y="-6" width="136" height="12" rx="1" />
          {[64, 88, 110, 130, 148, 164].map((x) => <path key={x} d={`M${x} -6 V6`} stroke="#9a9aa4" strokeWidth="1" />)}
          <path className="fretboard" d="M170 -8 L 204 -16 Q 196 0 206 12 L 170 8 Z" />
          <path className="axe ol-thin" d="M44 -10 Q 20 -30 -10 -24 Q -20 -44 -44 -40 Q -34 -30 -40 -20 Q -66 -26 -70 -6 Q -58 -8 -56 2 Q -70 12 -62 30 Q -48 20 -36 28 Q -40 42 -20 44 Q -18 30 0 28 Q 24 30 44 10 Z" />
          <path className="axe-flame" d="M30 -6 Q 8 -20 -14 -12 Q -24 -26 -36 -24 Q -34 -12 -46 -6 Q -40 4 -48 14 Q -32 12 -22 20 Q -12 12 2 16 Q 18 16 30 6 Z" />
          <rect x="6" y="-9" width="8" height="18" rx="2" fill="#16161a" />
          <rect x="22" y="-9" width="8" height="18" rx="2" fill="#16161a" />
          <g data-part="strings">
            {[-4, -1.3, 1.3, 4].map((y) => <path key={y} d={`M-6 ${y} H200`} stroke="#eef" strokeWidth="0.9" />)}
          </g>
        </g>
      </g>

      <Arm part="arm-l" d="M138 268 Q 146 302 178 314" hand={[180, 314]} />
      <ArmHand part="arm-r" d="M262 268 Q 258 312 296 266" hand={[296, 266]} />
    </CritterFrame>
  );
}
