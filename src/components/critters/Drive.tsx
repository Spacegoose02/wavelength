import { useRef } from 'react';
import { armJoint, beatClock, bend } from './arm';
import { swell, windUp } from './flourish';
import { Arm, ArmHand, Body, BodyOutfits, CritterFrame, Head } from './parts';
import type { ActProps } from './species';
import { useCritterRig } from './rig';

/** Where the road meets the sky. */
const HORIZON = 196;
/** The steering wheel: centre, and the ring's half-width and half-height (seen from the front, a flat ellipse). */
const WHEEL: [number, number] = [200, 300];
const WHEEL_R: [number, number] = [36, 20];
/** Where the steering hand grips the rim, as the act draws it. */
const GRIP: [number, number] = [166, 298];
/** Centre-line dashes and roadside posts in flight down the road. */
const DASHES = 7;
const POSTS = 5;
/** How far the driver (and the wheel) sit up above the car's own drawing. */
const LIFT = 18;

const f1 = (n: number) => n.toFixed(1);

/** Down the road: 0 at the horizon, 1 at the bottom of the picture. Perspective bunches the far end up. */
const depthY = (u: number) => HORIZON + (400 - HORIZON) * u * u;
/** The road at screen height y, for a bend whose far end is pushed `curve` px sideways: centre and half-width. */
function roadAt(y: number, curve: number): [number, number] {
  const s = (y - HORIZON) / (400 - HORIZON);
  return [200 + curve * (1 - s) ** 2, 8 + 252 * s];
}

/** The road's outline (verges to the vanishing point) for a bend of `curve`. */
function roadPath(curve: number) {
  const ys = [HORIZON, 220, 250, 290, 340, 400];
  const l = ys.map((y) => roadAt(y, curve)).map(([c, w], i) => `${f1(c - w)} ${ys[i]}`);
  const r = ys.map((y) => roadAt(y, curve)).map(([c, w], i) => `${f1(c + w)} ${ys[i]}`).reverse();
  return `M${l.join(' L')} L${r.join(' L')} Z`;
}

/** The white lines along both edges of the road. */
function edgePath(curve: number) {
  const ys = [HORIZON, 220, 250, 290, 340, 400];
  const side = (k: number) => ys.map((y) => roadAt(y, curve)).map(([c, w], i) => `${f1(c + k * w * 0.94)} ${ys[i]}`);
  return `M${side(-1).join(' L')} M${side(1).join(' L')}`;
}

/** One centre-line dash from depth u0 to u1, as a quad that widens towards the viewer. */
function dashPath(u0: number, u1: number, curve: number) {
  const pts = [u0, u1].map((u) => {
    const y = depthY(u);
    const [c, w] = roadAt(y, curve);
    return [c, y, Math.max(0.6, w * 0.022)] as const;
  });
  const [[c0, y0, w0], [c1, y1, w1]] = pts;
  return `M${f1(c0 - w0)} ${f1(y0)} L${f1(c0 + w0)} ${f1(y0)} L${f1(c1 + w1)} ${f1(y1)} L${f1(c1 - w1)} ${f1(y1)} Z`;
}

/**
 * Out for a drive: the critter at the wheel of a little open-top car, coming down a long road at sunset
 * towards you. A flat driving cap and a scarf that flaps in the wind; the car, the road and the lights take
 * the skin's colours. The car swerves from side to side in time (one way every two beats), the wheel turning
 * with it under the steering hand, and bounces on its springs with the bass; the free hand changes move every
 * bar (tapping the wheel, waving out of the car, raising the roof, drumming the door). The road rushes by faster
 * as the band gets louder, and the headlights pulse on the beat. Flourish: the car hops off the road, hand in
 * the air. Paused, the car idles at the roadside, ticking over, and the driver straightens the cap.
 */
