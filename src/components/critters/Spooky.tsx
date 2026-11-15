import { useRef } from 'react';
import { beatClock, bend, lift } from './arm';
import { swell, windUp } from './flourish';
import { Arm, Body, BodyOutfits, CritterFrame, Glow, Head, Legs, Shadow, Skirt } from './parts';
import type { ActProps } from './species';
import { useCritterRig } from './rig';

/** White keys on the organ's top manual: 14 from x 118. */
const KEYS = Array.from({ length: 14 }, (_, i) => 118 + i * 11.7);
/** The organ's pipes either side, behind the critter: x, height. Taller towards the middle. */
const PIPES: [number, number][] = [
  [18, 120], [36, 150], [54, 176], [72, 196], [90, 210],
  [310, 210], [328, 196], [346, 176], [364, 150], [382, 120],
];
const PIPE_FOOT = 300;
/** Ghosts drifting round the graveyard: home x, y, size, speed. */
const GHOSTS: [number, number, number, number][] = [[64, 88, 0.8, 1], [338, 66, 0.7, 1.3], [300, 270, 0.55, 0.8]];
/** Bats flitting across the moon: start x, y, speed. */
const BATS: [number, number, number][] = [[0, 40, 1], [0.4, 70, 1.3], [0.75, 26, 0.8]];

const f1 = (n: number) => n.toFixed(1);

/** A little ghost, drawn about 0,0: a rounded sheet with a wavy hem, two eyes and an "oo" mouth. */
const GHOST = 'M-20 22 V-4 Q -20 -28 0 -28 Q 20 -28 20 -4 V22 Q 14 16 10 22 Q 6 28 0 22 Q -6 16 -10 22 Q -14 28 -20 22 Z';
/** A bat, drawn about 0,0 with its wings up. */
const BAT = 'M0 -2 Q -6 -8 -12 -4 Q -16 -10 -22 -6 Q -18 0 -14 2 Q -8 0 -4 4 Q 0 0 4 4 Q 8 0 14 2 Q 18 0 22 -6 Q 16 -10 12 -4 Q 6 -8 0 -2 Z';

/**
 * A spooky night: the critter plays a haunted pipe organ in a graveyard under a full moon, in a vampire cape
 * with a high collar. The organ's pipes light up with the spectrum, jack-o'-lanterns flicker brighter with the
 * bass, ghosts drift and bob to the beat and glow with the mids, bats flit across the moon and mist rolls along
 * the ground. The cape's lining, the jack-o'-lantern glow and the pipes' light take the skin's colours. The hands
 * play like the Synth's: a chord on each beat, a run gliding with the highs. Flourish: lightning, a glissando
 * down the keys and the ghosts swoop in. Paused, the pipes go dark and the ghosts hang still.
 */
