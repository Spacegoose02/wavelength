import { useRef } from 'react';
import { beatClock, bend, lift } from './arm';
import { swell, windUp } from './flourish';
import { Arm, Body, BodyOutfits, CritterFrame, Head, Legs, Shadow, Skirt } from './parts';
import type { ActProps } from './species';
import { useCritterRig } from './rig';

const STARS: [number, number, number][] = [
  [22, 40, 1.4], [70, 110, 1.2], [120, 24, 1.6], [300, 18, 1.3], [352, 96, 1.6], [384, 30, 1.2],
  [36, 190, 1.1], [376, 200, 1.3], [96, 60, 1], [330, 150, 1],
];

/** White keys on the synth: 14 from x 118. */
const KEYS = Array.from({ length: 14 }, (_, i) => 118 + i * 11.7);

/**
 * Grey alien in a wheat field at night, playing a synth under the tractor beam of its saucer: the classic
 * big-headed grey with huge black eyes and a slim grey body. The synth and the beam take the skin's colours.
 * The keys light up with the spectrum; the elbows bend to play: the left hand presses a chord on each beat
 * and moves to a new one now and then, the right taps sixteenth notes while it glides along the keys with the highs, the beam brightens with the bass and the saucer's lights chase. Flourish: a glissando down the
 * keys with the other hand thrown up. Paused, the hands rest.
 */
