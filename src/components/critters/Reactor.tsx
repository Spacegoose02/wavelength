import { useRef } from 'react';
import { beatClock, bend, lift } from './arm';
import { swell, windUp } from './flourish';
import { Arm, ArmHand, Body, BodyOutfits, CritterFrame, Head, Legs, Shadow, Skirt, trefoil } from './parts';
import type { ActProps } from './species';
import { useCritterRig } from './rig';

/** The reactor core behind the critter: centre and the glowing window's radius. */
const CORE: [number, number] = [200, 150];
const CORE_R = 98;
/** Fuel rods across the core: x of each. */
const RODS = Array.from({ length: 9 }, (_, i) => 136 + i * 16);
/** White keys on the keytar, in its own frame: 12 from x -56. */
const KEYS = Array.from({ length: 12 }, (_, i) => -56 + i * 10.6);
/** The keytar's frame: where it sits and how far the neck tips up. */
const KEYTAR = 'translate(186 322) rotate(-18)';
/** Glowing motes rising off the core: x, size, where in the climb each starts (0..1), speed. */
const MOTES: [number, number, number, number][] = [
  [96, 2.4, 0, 1], [118, 1.8, 0.4, 1.3], [282, 2.2, 0.7, 0.9], [306, 1.6, 0.2, 1.2],
  [140, 1.6, 0.85, 1.1], [262, 2, 0.55, 1.4], [70, 1.8, 0.3, 0.8], [330, 2.2, 0.1, 1],
];

const f1 = (n: number) => n.toFixed(1);

/**
 * Down in the reactor hall: the critter rocks a keytar in front of the glowing core of a nuclear reactor,
 * in a hard hat and a lab coat. The fuel rods light up with the spectrum and the core's Cherenkov glow swells
 * with the bass; amber warning beacons spin on the beat, a Geiger counter's needle jumps with the highs and
 * green motes drift up off the core. The keytar, hard hat and badge take the skin's colours; the reactor's
 * glow stays radioactive green. One hand plays the keys (a chord on each beat, gliding along them with the
 * highs, the keys lighting up under it), the other slides along the ribbon on the neck for the pitch bends.
 * Flourish: the keytar swings up and the hand sweeps down the keys while the core flares. Paused, the hands
 * rest and the beacons stop.
 */
