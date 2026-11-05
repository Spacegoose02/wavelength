import { useRef } from 'react';
import { Arm, Body, BodyOutfits, CritterFrame, Head, Legs, TORSO } from './parts';
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
 * The keys light up with the spectrum, the left hand hops on the beat, the right glides along the keys with
 * the highs, the beam brightens with the bass and the saucer's lights chase. Paused, the hands rest.
 */
export function Synth({ species, still }: ActProps) {
  const { Tail } = species;
  const root = useRef<SVGSVGElement>(null);
  const state = useRef({ pulse: 0, glide: 0 });

  useCritterRig(
    root,
    ({ t, a, idle, bob, rock, $ }) => {
      const s = state.current;
      const svg = root.current!;
      s.glide += ((idle ? 0 : a.live ? Math.min(1, a.treble * 1.8) * 2 - 1 : Math.sin(t * 0.8)) - s.glide) * 0.1;
      const hop = idle ? 0 : a.live ? bob * 8 : Math.max(0, Math.sin(t * 4)) * 6;
      $('arm-l').setAttribute('transform', `rotate(${(-hop + (idle ? 4 : 0)).toFixed(2)} 138 268)`);
      $('arm-r').setAttribute('transform', `rotate(${(-s.glide * 18 + rock * 3).toFixed(2)} 262 268)`);

      const bins = a.freq.length;
      svg.querySelectorAll<SVGElement>('[data-key]').forEach((k, i) => {
        const v = a.playing ? a.freq[Math.floor(((i + 0.5) / KEYS.length) * bins * 0.6)] ?? 0 : 0;
        k.style.opacity = v > 0.45 ? '1' : '0';
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
    <CritterFrame ref={root} kind="synth" species={species.id} label={`A ${species.noun} playing a synth in a wheat field`}>
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

      {Tail && <Tail />}

      {/* black trousers and boots */}
      <Legs species={species}>
        <path className="legs" d="M160 296 H186 V352 H160 Z M214 296 H240 V352 H214 Z" />
        <path className="boot-black" d="M154 346 H190 V366 H146 Q 146 352 154 346 Z" />
        <path className="boot-black" d="M210 346 H246 Q 254 352 254 366 H210 Z" />
      </Legs>

      <Body species={species}>
        <path className="top" d={TORSO} />
        <BodyOutfits />
      </Body>

      <Head species={species} />

      {/* the synth on an X stand */}
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
      <Arm part="arm-l" d="M138 268 Q 136 292 158 298" hand={[160, 298]} thumb={[166, 292]} />
      <Arm part="arm-r" d="M262 268 Q 264 292 242 298" hand={[240, 298]} thumb={[234, 292]} />
    </CritterFrame>
  );
}
