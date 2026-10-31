import { useRef } from 'react';
import { BodyOutfits, CritterFrame, Head } from './parts';
import { useCritterRig } from './rig';

/** The grey's face for `Head`: a big bulb head with a pointed chin and huge black eyes, on the shared skeleton. */
function GreyFace() {
  return (
    <>
      <path className="grey-skin" d="M200 92 C 272 92 298 140 290 180 C 282 216 236 248 200 254 C 164 248 118 216 110 180 C 102 140 128 92 200 92 Z" />
      <path className="grey-shade" d="M150 104 C 112 124 102 160 110 186 C 118 218 160 246 196 254 C 160 238 126 208 122 176 C 118 146 128 120 150 104 Z" />
      <ellipse cx="248" cy="116" rx="20" ry="7" transform="rotate(28 248 116)" fill="rgb(255 255 255 / 0.55)" />
      <circle cx="226" cy="104" r="2" fill="rgb(255 255 255 / 0.7)" /><circle cx="234" cy="102" r="1.6" fill="rgb(255 255 255 / 0.7)" />
      <path className="grey-line" d="M126 150 Q 150 128 186 148 M274 150 Q 250 128 214 148" fill="none" strokeWidth="2" strokeLinecap="round" />
      <g data-part="eyes">
        <ellipse cx="160" cy="168" rx="34" ry="22" fill="#0b0b0d" transform="rotate(22 160 168)" />
        <ellipse cx="240" cy="168" rx="34" ry="22" fill="#0b0b0d" transform="rotate(-22 240 168)" />
        <ellipse cx="152" cy="160" rx="7" ry="4.5" fill="#fff" transform="rotate(-10 152 160)" />
        <ellipse cx="246" cy="160" rx="7" ry="4" fill="#fff" transform="rotate(-25 246 160)" />
      </g>
      <path className="grey-line" d="M194 204 h4 M202 204 h4" fill="none" strokeWidth="2.5" strokeLinecap="round" />
      <path data-part="smile" d="M188 222 Q 200 230 212 222" fill="none" className="grey-line" strokeWidth="2.5" strokeLinecap="round" />
      <ellipse data-part="yawn" cx="200" cy="226" rx="8" ry="9" fill="#2a2030" transform="scale(1 0)" />
    </>
  );
}

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
export function Grey({ still }: { still?: boolean }) {
  const root = useRef<SVGSVGElement>(null);
  const state = useRef({ pulse: 0, glide: 0 });

  useCritterRig(
    root,
    ({ t, a, idle, bob, rock, $ }) => {
      const s = state.current;
      const svg = root.current!;
      s.glide += ((idle ? 0 : a.live ? Math.min(1, a.treble * 1.8) * 2 - 1 : Math.sin(t * 0.8)) - s.glide) * 0.1;
      const hop = idle ? 0 : a.live ? bob * 8 : Math.max(0, Math.sin(t * 4)) * 6;
      $('arm-l').setAttribute('transform', `rotate(${(hop + (idle ? -4 : 0)).toFixed(2)} 180 262)`);
      $('arm-r').setAttribute('transform', `rotate(${(-s.glide * 22 + rock * 3).toFixed(2)} 220 262)`);

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
    <CritterFrame ref={root} kind="grey" label="A grey alien playing a synth in a wheat field">
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

      {/* slim legs and long feet */}
      <path className="grey-skin" d="M184 296 H196 V350 H184 Z M204 296 H216 V350 H204 Z" />
      <ellipse className="grey-skin" cx="186" cy="352" rx="12" ry="5" />
      <ellipse className="grey-skin" cx="214" cy="352" rx="12" ry="5" />

      <g data-part="body">
        <rect className="grey-skin" x="191" y="236" width="18" height="20" />
        <path className="grey-skin" d="M170 304 C 170 270 178 252 200 250 C 222 252 230 270 230 304 Z" />
        <path className="grey-shade" d="M176 300 C 176 274 182 258 194 252 C 184 262 182 280 184 300 Z" />
        <BodyOutfits />
      </g>

      <Head face={<GreyFace />} />

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

      {/* long thin arms with three-fingered hands on the keys */}
      <g data-part="arm-l">
        <path className="grey-arm" d="M180 262 Q 160 278 162 296" fill="none" strokeWidth="10" strokeLinecap="round" />
        <circle className="grey-skin hand" cx="162" cy="298" r="7" />
        <path className="grey-finger" d="M157 302 l -3 8 M162 304 v 8 M167 302 l 3 8" fill="none" strokeWidth="3" strokeLinecap="round" />
      </g>
      <g data-part="arm-r">
        <path className="grey-arm" d="M220 262 Q 240 278 238 296" fill="none" strokeWidth="10" strokeLinecap="round" />
        <circle className="grey-skin hand" cx="238" cy="298" r="7" />
        <path className="grey-finger" d="M233 302 l -3 8 M238 304 v 8 M243 302 l 3 8" fill="none" strokeWidth="3" strokeLinecap="round" />
      </g>
    </CritterFrame>
  );
}
