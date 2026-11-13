import { useRef, type ReactNode } from 'react';
import { armJoint, beatClock, bend } from './arm';
import { swell, windUp } from './flourish';
import { Arm, ArmHand, Body, BodyOutfits, CritterFrame, Head, Legs } from './parts';
import type { ActProps } from './species';
import { useCritterRig, type RigFrame } from './rig';

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

/** How fast and which way the road is going this frame, for a place's own scenery. */
export interface DriveMotion {
  /** the road's bend: how far its far end is pushed sideways, px */
  curve: number;
  /** 0 parked, 1 on the move */
  moving: number;
  /** how fast the road goes by (fraction of the road a second) */
  speed: number;
  /** how far down the road we've come, 0..1, wrapping */
  go: number;
}

/**
 * Where the drive goes. Every drive shares the car, the road, the swerve, the steering and the free hand's
 * moves (`DriveScene`); a place gives the backdrop, what goes by at the roadside and what the driver wears.
 */
interface DrivePlace {
  /** `critter-<variant>` on the frame, for the place's own colours (the plain road has none) */
  variant?: string;
  /** "down the road at sunset", for the label */
  where: string;
  /** behind everything: sky, sun or moon, the far scenery (in `data-part="scenery"`, which drifts against the
   *  bend) and the ground either side of the road */
  backdrop: ReactNode;
  /** one thing at the roadside, its foot at 0,0 and about 60 tall, drawn for the right-hand side (it's mirrored
   *  on the left) */
  roadside: ReactNode;
  /** on the back seat behind the driver: what pokes up over the car's tub */
  backSeat?: ReactNode;
  /** prints on the top */
  top: ReactNode;
  /** round the neck (the rig keeps it on the body); a `scarf-tail` part streams out in the wind */
  neck?: ReactNode;
  hat?: ReactNode;
  eyewear?: ReactNode;
  plate: string;
  /** the place's own movement, after the car's */
  animate?: (f: RigFrame, m: DriveMotion) => void;
}

/**
 * The car and the road every drive shares. The critter sits at the wheel of a little open-top car coming down
 * a long road towards you; the car, the road and the lights take the skin's colours. The car swerves from side
 * to side in time (one way every two beats), the wheel turning with it under the steering hand, and bounces
 * on its springs with the bass; the free hand changes move every bar (tapping the wheel, waving out of the car,
 * raising the roof, drumming the door). The road rushes by faster as the band gets louder, and the headlights
 * pulse on the beat. Flourish: the car hops off the road, hand in the air. Paused, the car idles at the
 * roadside, ticking over, and the driver straightens the hat.
 */