export function Spooky({ species, still }: ActProps) {
  const root = useRef<SVGSVGElement>(null);
  const state = useRef({ glide: 0, chord: 0, chordTo: 0, beat: 0, flicker: 0.6 });

  useCritterRig(
    root,
    (f) => {
      const { t, a, idle, bob, rock, flourish, $ } = f;
      const s = state.current;
      const svg = root.current!;
      const { phase, index } = beatClock(f);
      const onBeat = index !== s.beat;
      s.beat = index;
      if (onBeat && Math.random() < 0.4) s.chordTo = [-9, -3, 3, 8][Math.floor(Math.random() * 4)];
      if (idle) s.chordTo = 0;
      s.chord += (s.chordTo - s.chord) * 0.25;
      s.glide += ((idle ? 0 : a.live ? Math.min(1, a.treble * 1.8) * 2 - 1 : Math.sin(t * 0.8)) - s.glide) * 0.1;
      const press = idle ? 0 : lift(phase);
      const taps = idle ? 0 : Math.abs(Math.sin(Math.PI * ((phase * 2) % 1)));
      $('arm-l').setAttribute('transform', `rotate(${f1(-s.chord * 0.5 + (idle ? 4 : 0))} 138 268)`);
      bend($, 'arm-l', { to: [s.chord * 0.6, -press * 9], wrist: -press * 14 });
      const gliss = flourish ? windUp(flourish) : 0;
      $('arm-r').setAttribute('transform', `rotate(${f1(flourish ? -18 + gliss * 40 : -s.glide * 10 + rock * 3)} 262 268)`);
      bend($, 'arm-r', { to: [s.glide * -4, -taps * 6], wrist: taps * 10 });

      // keys and pipes light with the spectrum
      const bins = a.freq.length;
      svg.querySelectorAll<SVGElement>('[data-key]').forEach((k, i) => {
        const v = a.playing ? a.freq[Math.floor(((i + 0.5) / KEYS.length) * bins * 0.6)] ?? 0 : 0;
        const run = flourish && Math.abs(i / (KEYS.length - 1) - (1 - Math.max(0, gliss))) < 0.08;
        k.style.opacity = v > 0.45 || run ? '1' : '0';
      });
      svg.querySelectorAll<SVGElement>('[data-pipe]').forEach((p, i) => {
        // low pipes outside, high ones in the middle, mirrored either side
        const k = i < 5 ? i : 9 - i;
        const v = a.playing ? a.freq[Math.floor(((k + 0.5) / 5) * bins * 0.5)] ?? 0 : 0;
        p.style.opacity = Math.min(1, (a.playing ? 0.2 : 0) + v * 1.3 + swell(flourish) * 0.6).toFixed(2);
      });

      // jack-o'-lanterns flicker, brighter with the bass
      s.flicker += ((idle ? 0.45 : 0.55 + (a.playing ? a.bass * 0.45 : 0)) + (Math.random() - 0.5) * 0.2 - s.flicker) * 0.3;
      svg.querySelectorAll<SVGElement>('[data-jack]').forEach((el) => (el.style.opacity = s.flicker.toFixed(2)));

      // ghosts drift and bob on the beat, glowing with the mids; they swoop in on a flourish
      const swoop = swell(flourish);
      svg.querySelectorAll<SVGElement>('[data-ghost]').forEach((g, i) => {
        const [x, y, size, speed] = GHOSTS[i];
        const dx = still ? 0 : Math.sin(t * 0.5 * speed + i * 2) * 16;
        const dy = (still ? 0 : Math.sin(t * 1.3 * speed + i) * 5) - (a.playing ? bob * 6 : 0);
        const toward = (200 - x) * swoop * 0.3;
        g.setAttribute('transform', `translate(${f1(x + dx + toward)} ${f1(y + dy)}) scale(${(size * (1 + swoop * 0.3)).toFixed(2)})`);
        g.style.opacity = (idle ? 0.45 : 0.55 + (a.playing ? a.mid * 0.4 : 0) + swoop * 0.3).toFixed(2);
      });
      // bats cross the moon, wings flapping
      svg.querySelectorAll<SVGElement>('[data-bat]').forEach((b, i) => {
        const [start, y, speed] = BATS[i];
        const p = still ? start : (t * 0.05 * speed + start) % 1;
        const flap = still ? 1 : Math.sin(t * 14 + i * 2);
        b.setAttribute('transform', `translate(${f1(-30 + p * 460)} ${f1(y + Math.sin(p * 18) * 8)}) scale(0.9 ${(0.4 + Math.abs(flap) * 0.6).toFixed(2)})`);
      });
      // lightning on a flourish; mist drifts
      $('lightning').style.opacity = flourish && (flourish < 0.12 || (flourish > 0.2 && flourish < 0.28)) ? '1' : '0';
      $('mist').setAttribute('transform', `translate(${f1(Math.sin(t * 0.25) * 18)} 0)`);
    },
    { still, nod: 10 },
  );

  return (
    <CritterFrame ref={root} kind="spooky" species={species} label={`A ${species.noun} playing a haunted pipe organ in a graveyard`}>
      {/* the moon, a lightning flash, bats */}
      <Glow id="glow-spooky-moon" color="#f4ecc8" className="moon-glow" cx={320} cy={58} r={52} />
      <circle className="moon" cx="320" cy="58" r="36" />
      <circle cx="306" cy="48" r="7" className="moon-crater" />
      <circle cx="332" cy="72" r="5" className="moon-crater" />
      <rect data-part="lightning" className="lightning" x="0" y="0" width="400" height="400" style={{ opacity: 0 }} />
      {BATS.map((_, i) => <path key={i} data-bat="" className="spooky-bat" d={BAT} />)}

      {/* the organ's pipes either side, lit from inside */}
      {PIPES.map(([x, h]) => (
        <g key={x}>
          <rect className="pipe ol-thin" x={x - 7} y={PIPE_FOOT - h} width="14" height={h} rx="2" />
          <rect data-pipe="" className="pipe-lit" x={x - 4} y={PIPE_FOOT - h + 6} width="8" height={h - 30} rx="2" style={{ opacity: 0 }} />
          <path className="pipe-mouth" d={`M${x - 5} ${PIPE_FOOT - 22} Q ${x} ${PIPE_FOOT - 30} ${x + 5} ${PIPE_FOOT - 22} Z`} />
        </g>
      ))}

      {/* ghosts */}
      {GHOSTS.map(([x, y, size], i) => (
        <g key={i} data-ghost="" transform={`translate(${x} ${y}) scale(${size})`}>
          <path className="ghost ol-thin" d={GHOST} />
          <ellipse cx="-7" cy="-8" rx="3.4" ry="4.6" fill="#1b1b24" />
          <ellipse cx="7" cy="-8" rx="3.4" ry="4.6" fill="#1b1b24" />
          <ellipse cx="0" cy="4" rx="3.6" ry="4.6" fill="#1b1b24" />
        </g>
      ))}

      {/* the graveyard: the ground, tombstones, a bare tree, jack-o'-lanterns, mist */}
      <path className="grave-ground" d="M0 312 Q 200 296 400 312 V400 H0 Z" />
      <path className="dead-tree" d="M378 312 C 372 260, 380 220, 372 190 M374 236 C 360 222, 348 220, 338 210 M378 214 C 388 202, 396 200, 400 196" fill="none" strokeWidth="6" strokeLinecap="round" />
      <path className="tombstone ol-thin" d="M18 330 V 288 Q 18 268 40 268 Q 62 268 62 288 V330 Z" />
      <path d="M32 288 H48 M40 280 V302" stroke="rgb(0 0 0 / 0.35)" strokeWidth="3" strokeLinecap="round" />
      <path className="tombstone ol-thin" d="M334 336 V 300 Q 334 286 350 286 Q 366 286 366 300 V336 Z" />
      <text x="350" y="314" textAnchor="middle" className="rip">RIP</text>
      {[[86, 346, 1], [300, 352, 0.85]].map(([x, y, k]) => (
        <g key={x} transform={`translate(${x} ${y}) scale(${k})`}>
          <Glow id="glow-jack" color="color-mix(in srgb, var(--viz-low) 40%, #ffb02a)" data-jack="" className="jack-glow" cx={0} cy={-4} rx={34} ry={24} />
          <path className="pumpkin ol" d="M-24 -4 Q -26 -24 -8 -24 Q 0 -28 8 -24 Q 26 -24 24 -4 Q 22 14 0 14 Q -22 14 -24 -4 Z" />
          <path d="M-8 -24 Q -10 -6 -6 12 M8 -24 Q 10 -6 6 12" stroke="rgb(0 0 0 / 0.2)" strokeWidth="2" fill="none" />
          <path className="pumpkin-stem" d="M-2 -24 Q 0 -34 6 -36" strokeWidth="4" fill="none" strokeLinecap="round" />
          <path data-jack="" className="jack-face" d="M-14 -10 L -8 -16 L -2 -10 Z M14 -10 L 8 -16 L 2 -10 Z M-14 0 Q 0 10 14 0 L 9 2 L 6 -2 L 2 3 L -2 -2 L -6 3 L -9 -1 Z" />
        </g>
      ))}

      <Shadow cx={200} cy={366} rx={66} />
      <Legs species={species} shoe="boot-black" />

      {/* the cape behind the body: dark outside, the lining in the skin's colour */}
      <path className="cape ol" d="M150 262 Q 120 300 112 356 Q 156 346 200 352 Q 244 346 288 356 Q 280 300 250 262 Z" />
      <path className="cape-lining" d="M160 270 Q 136 306 130 346 Q 166 340 200 344 Q 234 340 270 346 Q 264 306 240 270 Z" />

      <Body species={species}>
        {/* a waistcoat with a red cravat and the cape's high collar */}
        <path className="cravat ol-thin" d="M192 252 L 200 264 L 208 252 L 204 286 L 200 290 L 196 286 Z" />
        {[272, 290, 308].map((y) => <circle key={y} cx="216" cy={y} r="2.4" fill="#d8c27a" />)}
        <path className="cape-collar ol-thin" d="M168 246 L 140 220 L 154 258 Z M232 246 L 260 220 L 246 258 Z" />
        <BodyOutfits />
      </Body>
      <Skirt species={species} style="ruffle" className="cape" />

      <Head species={species} />

      {/* the organ console: dark carved wood, two manuals, the top one lit */}
      <path className="mist" data-part="mist" d="M-40 350 Q 20 336 80 348 Q 140 360 200 346 Q 260 334 320 348 Q 380 360 440 346 V 372 H -40 Z" />
      <rect className="organ ol-thin" x="104" y="282" width="192" height="46" rx="6" />
      <path className="organ-trim" d="M104 290 H296" strokeWidth="4" />
      <rect x="114" y="294" width="172" height="18" rx="2" fill="#0d0d10" />
      {KEYS.map((x) => (
        <g key={x}>
          <rect x={x} y="296" width="10.2" height="14" rx="1.5" fill="#ece6d4" />
          <rect data-key="" className="organ-lit" x={x} y="296" width="10.2" height="14" rx="1.5" style={{ opacity: 0 }} />
        </g>
      ))}
      {KEYS.slice(0, -1).map((x, i) => ([2, 6].includes(i % 7) ? null : <rect key={x} x={x + 7} y="296" width="6.5" height="8" rx="1" fill="#16161a" />))}
      <rect x="118" y="314" width="164" height="8" rx="1.5" fill="#d8d0bc" />
      {[0, 1, 2, 3].map((i) => <circle key={i} cx={128 + i * 9} cy="287" r="2.4" className="stop-knob" />)}
      {[0, 1, 2, 3].map((i) => <circle key={i} cx={272 - i * 9} cy="287" r="2.4" className="stop-knob" />)}
      <path className="organ ol-thin" d="M112 328 V 372 H 128 V 328 Z M272 328 V 372 H 288 V 328 Z" />

      {/* hands on the keys */}
      <Arm part="arm-l" d="M138 268 Q 122 296 158 296" hand={[160, 296]} />
      <Arm part="arm-r" d="M262 268 Q 278 296 242 296" hand={[240, 296]} />
    </CritterFrame>
  );
}