export function Drive({ species, still }: ActProps) {
  const root = useRef<SVGSVGElement>(null);
  const state = useRef({ go: 0, last: 0, sway: 0, turn: 0, shoulder: 0, hand: 0, down: 1 });

  useCritterRig(
    root,
    (f) => {
      const { t, a, idle, bob, flourish, $ } = f;
      const s = state.current;
      const svg = root.current!;
      const { phase, index } = beatClock(f);
      const beats = index + phase;
      s.down += ((idle ? 1 : 0) - s.down) * 0.06;
      const moving = 1 - s.down;

      // down the road: faster when the band is loud, stopped when paused
      const speed = (a.live ? 0.35 + a.bass * 0.5 + a.mid * 0.3 : 0.55) * moving;
      s.go = (s.go + speed * Math.min(0.1, t - s.last)) % 1;
      s.last = t;
      // the road bends slowly one way, then the other
      const curve = Math.sin(t * 0.23) * 90 * moving;
      $('road').setAttribute('d', roadPath(curve));
      $('road-edge').setAttribute('d', edgePath(curve));
      svg.querySelectorAll<SVGElement>('[data-dash]').forEach((el, i) => {
        const u = (i / DASHES + s.go) % 1;
        el.setAttribute('d', dashPath(u, Math.min(1.05, u + 0.055), curve));
      });
      svg.querySelectorAll<SVGElement>('[data-post]').forEach((el, i) => {
        const side = i % 2 ? 1 : -1;
        const u = ((Math.floor(i / 2) + (i % 2) * 0.5) / POSTS + s.go) % 1;
        const y = depthY(u);
        const [c, w] = roadAt(y, curve);
        const k = 0.08 + u * u * 1.2;
        el.setAttribute('transform', `translate(${f1(c + side * w * 1.18)} ${f1(y)}) scale(${k.toFixed(3)})`);
        el.style.opacity = Math.min(1, u * 5).toFixed(2);
      });
      // the hills drift a little against the bend
      $('hills').setAttribute('transform', `translate(${f1(-curve * 0.15)} 0)`);

      // the swerve: one way every two beats, leaning into it, the wheel turned the way it's going
      const swing = Math.sin((Math.PI * beats) / 2);
      const lean = Math.cos((Math.PI * beats) / 2);
      const want = idle ? 0 : a.live ? swing : Math.sin(t * 1.6);
      s.sway += (want - s.sway) * 0.2;
      const dir = idle ? 0 : a.live ? lean : Math.cos(t * 1.6);
      s.turn += (dir - s.turn) * 0.2;
      const x = s.sway * 16 - curve * 0.05;
      const hop = swell(flourish);
      // bounce on the springs with the beat (the body rides higher than the wheels); a shiver while idling
      const spring = a.playing ? bob * 5 + a.bass * 2 : Math.sin(t * 38) * 0.6;
      const up = 26 * hop * hop;
      $('car').setAttribute('transform', `translate(${f1(x)} ${f1(-up)}) rotate(${(s.turn * 2.5 + hop * -4).toFixed(2)} 200 380)`);
      $('ride').setAttribute('transform', `translate(0 ${f1(spring)}) rotate(${(-s.turn * 1.5).toFixed(2)} 200 340)`);
      $('car-shadow').setAttribute('transform', `translate(${f1(200 + x)} 0) scale(${(1 - hop * 0.25).toFixed(3)} 1) translate(-200 0)`);
      $('car-shadow').style.opacity = (1 - hop * 0.5).toFixed(2);

      // the wheel turns with the swerve, the steering hand going round with it
      const wheelDeg = s.turn * 24 + (idle ? 0 : Math.sin(t * 5.3) * 2);
      $('wheel').setAttribute('transform', `rotate(${wheelDeg.toFixed(2)} ${WHEEL[0]} ${WHEEL[1]})`);
      const j = armJoint($, 'arm-l');
      if (j) {
        const r = (wheelDeg * Math.PI) / 180;
        const dx = j.hx - WHEEL[0];
        const dy = j.hy - WHEEL[1];
        bend($, 'arm-l', { to: [dx * Math.cos(r) - dy * Math.sin(r) - dx, dx * Math.sin(r) + dy * Math.cos(r) - dy], wrist: wheelDeg * 0.5 });
      }

      // the free hand changes move every bar: taps the wheel on the beat, waves out of the car over two beats,
      // raises the roof (pushing up on the beat), drums the door on the off-beats
      const move = Math.floor(index / 4) % 4;
      const [shoulder, turn] = idle
        ? [0, 0]
        : move === 0
          ? [0, -bob * 22]
          : move === 1
            ? [-58, Math.sin(Math.PI * beats) * 30 - 10]
            : move === 2
              ? [-74, -10 - bob * 26]
              : [18, Math.abs(Math.sin(Math.PI * beats * 2)) * -26];
      s.shoulder += (shoulder - s.shoulder) * 0.15;
      s.hand += (turn - s.hand) * 0.35;
      $('arm-r').setAttribute('transform', `rotate(${(s.shoulder - hop * 90 + s.down * 6).toFixed(2)} 262 268)`);
      bend($, 'arm-r', { turn: s.hand * (1 - hop) - hop * 30, wrist: idle ? 0 : s.hand * 0.4 });

      // the scarf streams out behind in the wind, flapping faster the faster the car goes
      const flap = (k: number) => Math.sin(t * (4 + speed * 14) - k) * (2 + 8 * moving) * k;
      $('scarf-tail').setAttribute(
        'd',
        `M214 0 C ${f1(236 + 4 * moving)} ${f1(-4 + flap(0.6))} ${f1(250 + 10 * moving)} ${f1(10 + flap(1.2) - 8 * moving)} ${f1(262 + 22 * moving)} ${f1(4 + flap(1.8) - 14 * moving)} L ${f1(266 + 22 * moving)} ${f1(16 + flap(2) - 14 * moving)} C ${f1(250 + 10 * moving)} ${f1(24 + flap(1.3) - 8 * moving)} ${f1(234 + 4 * moving)} ${f1(12 + flap(0.7))} 212 12 Z`,
      );
      // the cap's tipped up off the head on the flourish's woo-hoo
      if (flourish) $('adjust').setAttribute('transform', `translate(0 ${f1(-14 * hop)}) rotate(${(-10 * windUp(flourish) * (1 - flourish)).toFixed(2)} 200 112)`);
    },
    { still, nod: 10 },
  );

  const neck = species.figure.chin[0] + 6;
  return (
    <CritterFrame ref={root} kind="drive" species={species} label={`A ${species.noun} driving a little open-top car down the road, singing`}>
      {/* sky, the sun going down, hills, verges, the road with its centre line and roadside posts */}
      <rect className="drive-sky" x="0" y="0" width="400" height={HORIZON + 2} />
      <g className="drive-sun">
        <circle cx="338" cy={HORIZON - 40} r="40" />
      </g>
      {[HORIZON - 22, HORIZON - 12, HORIZON - 4].map((y, i) => (
        <rect key={y} className="drive-sky-band" x="290" y={y} width="100" height={3 + i} />
      ))}
      <g data-part="hills">
        <path className="hill-far" d={`M-40 ${HORIZON} Q 30 ${HORIZON - 54} 96 ${HORIZON - 18} Q 150 ${HORIZON - 44} 210 ${HORIZON - 8} Q 300 ${HORIZON - 30} 440 ${HORIZON} Z`} />
        <path className="hill-near" d={`M-40 ${HORIZON + 2} Q 60 ${HORIZON - 26} 130 ${HORIZON - 2} Q 300 ${HORIZON - 34} 440 ${HORIZON + 2} Z`} />
      </g>
      <rect className="verge" x="0" y={HORIZON} width="400" height={400 - HORIZON} />
      <path data-part="road" className="road" d={roadPath(0)} />
      <path data-part="road-edge" className="road-edge" d={edgePath(0)} fill="none" strokeWidth="3" />
      {Array.from({ length: DASHES }, (_, i) => (
        <path key={i} data-dash="" className="road-line" d={dashPath(i / DASHES, i / DASHES + 0.055, 0)} />
      ))}
      {Array.from({ length: POSTS * 2 }, (_, i) => (
        <g key={i} data-post="" transform={`translate(${i % 2 ? 360 : 40} ${HORIZON + 40})`}>
          <rect className="post" x="-5" y="-60" width="10" height="60" rx="2" />
          <rect className="post-light" x="-4" y="-54" width="8" height="12" rx="2" />
        </g>
      ))}

      <ellipse data-part="car-shadow" className="contact-shadow" cx="200" cy="392" rx="150" ry="9" filter="url(#critter-soft)" />
      <g data-part="car">
        {/* tyres, under the body */}
        {[92, 308].map((cx) => (
          <g key={cx}>
            <rect className="tyre" x={cx - 22} y="344" width="44" height="50" rx="12" />
            <path d={`M${cx - 14} 356 H${cx + 14} M${cx - 14} 368 H${cx + 14} M${cx - 14} 380 H${cx + 14}`} stroke="rgb(255 255 255 / 0.08)" strokeWidth="3" />
          </g>
        ))}
        <g data-part="ride">
          {/* the tub of the car behind the driver */}
          <path className="car-tub ol" d="M62 312 Q 60 276 96 270 H304 Q 340 276 338 312 Z" />
          {/* the driver sits up high in the seat, so the wheel and the bonnet hide only the lap */}
          <g transform={`translate(0 ${-LIFT})`}>
          <path className="seat ol" d="M150 300 V 238 Q 150 214 176 214 H224 Q 250 214 250 238 V300 Z" />
          <path d="M162 232 Q 200 222 238 232" fill="none" stroke="rgb(255 255 255 / 0.18)" strokeWidth="4" strokeLinecap="round" />

          <Body species={species}>
            {/* a white racing tee: two stripes across the chest */}
            <rect className="tee-print" x="100" y="282" width="200" height="7" />
            <rect className="tee-print" x="100" y="294" width="200" height="4" />
            <BodyOutfits />
          </Body>
          {/* the scarf: a knot at the neck, its tail streaming out in the wind (the rig keeps it on the body) */}
          <g data-follow="body">
            <g transform={`translate(0 ${neck})`}>
              <path data-part="scarf-tail" className="scarf ol-thin" d="M214 0 C 236 -4 250 10 262 4 L 266 16 C 250 24 234 12 212 12 Z" />
              <path className="scarf ol-thin" d="M168 -6 Q 200 8 232 -6 L 234 6 Q 200 22 166 6 Z" />
              <circle className="scarf-knot ol-thin" cx="218" cy="6" r="7" />
            </g>
          </g>

          <Head
            species={species}
            hat={
              <g data-part="adjust" className="own-hat">
                {/* a flat driving cap with a short peak */}
                <path className="cap ol" d="M136 122 Q 136 80 200 78 Q 264 80 266 122 Z" />
                <path className="cap-peak ol" d="M146 120 Q 200 112 262 120 Q 270 136 246 138 Q 200 130 152 138 Q 136 134 146 120 Z" />
                <path d="M160 92 Q 200 84 242 92" fill="none" stroke="rgb(0 0 0 / 0.18)" strokeWidth="3" strokeLinecap="round" />
                <circle className="cap-button" cx="200" cy="80" r="5" />
              </g>
            }
          />

          {/* arms go behind the wheel; their hands are drawn after it, on the rim */}
          <Arm part="arm-l" d="M138 268 Q 128 306 166 298" hand={GRIP} handLater />
          <Arm part="arm-r" d="M262 268 Q 272 306 234 298" hand={[234, 298]} handLater />
          <g data-part="wheel">
            <path d={`M${WHEEL[0]} ${WHEEL[1]} V ${WHEEL[1] + 26}`} stroke="#2a2a30" strokeWidth="8" />
            <ellipse className="wheel-rim" cx={WHEEL[0]} cy={WHEEL[1]} rx={WHEEL_R[0]} ry={WHEEL_R[1]} fill="none" strokeWidth="7" />
            <path d={`M${WHEEL[0] - WHEEL_R[0]} ${WHEEL[1]} H${WHEEL[0] + WHEEL_R[0]} M${WHEEL[0]} ${WHEEL[1]} V${WHEEL[1] + WHEEL_R[1]}`} className="wheel-spoke" strokeWidth="4" />
            <circle className="wheel-hub" cx={WHEEL[0]} cy={WHEEL[1]} r="8" />
          </g>
          <ArmHand part="arm-l" d="M138 268 Q 128 306 166 298" hand={GRIP} />
          <ArmHand part="arm-r" d="M262 268 Q 272 306 234 298" hand={[234, 298]} />
          </g>

          {/* the windscreen, then the bonnet and the front of the car over the driver's lap */}
          <path className="windscreen" d="M118 304 L 130 258 Q 200 250 270 258 L 282 304 Z" />
          <path className="windscreen-rim" d="M118 304 L 130 258 Q 200 250 270 258 L 282 304" fill="none" strokeWidth="4" strokeLinejoin="round" />
          <path className="car-body ol" d="M58 330 Q 56 300 96 298 Q 200 290 304 298 Q 344 300 342 330 L 340 362 Q 338 376 322 376 H78 Q 62 376 60 362 Z" />
          <path d="M84 304 Q 200 296 316 304" fill="none" stroke="rgb(255 255 255 / 0.3)" strokeWidth="4" strokeLinecap="round" />
          {/* the bonnet's bulge and a racing stripe */}
          <path className="car-stripe" d="M186 296 L 182 336 H218 L 214 296 Z" />
          <path d="M58 330 Q 56 300 96 298 Q 200 290 304 298 Q 344 300 342 330 L 340 362 Q 338 376 322 376 H78 Q 62 376 60 362 Z" fill="url(#critter-vinyl)" />
          {/* headlights: chrome rims, lenses, and a glow that pulses on the beat */}
          {[104, 296].map((cx) => (
            <g key={cx}>
              <circle data-glow="" className="headlight-glow" cx={cx} cy="326" r="26" filter="url(#critter-blur)" />
              <circle className="chrome ol-thin" cx={cx} cy="326" r="19" />
              <circle className="headlight" cx={cx} cy="326" r="14" />
              <circle cx={cx - 5} cy="321" r="4" fill="#fff" opacity="0.8" />
            </g>
          ))}
          {/* a grille like a grin, the bumper and the plate */}
          <path className="car-grille ol-thin" d="M150 334 Q 200 348 250 334 Q 248 356 200 360 Q 152 356 150 334 Z" />
          {[166, 183, 200, 217, 234].map((gx) => <path key={gx} d={`M${gx} ${338 + Math.abs(gx - 200) * -0.12 + 3} V ${356 - Math.abs(gx - 200) * 0.1}`} className="chrome-line" strokeWidth="2.5" />)}
          <rect className="chrome ol-thin" x="64" y="364" width="272" height="14" rx="7" />
          <rect className="plate ol-thin" x="176" y="362" width="48" height="18" rx="3" />
          <text x="200" y="375.5" textAnchor="middle" fontSize="11" fontWeight="900" className="plate-text">WAVE</text>
        </g>
      </g>
    </CritterFrame>
  );
}