export function Reactor({ species, still }: ActProps) {
  const root = useRef<SVGSVGElement>(null);
  const state = useRef({ glide: 0, chord: 0, chordTo: 0, beat: 0, spin: 0, needle: 0, rise: 0 });

  useCritterRig(
    root,
    (f) => {
      const { t, a, idle, bob, rock, flourish, $ } = f;
      const s = state.current;
      const svg = root.current!;
      const { phase, index } = beatClock(f);
      const onBeat = index !== s.beat;
      s.beat = index;
      // the key hand: a chord on each beat, moving to a new one now and then, gliding along with the highs
      if (onBeat && Math.random() < 0.45) s.chordTo = [-8, -3, 2, 7][Math.floor(Math.random() * 4)];
      if (idle) s.chordTo = 0;
      s.chord += (s.chordTo - s.chord) * 0.25;
      s.glide += ((idle ? 0 : a.live ? Math.min(1, a.treble * 1.8) * 2 - 1 : Math.sin(t * 0.9)) - s.glide) * 0.1;
      const press = idle ? 0 : lift(phase);
      const sweep = flourish ? windUp(flourish) : 0;
      // the keytar rocks a little with the beat, and swings up for the flourish
      const tip = (a.playing ? -bob * 2 : 0) - swell(flourish) * 12;
      $('keytar').setAttribute('transform', `rotate(${tip.toFixed(2)} 200 322)`);
      // turning the arm about the shoulder runs the hand along the keys
      const along = flourish ? 18 - sweep * 40 : s.chord + s.glide * 6;
      $('arm-l').setAttribute('transform', `rotate(${(-along + tip * 0.6).toFixed(2)} 138 268)`);
      bend($, 'arm-l', { to: [0, -press * 8], wrist: -press * 12 });
      // the neck hand slides along the ribbon with the highs and shakes a vibrato on sharp hits
      const bendUp = idle ? 0 : a.live ? Math.min(1, a.treble * 1.5 + a.mid * 0.4) : 0.5 + Math.sin(t * 0.7) * 0.4;
      $('arm-r').setAttribute('transform', `rotate(${(tip + (idle ? 4 : -bendUp * 6) + rock * 2).toFixed(2)} 262 268)`);
      bend($, 'arm-r', { to: [bendUp * 4, 0], wrist: rock * 10 + (a.playing ? Math.sin(t * 13) * 2 : 0) });

      // keys light with the spectrum, and a run follows the hand down the keys in the flourish
      const bins = a.freq.length;
      svg.querySelectorAll<SVGElement>('[data-key]').forEach((k, i) => {
        const v = a.playing ? a.freq[Math.floor(((i + 0.5) / KEYS.length) * bins * 0.6)] ?? 0 : 0;
        const run = flourish && Math.abs(i / (KEYS.length - 1) - Math.max(0, 1 - sweep)) < 0.1;
        k.style.opacity = v > 0.45 || run ? '1' : '0';
      });
      $('ribbon').style.opacity = (a.playing ? 0.35 + bendUp * 0.65 : 0.2).toFixed(2);

      // the core: rods glow with their slice of the spectrum, the glow swells with the bass, the flourish flares it
      svg.querySelectorAll<SVGElement>('[data-rod]').forEach((r, i) => {
        const v = a.playing ? a.freq[Math.floor(((Math.abs(i - 4) + 0.5) / 5) * bins * 0.5)] ?? 0 : 0.2;
        r.style.opacity = (0.35 + Math.min(1, v) * 0.65 + swell(flourish) * 0.4).toFixed(2);
      });
      const glow = 0.45 + (a.playing ? a.bass * 0.45 + bob * 0.15 : Math.sin(t * 1.2) * 0.08) + swell(flourish) * 0.4;
      $('core').style.opacity = Math.min(1, glow).toFixed(2);
      $('halo').style.opacity = Math.min(0.9, glow * 0.7).toFixed(2);
      $('core-flash').style.opacity = (swell(flourish) * 0.55).toFixed(2);

      // the beacons spin, a turn every two beats (faster in the flourish), and stop when paused
      if (a.playing) s.spin += (f.tempo.locked ? f.tempo.bpm / 60 / 2 : 0.9) * (flourish ? 3 : 1) / 60;
      const turn = Math.cos(s.spin * Math.PI * 2);
      ['beam-l', 'beam-r'].forEach((name, i) => {
        const k = i ? -turn : turn;
        $(name).setAttribute('transform', `scale(${f1(k)} 1)`);
        $(name).style.opacity = a.playing ? (0.25 + Math.abs(k) * 0.5).toFixed(2) : '0';
      });
      svg.querySelectorAll<SVGElement>('[data-beacon]').forEach((el) => {
        el.style.opacity = a.playing ? (0.6 + Math.abs(turn) * 0.4).toFixed(2) : '0.45';
      });

      // the Geiger counter: the needle jumps with the highs, its lamp clicks on hits
      s.needle += ((a.playing ? Math.min(1, a.treble * 1.4 + a.mid * 0.4) : 0.05) - s.needle) * 0.3;
      $('needle').setAttribute('transform', `rotate(${(-50 + s.needle * 100 + (a.playing ? rock * 6 : 0)).toFixed(1)} 40 258)`);
      $('click').style.opacity = a.playing && (a.transient || f.hit) ? '1' : '0.2';

      s.rise += (0.06 + (a.playing ? a.bass * 0.3 : 0)) / 60;
      svg.querySelectorAll<SVGElement>('[data-mote]').forEach((m, i) => {
        const [x, , start, speed] = MOTES[i];
        const p = (s.rise * speed + start) % 1;
        m.setAttribute('cy', f1(330 - p * 300));
        m.setAttribute('cx', f1(x + Math.sin(t * 1.6 + i) * 5));
        m.style.opacity = (p < 0.8 ? 0.85 : (1 - p) * 4.2).toFixed(2);
      });
    },
    { still, nod: 14 },
  );

  return (
    <CritterFrame ref={root} kind="reactor" species={species} label={`A ${species.noun} playing a keytar in front of a nuclear reactor`}>
      <defs>
        <pattern id="reactor-hazard" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="16" height="16" fill="#f4c20d" />
          <rect width="8" height="16" fill="#1b1b1f" />
        </pattern>
        <radialGradient id="reactor-core-grad">
          <stop offset="0" stopColor="#f2ffe0" />
          <stop offset="0.45" stopColor="#8dff62" />
          <stop offset="1" stopColor="#1d7a33" />
        </radialGradient>
        <clipPath id="reactor-core-clip">
          <circle cx={CORE[0]} cy={CORE[1]} r={CORE_R} />
        </clipPath>
      </defs>

      {/* the hall: concrete panels, the core in its steel housing, beacons, warning signs, a Geiger counter */}
      <rect className="bunker-wall" x="0" y="0" width="400" height="344" />
      <path className="bunker-seam" d="M82 0 V344 M318 0 V344 M0 96 H82 M318 96 H400 M0 196 H82 M318 196 H400" fill="none" strokeWidth="2" />
      <circle data-part="halo" className="core-halo" cx={CORE[0]} cy={CORE[1]} r="132" filter="url(#critter-blur)" />
      <circle className="core-housing ol" cx={CORE[0]} cy={CORE[1]} r="118" />
      {Array.from({ length: 16 }, (_, i) => {
        const ang = (i / 16) * Math.PI * 2;
        return <circle key={i} className="core-bolt" cx={f1(CORE[0] + Math.cos(ang) * 109)} cy={f1(CORE[1] + Math.sin(ang) * 109)} r="3" />;
      })}
      <g clipPath="url(#reactor-core-clip)">
        <circle data-part="core" cx={CORE[0]} cy={CORE[1]} r={CORE_R} fill="url(#reactor-core-grad)" />
        {RODS.map((x) => (
          <g key={x}>
            <rect className="rod-sleeve" x={x - 6} y="52" width="12" height="200" rx="6" />
            <rect data-rod="" className="fuel-rod" x={x - 4} y="60" width="8" height="190" rx="4" />
          </g>
        ))}
        <rect data-part="core-flash" x="96" y="46" width="208" height="208" fill="#f2ffe0" style={{ opacity: 0 }} />
      </g>
      <circle className="core-rim" cx={CORE[0]} cy={CORE[1]} r={CORE_R} fill="none" strokeWidth="7" />

      {[40, 360].map((x, i) => (
        <g key={x}>
          {/* a warning beacon: the beam is a wedge squeezed by the turn, so it seems to sweep round */}
          <g transform={`translate(${x} 46)`}>
            <path data-part={i ? 'beam-r' : 'beam-l'} className="beacon-beam" d="M0 -4 L 60 -18 L 60 18 L 0 4 Z" style={{ opacity: 0 }} />
          </g>
          <rect className="beacon-base ol-thin" x={x - 12} y="52" width="24" height="10" rx="2" />
          <path data-beacon="" className="beacon" d={`M${x - 10} 52 Q ${x - 10} 32 ${x} 32 Q ${x + 10} 32 ${x + 10} 52 Z`} />
          {/* the radiation sign */}
          <rect className="sign" x={x - 26} y="112" width="52" height="52" rx="6" />
          <circle cx={x} cy="138" r="19" fill="#1b1b1f" />
          <circle cx={x} cy="138" r="17" fill="#f4c20d" />
          <path d={trefoil(x, 138, 15)} fill="#1b1b1f" />
          <circle cx={x} cy="138" r="3.2" fill="#1b1b1f" />
        </g>
      ))}

      {/* Geiger counter on the left wall */}
      <rect className="geiger ol-thin" x="14" y="228" width="52" height="44" rx="5" />
      <path className="geiger-dial" d="M22 260 A 18 18 0 0 1 58 260 Z" />
      <path d="M26 252 L 29 254 M40 242 V245 M54 252 L 51 254" stroke="#1b1b1f" strokeWidth="1.5" />
      <path data-part="needle" d="M40 258 V 242" stroke="#d42a2a" strokeWidth="2" strokeLinecap="round" />
      <circle data-part="click" className="geiger-lamp" cx="56" cy="236" r="3" />
      <path className="geiger-cable" d="M40 272 Q 40 300 56 320" fill="none" strokeWidth="3" />

      {/* a leaking waste barrel on the right */}
      <Shadow cx={360} cy={346} rx={30} ry={5} />
      <rect className="barrel ol-thin" x="334" y="282" width="52" height="62" rx="6" />
      <path d="M334 300 H386 M334 326 H386" stroke="#1b1b1f" strokeWidth="3" />
      <path d={trefoil(360, 313, 9)} fill="#1b1b1f" />
      <ellipse data-glow="" className="goo" cx="360" cy="283" rx="24" ry="5" />
      <path data-glow="" className="goo" d="M372 284 Q 376 300 372 312 Q 368 318 370 284 Z" />

      {/* the floor: steel plates behind a hazard stripe */}
      <rect className="bunker-floor" x="0" y="344" width="400" height="56" />
      <path className="bunker-seam" d="M0 372 H400 M60 344 V400 M160 344 V400 M260 344 V400 M360 344 V400" fill="none" strokeWidth="2" />
      <rect x="0" y="338" width="400" height="9" fill="url(#reactor-hazard)" />
      {MOTES.map(([x, r], i) => <circle key={i} data-mote="" className="mote" cx={x} cy="330" r={r} filter="url(#critter-glow)" />)}

      <Shadow cx={200} cy={366} rx={64} />
      <Legs species={species} shoe="boot-black" />

      <Body species={species}>
        {/* a lab coat: lapels, buttons, a pocket with pens, a dosimeter badge, and the keytar's strap */}
        <path className="coat-lapel ol-thin" d="M180 244 L 166 276 L 186 270 L 196 300 Z" />
        <path className="coat-lapel ol-thin" d="M220 244 L 234 276 L 214 270 L 204 300 Z" />
        <path d="M200 266 V330" stroke="rgb(0 0 0 / 0.18)" strokeWidth="2" />
        {[282, 300, 318].map((y) => <circle key={y} cx="206" cy={y} r="2.4" fill="#b9bcc4" />)}
        <rect className="coat-pocket" x="150" y="284" width="26" height="22" rx="2" />
        <path d="M156 286 V276 M164 286 V274" strokeWidth="3" strokeLinecap="round" className="pen" />
        <rect className="badge ol-thin" x="226" y="282" width="20" height="24" rx="3" />
        <circle cx="236" cy="292" r="6" fill="#f4c20d" />
        <path d={trefoil(236, 292, 5.4)} fill="#1b1b1f" />
        <path className="strap" d="M146 250 L 268 334" fill="none" strokeWidth="9" />
        <BodyOutfits />
      </Body>
      <Skirt species={species} trim="coat-trim" />

      <Head
        species={species}
        hat={
          <g data-part="adjust" className="own-hat">
            {/* a hard hat with a radiation sticker */}
            <path className="hardhat ol" d="M132 126 Q 132 64 200 62 Q 268 64 268 126 Z" />
            <path d="M200 64 V124" className="hardhat-ridge" strokeWidth="9" strokeLinecap="round" />
            <path className="hardhat ol" d="M116 122 H284 Q 292 132 280 138 H120 Q 108 132 116 122 Z" />
            <circle cx="162" cy="98" r="12" fill="#f4c20d" stroke="#1b1b1f" strokeWidth="1.5" />
            <path d={trefoil(162, 98, 10.5)} fill="#1b1b1f" />
          </g>
        }
      />

      <Arm part="arm-r" d="M262 268 Q 270 300 306 282" hand={[306, 282]} handLater />

      {/* the keytar, neck up to the right: keys along the body, a ribbon controller on the neck */}
      <g data-part="keytar">
        <g transform={KEYTAR}>
          <rect className="keytar-neck ol-thin" x="84" y="-6" width="96" height="12" rx="3" />
          <rect data-part="ribbon" className="ribbon" x="100" y="-3" width="64" height="6" rx="3" filter="url(#critter-glow)" />
          <path className="keytar ol-thin" d="M178 -9 L 204 -16 L 198 0 L 204 16 L 178 9 Z" />
          <path className="keytar ol" d="M-76 -15 Q -88 0 -76 17 L 84 19 Q 98 10 94 -4 L 84 -17 Z" />
          <rect x="-60" y="-9" width="134" height="24" rx="2" fill="#0d0d10" />
          {KEYS.map((x) => (
            <g key={x}>
              <rect x={x} y="-7" width="9.6" height="20" rx="1.5" fill="#ececf1" />
              <rect data-key="" className="synth-lit" x={x} y="-7" width="9.6" height="20" rx="1.5" style={{ opacity: 0 }} />
            </g>
          ))}
          {KEYS.slice(0, -1).map((x, i) => ([2, 6].includes(i % 7) ? null : <rect key={x} x={x + 6.6} y="-7" width="6" height="12" rx="1" fill="#16161a" />))}
          {[-70, -64].map((x, i) => <circle key={x} className={`led led-${i}`} cx={x} cy={-4 + i * 8} r="2.2" />)}
          <rect className="keytar-trim" x="-74" y="13" width="160" height="4" rx="2" />
        </g>
      </g>

      {/* the key hand goes over the keytar; the neck hand's arm is behind the body, its hand in front */}
      <Arm part="arm-l" d="M138 268 Q 140 304 180 318" hand={[180, 318]} />
      <ArmHand part="arm-r" d="M262 268 Q 270 300 306 282" hand={[306, 282]} />
    </CritterFrame>
  );
}