export function Synth({ species, still }: ActProps) {
  const root = useRef<SVGSVGElement>(null);
  const state = useRef({ pulse: 0, glide: 0, chord: 0, chordTo: 0, beat: 0 });

  useCritterRig(
    root,
    (f) => {
      const { t, a, idle, bob, rock, flourish, $ } = f;
      const s = state.current;
      const svg = root.current!;
      const { phase, index } = beatClock(f);
      // left hand: a chord on each beat, pressed down on the beat and lifted between, moving to a new chord
      // shape now and then; right hand: a run of quick notes, gliding up and down the keys with the highs
      const onBeat = index !== s.beat;
      s.beat = index;
      if (onBeat && Math.random() < 0.4) s.chordTo = [-9, -3, 3, 8][Math.floor(Math.random() * 4)];
      if (idle) s.chordTo = 0;
      s.chord += (s.chordTo - s.chord) * 0.25;
      s.glide += ((idle ? 0 : a.live ? Math.min(1, a.treble * 1.8) * 2 - 1 : Math.sin(t * 0.8)) - s.glide) * 0.1;
      const press = idle ? 0 : lift(phase);
      // sixteenth-note taps on the right hand
      const taps = idle ? 0 : Math.abs(Math.sin(Math.PI * ((phase * 4) % 1)));
      $('arm-l').setAttribute('transform', `rotate(${(-s.chord * 0.5 + (idle ? 4 : 0)).toFixed(2)} 138 268)`);
      bend($, 'arm-l', { to: [s.chord * 0.6, -press * 9], wrist: -press * 14 });
      // flourish: a glissando, the hand sweeping down the keys with the lit key running ahead of it, the other
      // hand thrown up
      const gliss = flourish ? windUp(flourish) : 0;
      $('arm-r').setAttribute('transform', `rotate(${(flourish ? -18 + gliss * 40 : -s.glide * 10 + rock * 3).toFixed(2)} 262 268)`);
      bend($, 'arm-r', { to: [s.glide * -4, -taps * 6], wrist: taps * 10 });
      if (flourish) {
        $('arm-l').setAttribute('transform', `rotate(${(-70 * swell(flourish)).toFixed(2)} 138 268)`);
        bend($, 'arm-l', { turn: -60 * swell(flourish) });
      }

      const bins = a.freq.length;
      svg.querySelectorAll<SVGElement>('[data-key]').forEach((k, i) => {
        const v = a.playing ? a.freq[Math.floor(((i + 0.5) / KEYS.length) * bins * 0.6)] ?? 0 : 0;
        const run = flourish && Math.abs(i / (KEYS.length - 1) - (1 - Math.max(0, gliss))) < 0.08;
        k.style.opacity = v > 0.45 || run ? '1' : '0';
      });
      $('beam').style.opacity = (0.12 + (a.playing ? a.bass * 0.4 + bob * 0.15 : 0.04)).toFixed(2);
      $('saucer').setAttribute('transform', `translate(0 ${(Math.sin(t * 1.2) * 3).toFixed(2)})`);
      const lights = svg.querySelectorAll<SVGElement>('[data-saucer]');
      if (a.beat) s.pulse = (s.pulse + 1) % lights.length;
      lights.forEach((el, i) => (el.style.opacity = a.playing ? ((i + s.pulse) % 3 === 0 ? '1' : '0.3') : '0.2'));
      svg.querySelectorAll<SVGElement>('[data-star]').forEach((el, i) => {
        el.style.opacity = (0.35 + 0.3 * Math.sin(t * (1.2 + (i % 3) * 0.5) + i) + (a.playing ? a.treble * 0.4 : 0)).toFixed(2);
      });
    },
    { still, nod: 10 },
  );

  return (
    <CritterFrame ref={root} kind="synth" species={species} label={`A ${species.noun} playing a synth in a wheat field`}>
      {/* night sky, the saucer and its beam, a wheat field with a crop circle */}
      {STARS.map(([cx, cy, r]) => <circle key={`${cx},${cy}`} data-star="" cx={cx} cy={cy} r={r} fill="#fff" />)}
      <path data-part="beam" className="beam" d="M172 52 L 228 52 L 330 350 L 70 350 Z" />
      <g data-part="saucer">
        <ellipse cx="200" cy="34" rx="20" ry="14" fill="rgb(180 230 255 / 0.55)" stroke="rgb(255 255 255 / 0.5)" strokeWidth="1.5" />
        <ellipse className="ufo" cx="200" cy="44" rx="58" ry="13" />
        <ellipse className="ufo-rim" cx="200" cy="49" rx="54" ry="5" />
        {[0, 1, 2, 3, 4, 5].map((i) => <circle key={i} data-saucer="" className={`led led-${i % 3}`} cx={160 + i * 16} cy="44" r="3.5" />)}
      </g>
      <path className="field" d="M0 330 Q 200 318 400 330 V400 H0 Z" />
      <ellipse className="crop-circle" cx="200" cy="368" rx="150" ry="20" fill="none" strokeWidth="3" />
      <ellipse className="crop-circle" cx="200" cy="368" rx="96" ry="12" fill="none" strokeWidth="2.5" />
      {Array.from({ length: 20 }, (_, i) => {
        const x = 8 + i * 20;
        return <path key={x} className="wheat" d={`M${x} 336 q -2 -14 2 -24 M${x + 8} 338 q 2 -12 -1 -22`} fill="none" strokeWidth="2.5" strokeLinecap="round" />;
      })}

      <Shadow cx={200} cy={366} rx={66} />

      {/* black trousers and boots */}
      <Legs species={species} shoe="boot-black" />

      <Body species={species}>
        <BodyOutfits />
      </Body>
      <Skirt species={species} style="ruffle" />

      <Head species={species} />

      {/* the synth on an X stand */}
      <Shadow cx={200} cy={373} rx={52} ry={4} />
      <path className="stand" d="M160 322 L 240 372 M240 322 L 160 372" fill="none" strokeWidth="4" strokeLinecap="round" />
      <rect className="synth" x="110" y="290" width="180" height="34" rx="6" />
      <rect x="114" y="296" width="172" height="22" rx="2" fill="#0d0d10" />
      {KEYS.map((x) => (
        <g key={x}>
          <rect x={x} y="298" width="10.2" height="18" rx="1.5" fill="#ececf1" />
          <rect data-key="" className="synth-lit" x={x} y="298" width="10.2" height="18" rx="1.5" style={{ opacity: 0 }} />
        </g>
      ))}
      {KEYS.slice(0, -1).map((x, i) => ([2, 6].includes(i % 7) ? null : <rect key={x} x={x + 7} y="298" width="6.5" height="11" rx="1" fill="#16161a" />))}
      <rect className="synth-trim" x="110" y="290" width="180" height="5" rx="2" />

      {/* hands on the keys */}
      <Arm part="arm-l" d="M138 268 Q 122 298 158 298" hand={[160, 298]} />
      <Arm part="arm-r" d="M262 268 Q 278 298 242 298" hand={[240, 298]} />
    </CritterFrame>
  );
}