function DriveScene({ species, still, place }: ActProps & { place: DrivePlace }) {
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
      // the far scenery drifts a little against the bend
      $('scenery').setAttribute('transform', `translate(${f1(-curve * 0.15)} 0)`);

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

      // a scarf streams out behind in the wind, flapping faster the faster the car goes
      const tail = $('scarf-tail');
      if (tail) {
        const flap = (k: number) => Math.sin(t * (4 + speed * 14) - k) * (2 + 8 * moving) * k;
        tail.setAttribute(
          'd',
          `M214 0 C ${f1(236 + 4 * moving)} ${f1(-4 + flap(0.6))} ${f1(250 + 10 * moving)} ${f1(10 + flap(1.2) - 8 * moving)} ${f1(262 + 22 * moving)} ${f1(4 + flap(1.8) - 14 * moving)} L ${f1(266 + 22 * moving)} ${f1(16 + flap(2) - 14 * moving)} C ${f1(250 + 10 * moving)} ${f1(24 + flap(1.3) - 8 * moving)} ${f1(234 + 4 * moving)} ${f1(12 + flap(0.7))} 212 12 Z`,
        );
      }
      // the hat's tipped up off the head on the flourish's woo-hoo
      if (flourish) $('adjust')?.setAttribute('transform', `translate(0 ${f1(-14 * hop)}) rotate(${(-10 * windUp(flourish) * (1 - flourish)).toFixed(2)} 200 112)`);
      place.animate?.(f, { curve, moving, speed, go: s.go });
    },
    { still, nod: 10 },
  );

  const neck = species.figure.chin[0] + 6;
  return (
    <CritterFrame ref={root} kind="drive" variant={place.variant} species={species} label={`A ${species.noun} driving a little open-top car ${place.where}, singing`}>
      {place.backdrop}
      <path data-part="road" className="road" d={roadPath(0)} />
      <path data-part="road-edge" className="road-edge" d={edgePath(0)} fill="none" strokeWidth="3" />
      {Array.from({ length: DASHES }, (_, i) => (
        <path key={i} data-dash="" className="road-line" d={dashPath(i / DASHES, i / DASHES + 0.055, 0)} />
      ))}
      {Array.from({ length: POSTS * 2 }, (_, i) => (
        <g key={i} data-post="" transform={`translate(${i % 2 ? 360 : 40} ${HORIZON + 40})`}>
          {i % 2 ? place.roadside : <g transform="scale(-1 1)">{place.roadside}</g>}
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
          {/* the driver sits up high in the seat, so the wheel and the bonnet hide only the lap. Behind the top: the
              seat, then what the species draws behind it (neck, a shell, legs and tail), which the car's tub hides
              below the shoulders */}
          {place.backSeat}
          <g transform={`translate(0 ${-LIFT})`}>
            <path className="seat ol" d="M150 300 V 238 Q 150 214 176 214 H224 Q 250 214 250 238 V300 Z" />
            <path d="M162 232 Q 200 222 238 232" fill="none" stroke="rgb(255 255 255 / 0.18)" strokeWidth="4" strokeLinecap="round" />
            <Legs species={species} />
          </g>
          {/* the tub of the car behind the driver */}
          <path className="car-tub ol" d="M62 312 Q 60 276 96 270 H304 Q 340 276 338 312 Z" />
          <g transform={`translate(0 ${-LIFT})`}>

          <Body species={species}>
            {place.top}
            <BodyOutfits />
          </Body>
          {place.neck && (
            <g data-follow="body">
              <g transform={`translate(0 ${neck})`}>{place.neck}</g>
            </g>
          )}

          <Head species={species} hat={place.hat} eyewear={place.eyewear} />

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
          <text x="200" y="375.5" textAnchor="middle" fontSize="11" fontWeight="900" className="plate-text">{place.plate}</text>
        </g>
      </g>
    </CritterFrame>
  );
}

/** The plain road's driving cap and scarf, and the white racing tee. */
const ROAD: DrivePlace = {
  where: 'down the road',
  backdrop: (
    <>
      {/* sky, the sun going down, hills, verges */}
      <rect className="drive-sky" x="0" y="0" width="400" height={HORIZON + 2} />
      <g className="drive-sun">
        <circle cx="338" cy={HORIZON - 40} r="40" />
      </g>
      {[HORIZON - 22, HORIZON - 12, HORIZON - 4].map((y, i) => (
        <rect key={y} className="drive-sky-band" x="290" y={y} width="100" height={3 + i} />
      ))}
      <g data-part="scenery">
        <path className="hill-far" d={`M-40 ${HORIZON} Q 30 ${HORIZON - 54} 96 ${HORIZON - 18} Q 150 ${HORIZON - 44} 210 ${HORIZON - 8} Q 300 ${HORIZON - 30} 440 ${HORIZON} Z`} />
        <path className="hill-near" d={`M-40 ${HORIZON + 2} Q 60 ${HORIZON - 26} 130 ${HORIZON - 2} Q 300 ${HORIZON - 34} 440 ${HORIZON + 2} Z`} />
      </g>
      <rect className="verge" x="0" y={HORIZON} width="400" height={400 - HORIZON} />
    </>
  ),
  roadside: (
    <>
      <rect className="post" x="-5" y="-60" width="10" height="60" rx="2" />
      <rect className="post-light" x="-4" y="-54" width="8" height="12" rx="2" />
    </>
  ),
  top: (
    <>
      {/* a white racing tee: two stripes across the chest */}
      <rect className="tee-print" x="100" y="282" width="200" height="7" />
      <rect className="tee-print" x="100" y="294" width="200" height="4" />
    </>
  ),
  neck: (
    <>
      {/* the scarf: a knot at the neck, its tail streaming out in the wind */}
      <path data-part="scarf-tail" className="scarf ol-thin" d="M214 0 C 236 -4 250 10 262 4 L 266 16 C 250 24 234 12 212 12 Z" />
      <path className="scarf ol-thin" d="M168 -6 Q 200 8 232 -6 L 234 6 Q 200 22 166 6 Z" />
      <circle className="scarf-knot ol-thin" cx="218" cy="6" r="7" />
    </>
  ),
  hat: (
    <g data-part="adjust" className="own-hat">
      {/* a flat driving cap with a short peak */}
      <path className="cap ol" d="M136 122 Q 136 80 200 78 Q 264 80 266 122 Z" />
      <path className="cap-peak ol" d="M146 120 Q 200 112 262 120 Q 270 136 246 138 Q 200 130 152 138 Q 136 134 146 120 Z" />
      <path d="M160 92 Q 200 84 242 92" fill="none" stroke="rgb(0 0 0 / 0.18)" strokeWidth="3" strokeLinecap="round" />
      <circle className="cap-button" cx="200" cy="80" r="5" />
    </g>
  ),
  plate: 'WAVE',
};

/**
 * Out for a drive: down a long road through the hills at sunset, roadside posts flashing by. A flat driving cap
 * and a scarf that flaps in the wind, and a white racing tee. Everything else is `DriveScene`'s.
 */
export function Drive(props: ActProps) {
  return <DriveScene {...props} place={ROAD} />;
}

/** The far headland's lighthouse: where its lamp sits, before the scenery's drift. */
const LIGHTHOUSE: [number, number] = [34, HORIZON - 58];
/** Gulls over the sea: x, y. */
const GULLS: [number, number][] = [[118, 70], [150, 92], [250, 54]];
/** The sun's glints on the sea: x, y, length. */
const GLINTS: [number, number, number][] = [[320, HORIZON - 15, 32], [332, HORIZON - 10, 22], [312, HORIZON - 6, 42], [342, HORIZON - 2, 16], [298, HORIZON - 2, 14]];

/** A palm at the roadside, leaning out away from the road, its fronds swaying (`data-frond`). */
const PALM = (
  <>
    <path className="palm-trunk" d="M0 0 Q 4 -64 24 -118" fill="none" strokeWidth="8" strokeLinecap="round" />
    <path className="palm-ring" d="M-3 -24 l 7 1 M-1 -50 l 7 1 M3 -76 l 7 1 M10 -98 l 7 1" fill="none" strokeWidth="1.6" />
    <g transform="translate(24 -118)">
      <g data-frond="">
        <path className="frond" d="M0 0 Q -30 -24 -52 -2 Q -26 -10 0 0 Z M0 0 Q 28 -28 58 -12 Q 28 -14 0 0 Z M0 0 Q -14 -40 -42 -44 Q -16 -28 0 0 Z M0 0 Q 20 -40 46 -44 Q 16 -26 0 0 Z M0 0 Q 14 24 24 44 Q 4 22 0 0 Z" />
        <circle className="coconut" cx="-3" cy="5" r="5" />
        <circle className="coconut" cx="6" cy="7" r="5" />
      </g>
    </g>
  </>
);

const COAST: DrivePlace = {
  variant: 'coast',
  where: 'along the coast road by the sea',
  backdrop: (
    <>
      <rect className="drive-sky" x="0" y="0" width="400" height={HORIZON + 2} />
      {GULLS.map(([x, y]) => (
        <g key={x} data-gull="" transform={`translate(${x} ${y})`}>
          <path className="gull" d="M-10 0 Q -5 -6 0 0 Q 5 -6 10 0" fill="none" strokeWidth="2.4" strokeLinecap="round" />
        </g>
      ))}
      <g data-part="scenery">
        {/* the sun going down into the sea, with a lighthouse on the far headland and a sailing boat */}
        <circle className="coast-sun" cx="336" cy={HORIZON - 22} r="32" />
        {[HORIZON - 40, HORIZON - 32].map((y, i) => (
          <rect key={y} className="drive-sky-band" x="290" y={y} width="100" height={2 + i} />
        ))}
        <path className="coast-head" d={`M-60 ${HORIZON - 20} Q -10 ${HORIZON - 46} 30 ${HORIZON - 44} Q 70 ${HORIZON - 42} 96 ${HORIZON - 26} Q 112 ${HORIZON - 20} 130 ${HORIZON - 20} Z`} />
        <path className="lighthouse ol-thin" d={`M${LIGHTHOUSE[0] - 6} ${HORIZON - 42} L ${LIGHTHOUSE[0] - 4} ${LIGHTHOUSE[1]} H${LIGHTHOUSE[0] + 4} L ${LIGHTHOUSE[0] + 6} ${HORIZON - 42} Z`} />
        <path className="lighthouse-band" d={`M${LIGHTHOUSE[0] - 5.4} ${HORIZON - 50} H${LIGHTHOUSE[0] + 5.4} M${LIGHTHOUSE[0] - 4.6} ${HORIZON - 44 - 0} H${LIGHTHOUSE[0] + 4.6}`} strokeWidth="2.4" fill="none" />
        <circle data-part="beacon" className="beacon" cx={LIGHTHOUSE[0]} cy={LIGHTHOUSE[1] - 3} r="9" filter="url(#critter-blur)" />
        <rect className="lighthouse-top" x={LIGHTHOUSE[0] - 4} y={LIGHTHOUSE[1] - 6} width="8" height="6" rx="1" />
        <rect className="coast-sea" x="-60" y={HORIZON - 20} width="520" height="22" />
        {GLINTS.map(([x, y, w], i) => <rect key={i} data-glint="" className="coast-glint" x={x} y={y} width={w} height="1.6" rx="0.8" />)}
        <g data-part="boat" transform={`translate(176 ${HORIZON - 16})`}>
          <path className="boat-hull" d="M-12 0 H12 L 8 5 H-8 Z" />
          <path className="boat-sail" d="M-1 -1 V-22 L 10 -2 Z M-3 -1 V-17 L -11 -2 Z" />
        </g>
      </g>
      {/* the beach either side of the road, the surf along the shore */}
      <rect className="coast-sand" x="0" y={HORIZON} width="400" height={400 - HORIZON} />
      <path className="coast-foam" d={`M-10 ${HORIZON + 1} H410`} strokeWidth="2.5" />
      <path className="coast-sand-dark" d="M8 300 q 12 -4 24 0 M352 280 q 16 -5 32 0 M20 240 q 10 -3 20 0 M372 226 q 8 -3 16 0" fill="none" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  roadside: PALM,
  backSeat: (
    // a surfboard standing up on the back seat
    <g transform={`translate(0 ${-LIFT}) rotate(-16 118 300)`}>
      <path className="coast-board ol" d="M118 150 Q 138 200 133 290 H103 Q 98 200 118 150 Z" />
      <path className="coast-board-stripe" d="M118 156 V 288" strokeWidth="4" />
    </g>
  ),
  top: (
    // a striped beach tee
    <path className="coast-stripe" d="M100 262 H300 M100 278 H300 M100 294 H300 M100 310 H300" strokeWidth="6" />
  ),
  hat: (
    <g data-part="adjust" className="own-hat">
      {/* a floppy bucket hat */}
      <path className="bucket-hat ol" d="M142 124 Q 144 80 200 78 Q 256 80 258 124 Z" />
      <path className="bucket-brim ol" d="M122 126 Q 200 108 278 126 Q 286 140 266 142 Q 200 130 134 142 Q 114 140 122 126 Z" />
      <path className="bucket-band" d="M144 116 Q 200 106 256 116" fill="none" strokeWidth="6" />
    </g>
  ),
  eyewear: (
    <g className="own-eyewear">
      {/* round-cornered shades */}
      <path className="shades ol-thin" d="M140 156 H190 Q 192 182 166 184 Q 142 182 140 156 Z M210 156 H260 Q 258 182 234 184 Q 208 182 210 156 Z" />
      <path d="M190 160 Q 200 154 210 160" fill="none" stroke="#111" strokeWidth="3" />
      <path d="M148 162 L 160 160 M218 162 L 230 160" stroke="rgb(255 255 255 / 0.55)" strokeWidth="3" strokeLinecap="round" />
    </g>
  ),
  plate: 'SURF',
  animate: ({ t, a, bob, idle, $ }, { moving }) => {
    const svg = $('car').ownerSVGElement!;
    // the sun glints on the water with the highs, the lighthouse flashes on the beat, the boat drifts
    svg.querySelectorAll<SVGElement>('[data-glint]').forEach((g, i) => {
      g.style.opacity = (0.35 + Math.abs(Math.sin(t * 2.2 + i * 1.9)) * 0.45 + (a.playing ? a.treble * 0.3 : 0)).toFixed(2);
    });
    $('beacon').style.opacity = (idle ? 0.35 + Math.max(0, Math.sin(t * 1.4)) * 0.4 : 0.25 + bob * 0.75).toFixed(2);
    $('boat').setAttribute('transform', `translate(${f1(176 + Math.sin(t * 0.08) * 40)} ${f1(HORIZON - 16 + Math.sin(t * 1.3) * 0.8)}) rotate(${f1(Math.sin(t * 1.1) * 3)})`);
    svg.querySelectorAll<SVGElement>('[data-gull]').forEach((g, i) => {
      const [x, y] = GULLS[i];
      g.setAttribute('transform', `translate(${f1(x + Math.sin(t * 0.4 + i * 2) * 14)} ${f1(y + Math.sin(t * 1.3 + i) * 4 - bob * 2)}) scale(1 ${(0.6 + Math.abs(Math.sin(t * 5 + i)) * 0.6).toFixed(2)})`);
    });
    // the palms toss in the wind as the car goes by
    svg.querySelectorAll<SVGElement>('[data-frond]').forEach((fr, i) => {
      fr.setAttribute('transform', `rotate(${f1(Math.sin(t * (1.2 + moving * 2) + i) * (3 + moving * 6))})`);
    });
  },
};

/**
 * The coast road: along the beach at sunset with the sea beyond, palms going by at the roadside, a lighthouse
 * flashing on the beat on the far headland, a boat on the water and gulls overhead. A bucket hat, shades, a
 * striped tee and a surfboard on the back seat. The car and the moves are `DriveScene`'s.
 */
export function CoastDrive(props: ActProps) {
  return <DriveScene {...props} place={COAST} />;
}

/** The city skyline at the horizon: x, width, height of each block. */
const BLOCKS: [number, number, number][] = [
  [-60, 34, 40], [-24, 26, 62], [4, 30, 46], [36, 22, 78], [60, 34, 54], [96, 26, 36], [124, 30, 66], [156, 22, 44],
  [180, 36, 88], [218, 26, 50], [246, 32, 70], [280, 24, 42], [306, 34, 82], [342, 26, 56], [370, 30, 38], [402, 30, 64], [434, 28, 46],
];
/** Lit windows: one in every few of a grid over each block, x and y. */
const WINDOWS: [number, number][] = BLOCKS.flatMap(([x, w, h], b) => {
  const out: [number, number][] = [];
  for (let wy = HORIZON - h + 8; wy < HORIZON - 8; wy += 10) {
    for (let wx = x + 5; wx < x + w - 6; wx += 8) if ((wx * 7 + wy * 3 + b) % 5 < 2) out.push([wx, wy]);
  }
  return out;
});
/** Stars: x, y, size. */
const STARS: [number, number, number][] = [[24, 30, 1.6], [70, 64, 1.2], [116, 22, 1.8], [160, 52, 1.2], [214, 18, 1.4], [262, 44, 1.8], [380, 22, 1.4], [384, 112, 1.2], [36, 112, 1.4], [234, 96, 1.2]];

const NIGHT: DrivePlace = {
  variant: 'night',
  where: 'through the city at night',
  backdrop: (
    <>
      <rect className="drive-sky" x="0" y="0" width="400" height={HORIZON + 2} />
      {STARS.map(([x, y, r], i) => <circle key={i} data-star="" className="night-star" cx={x} cy={y} r={r} />)}
      {/* the moon, with a glow round it */}
      <circle className="night-moon-glow" cx="320" cy="62" r="34" filter="url(#critter-blur)" />
      <circle className="night-moon" cx="320" cy="62" r="24" />
      <circle className="night-crater" cx="312" cy="56" r="5" />
      <circle className="night-crater" cx="328" cy="72" r="3.5" />
      <circle className="night-crater" cx="330" cy="52" r="2.5" />
      <g data-part="scenery">
        {/* the skyline, its windows lighting up and going out with the music, a light blinking on the mast */}
        {BLOCKS.map(([x, w, h]) => <rect key={x} className="city-block" x={x} y={HORIZON - h} width={w} height={h + 2} />)}
        <path className="city-mast" d={`M198 ${HORIZON - 88} V ${HORIZON - 112}`} strokeWidth="2" />
        <circle data-glow="" className="city-mast-light" cx="198" cy={HORIZON - 113} r="3" />
        {WINDOWS.map(([x, y], i) => <rect key={i} data-window="" className="city-window" x={x} y={y} width="4" height="5" />)}
      </g>
      <rect className="night-verge" x="0" y={HORIZON} width="400" height={400 - HORIZON} />
    </>
  ),
  roadside: (
    // a street lamp, its arm reaching out over the road and a pool of light under it
    <>
      <rect className="lamp-post" x="-3" y="-96" width="6" height="96" rx="2" />
      <path className="lamp-post-arm" d="M0 -92 Q 0 -104 -14 -104 H-28" fill="none" strokeWidth="5" strokeLinecap="round" />
      <circle data-glow="" className="lamp-glow" cx="-30" cy="-98" r="14" filter="url(#critter-blur)" />
      <path className="lamp-head" d="M-40 -100 H-20 L -24 -106 H-36 Z" />
      <ellipse className="lamp-bulb" cx="-30" cy="-99" rx="7" ry="2.5" />
    </>
  ),
  top: (
    <>
      {/* a black leather jacket, open over a bright tee, with a zip down one side */}
      <path className="night-tee" d="M170 246 L 200 300 L 230 246 Z" />
      <path className="jacket-lapel" d="M170 246 L 200 300 L 186 300 L 160 252 Z M230 246 L 200 300 L 214 300 L 240 252 Z" />
      <path className="jacket-zip" d="M222 302 V 330" strokeWidth="2.5" />
    </>
  ),
  eyewear: (
    <g className="own-eyewear">
      {/* aviators: two teardrop lenses on a thin gold bridge */}
      <path className="aviator ol-thin" d="M140 158 H190 Q 192 186 168 188 Q 140 186 140 158 Z M210 158 H260 Q 260 186 232 188 Q 208 186 210 158 Z" />
      <path className="aviator-rim" d="M140 158 H190 M210 158 H260 M190 160 Q 200 154 210 160" fill="none" strokeWidth="2.5" />
      <path d="M150 166 L 164 164 M220 166 L 234 164" stroke="rgb(255 255 255 / 0.5)" strokeWidth="3" strokeLinecap="round" />
    </g>
  ),
  plate: 'NITE',
  animate: (f) => {
    const { t, a, idle, $ } = f;
    const svg = $('car').ownerSVGElement!;
    // the stars twinkle; each bar a different handful of windows is lit, glowing brighter with the band
    svg.querySelectorAll<SVGElement>('[data-star]').forEach((s, i) => {
      s.style.opacity = (0.35 + Math.abs(Math.sin(t * 1.3 + i * 2.1)) * 0.65).toFixed(2);
    });
    const bar = idle ? 0 : Math.floor(beatClock(f).index / 4);
    const glow = 0.6 + (a.playing ? a.mid * 0.4 : 0);
    svg.querySelectorAll<SVGElement>('[data-window]').forEach((w, i) => {
      const on = (Math.sin(i * 12.9898 + bar * 78.233) * 43758.5453) % 1;
      w.style.opacity = (Math.abs(on) < 0.72 ? glow : 0.12).toFixed(2);
    });
  },
};

/**
 * The night drive: through the city after dark, the skyline's windows lighting up bar by bar, street lamps going
 * by overhead, the moon and the stars. Aviators and a black leather jacket over a bright tee. The car and the
 * moves are `DriveScene`'s.
 */
export function NightDrive(props: ActProps) {
  return <DriveScene {...props} place={NIGHT} />;
}
