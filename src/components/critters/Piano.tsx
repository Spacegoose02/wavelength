import { useRef } from 'react';
import { beatClock, bend, lift } from './arm';
import { swell, windUp } from './flourish';
import { Arm, Body, BodyOutfits, CritterFrame, Head, Legs, Shadow, Skirt } from './parts';
import type { ActProps } from './species';
import { useCritterRig } from './rig';

/** White keys on the piano: 16 from x 108. */
const KEYS = Array.from({ length: 16 }, (_, i) => 108 + i * 11.5);
/** Music notes floating up: x, where in the climb each starts (0..1), speed, size. */
const NOTES: [number, number, number, number][] = [
  [300, 0, 1, 1], [340, 0.35, 0.8, 0.85], [270, 0.6, 1.2, 0.9], [360, 0.8, 0.9, 1.1], [92, 0.2, 0.9, 0.85], [60, 0.7, 1.1, 1],
];
/** Footlights along the front of the stage. */
const FOOT = [30, 90, 150, 250, 310, 370];

const f1 = (n: number) => n.toFixed(1);

/** An eighth note with its head at 0,0 (drawn about the origin, placed by a transform). */
const NOTE = 'M0 0 m -6 0 a 6 4.5 -20 1 0 12 0 a 6 4.5 -20 1 0 -12 0 M5 -1 V -26 Q 12 -20 16 -12';

/**
 * A grand piano in a jazz lounge: the critter in a tuxedo and bow tie plays stride piano under a spotlight,
 * between red velvet curtains, a neon JAZZ sign glowing on the wall. The bow tie, pocket square and the
 * sign take the skin's colours; the piano is black and the room is fixed. The left hand strides: down to a low
 * bass note on beats one and three, up to a chord on two and four; the right hand runs up and down the keys
 * with the highs, tapping quick notes. The keys light up with the music, the lid lifts on the bass, music
 * notes drift up off the piano, the candles flicker and the footlights chase on the beat. Flourish: a
 * glissando up the keys with the other hand thrown up and a burst of notes. Paused, the hands rest and the
 * notes stop.
 */
export function Piano({ species, still }: ActProps) {
  const root = useRef<SVGSVGElement>(null);
  const state = useRef({ stride: 0, glide: 0, rise: 0, beat: -1, chase: 0 });

  useCritterRig(
    root,
    (f) => {
      const { t, a, idle, bob, flourish, $ } = f;
      const s = state.current;
      const svg = root.current!;
      const { phase, index } = beatClock(f);
      if (index !== s.beat && a.playing) s.chase = (s.chase + 1) % FOOT.length;
      s.beat = index;
      // left hand: stride, a low bass note on 1 and 3 (far left) and a chord on 2 and 4, jumping between them
      const strideTo = idle ? 0 : index % 2 === 0 ? 12 : -2;
      s.stride += (strideTo - s.stride) * 0.35;
      const press = idle ? 0 : lift(phase);
      const show = swell(flourish);
      const gliss = flourish ? windUp(flourish) : 0;
      $('arm-l').setAttribute('transform', `rotate(${(s.stride - show * 70).toFixed(2)} 138 268)`);
      bend($, 'arm-l', { to: [0, -press * 9], wrist: -press * 12, turn: -show * 50 });
      // right hand: runs along the keys with the highs, quick taps from the wrist; flourish: a glissando up the keys
      s.glide += ((idle ? 0 : a.live ? Math.min(1, a.treble * 1.8) * 2 - 1 : Math.sin(t * 0.9)) - s.glide) * 0.1;
      const taps = idle ? 0 : Math.abs(Math.sin(Math.PI * ((phase * 4) % 1)));
      $('arm-r').setAttribute('transform', `rotate(${(flourish ? 22 - gliss * 34 : -s.glide * 9).toFixed(2)} 262 268)`);
      bend($, 'arm-r', { to: [0, -taps * 6], wrist: taps * 10 });

      const bins = a.freq.length;
      svg.querySelectorAll<SVGElement>('[data-key]').forEach((k, i) => {
        const v = a.playing ? a.freq[Math.floor(((i + 0.5) / KEYS.length) * bins * 0.6)] ?? 0 : 0;
        const run = flourish && Math.abs(i / (KEYS.length - 1) - (0.45 + Math.max(0, gliss) * 0.55)) < 0.07;
        k.style.opacity = v > 0.5 || run ? '1' : '0';
      });
      // the lid lifts on the bass
      $('lid').setAttribute('transform', `rotate(${(a.playing ? -bob * 2 - a.bass * 1.5 : 0).toFixed(2)} 236 298)`);
      $('spotlight').style.opacity = (0.16 + (a.playing ? a.bass * 0.2 + bob * 0.06 : 0)).toFixed(2);
      $('sign').style.opacity = (0.75 + (a.playing ? bob * 0.25 : 0) - (Math.sin(t * 23) > 0.97 ? 0.4 : 0)).toFixed(2);

      // notes drift up off the piano, faster with the highs, a burst in the flourish; none while paused
      s.rise += (a.playing ? 0.12 + a.treble * 0.35 + show * 0.8 : 0) / 60;
      svg.querySelectorAll<SVGElement>('[data-note]').forEach((n, i) => {
        const [x, start, speed, size] = NOTES[i];
        const p = (s.rise * speed + start) % 1;
        const y = 280 - p * 220;
        n.setAttribute('transform', `translate(${f1(x + Math.sin(t * 1.5 + i * 2) * 8)} ${f1(y)}) rotate(${f1(Math.sin(t * 2 + i) * 12)}) scale(${(size * 1.35).toFixed(2)})`);
        n.style.opacity = a.playing ? (p < 0.15 ? p / 0.15 : p > 0.75 ? (1 - p) * 4 : 1).toFixed(2) : '0';
      });
      svg.querySelectorAll<SVGElement>('[data-flame]').forEach((fl, i) => {
        const [x, y] = fl.dataset.flame!.split(' ').map(Number);
        const k = 1 + Math.sin(t * 11 + i * 2) * 0.08 + Math.sin(t * 6.7 + i) * 0.06;
        fl.setAttribute('transform', `translate(${x} ${y}) scale(1 ${k.toFixed(3)}) translate(${-x} ${-y})`);
      });
      svg.querySelectorAll<SVGElement>('[data-foot]').forEach((el, i) => {
        el.style.opacity = a.playing ? (i === s.chase || i === (s.chase + 3) % FOOT.length ? '1' : '0.35') : '0.3';
      });
    },
    { still, nod: 10 },
  );

  return (
    <CritterFrame ref={root} kind="piano" species={species} label={`A ${species.noun} playing a grand piano in a jazz lounge`}>
      {/* the lounge: striped wallpaper, a neon sign, the spotlight, curtains, the stage */}
      <rect className="lounge-wall" x="0" y="0" width="400" height="344" />
      {Array.from({ length: 13 }, (_, i) => <rect key={i} className="lounge-stripe" x={i * 32 + 8} y="0" width="12" height="344" />)}
      <g data-part="sign">
        <text x="200" y="58" textAnchor="middle" fontSize="38" fontWeight="900" fontStyle="italic" className="neon-sign" strokeWidth="3" filter="url(#critter-glow)">JAZZ</text>
        <path d={NOTE} transform="translate(116 52) scale(0.9)" className="neon-note" fill="none" strokeWidth="3" strokeLinecap="round" filter="url(#critter-glow)" />
        <path d={NOTE} transform="translate(278 52) scale(0.9)" className="neon-note" fill="none" strokeWidth="3" strokeLinecap="round" filter="url(#critter-glow)" />
      </g>
      <path data-part="spotlight" className="spotlight" d="M176 0 H224 L 300 360 H100 Z" />
      {/* curtains: swags either side and a scalloped valance across the top */}
      <path className="curtain" d="M0 0 H78 Q 64 120 40 200 Q 24 260 30 344 H0 Z" />
      <path className="curtain-fold" d="M20 0 Q 24 160 12 344 M44 0 Q 40 110 26 220 M62 0 Q 52 80 44 140" fill="none" strokeWidth="3" />
      <path className="curtain" d="M400 0 H322 Q 336 120 360 200 Q 376 260 370 344 H400 Z" />
      <path className="curtain-fold" d="M380 0 Q 376 160 388 344 M356 0 Q 360 110 374 220 M338 0 Q 348 80 356 140" fill="none" strokeWidth="3" />
      <path className="curtain" d={`M0 0 H400 V18 ${Array.from({ length: 8 }, (_, i) => `Q ${f1(400 - i * 50 - 25)} 40 ${f1(400 - (i + 1) * 50)} 18`).join(' ')} Z`} />
      <path className="tassel" d="M0 20 H400" strokeWidth="3" strokeDasharray="2 6" />
      <rect className="stage-boards" x="0" y="344" width="400" height="56" />
      <path className="board-line" d="M0 362 H400 M0 382 H400 M70 344 V362 M190 344 V362 M310 344 V362 M130 362 V382 M250 362 V382 M370 362 V382 M40 382 V400 M160 382 V400 M280 382 V400" fill="none" strokeWidth="1.5" />
      {FOOT.map((x) => <path key={x} data-foot="" className="footlight" d={`M${x - 9} 400 A 9 7 0 0 1 ${x + 9} 400 Z`} />)}

      {/* music notes drifting up */}
      {NOTES.map((_, i) => (
        <path key={i} data-note="" className={`music-note led-${i % 3}`} d={NOTE} strokeWidth="3" strokeLinecap="round" style={{ opacity: 0 }} />
      ))}

      {/* the lid, propped open behind the pianist on the right */}
      <g data-part="lid">
        <path className="piano-lid ol" d="M236 298 L 394 302 L 384 150 Z" />
        <path d="M244 296 L 382 158" stroke="rgb(255 255 255 / 0.12)" strokeWidth="4" />
      </g>
      <path className="lid-prop" d="M330 300 L 352 214" strokeWidth="3" strokeLinecap="round" />

      <Shadow cx={200} cy={362} rx={62} />
      <Legs species={species} shoe="boot-black" />

      <Body species={species}>
        {/* a tuxedo: white shirt front with studs, satin lapels, a bow tie and a pocket square */}
        <path className="shirt-front" d="M178 242 L 200 312 L 222 242 Z" />
        {[268, 282, 296].map((y) => <circle key={y} cx="200" cy={y} r="2" fill="#1b1b22" />)}
        <path className="satin ol-thin" d="M178 242 L 160 286 L 176 280 L 198 316 Z" />
        <path className="satin ol-thin" d="M222 242 L 240 286 L 224 280 L 202 316 Z" />
        <path className="pocket-square" d="M234 290 L 240 280 L 244 288 L 250 282 L 250 294 H234 Z" />
        <path className="bowtie ol-thin" d="M200 256 L 182 246 L 182 268 Z M200 256 L 218 246 L 218 268 Z" />
        <rect className="bowtie-knot ol-thin" x="195" y="251" width="10" height="10" rx="2" />
        <BodyOutfits />
      </Body>
      <Skirt species={species} style="ruffle" />

      <Head species={species} />

      {/* the piano: the curved case, the keys, the legs, a candelabra on the left */}
      <Shadow cx={112} cy={394} rx={16} ry={3} />
      <Shadow cx={300} cy={394} rx={16} ry={3} />
      <path className="piano-leg ol-thin" d="M104 348 L 108 390 H118 L 122 348 Z M292 348 L 296 390 H306 L 310 348 Z" />
      <circle className="caster" cx="113" cy="392" r="4" /><circle className="caster" cx="301" cy="392" r="4" />
      <path className="piano-case ol" d="M94 300 H330 Q 394 300 398 326 L 398 340 Q 360 352 320 352 H94 Z" />
      <path d="M100 338 H320 Q 360 338 392 332" stroke="rgb(255 255 255 / 0.12)" strokeWidth="2" fill="none" />
      <rect x="102" y="296" width="196" height="24" rx="2" fill="#0d0d10" />
      {KEYS.map((x) => (
        <g key={x}>
          <rect x={x} y="298" width="10.6" height="20" rx="1.5" fill="#f4f1e8" />
          <rect data-key="" className="synth-lit" x={x} y="298" width="10.6" height="20" rx="1.5" style={{ opacity: 0 }} />
        </g>
      ))}
      {KEYS.slice(0, -1).map((x, i) => ([2, 6].includes(i % 7) ? null : <rect key={x} x={x + 7.2} y="298" width="6.4" height="12" rx="1" fill="#16161a" />))}
      <text x="200" y="334" textAnchor="middle" fontSize="9" fontWeight="700" letterSpacing="3" className="piano-brand">WAVELENGTH</text>
      {/* candelabra */}
      <path className="brass" d="M104 298 h20 l -4 -6 h-12 Z M114 292 V262 M100 270 Q 100 262 114 262 Q 128 262 128 270 M100 270 V258 M128 270 V258" fill="none" strokeWidth="3" strokeLinecap="round" />
      <path className="brass" d="M104 298 h20 l -4 -6 h-12 Z" />
      {[[100, 258], [114, 250], [128, 258]].map(([x, y]) => (
        <g key={x}>
          <rect className="candle" x={x - 3} y={y - 14} width="6" height="14" rx="1" />
          <circle data-glow="" className="candle-glow" cx={x} cy={y - 20} r="7" />
          <path data-flame={`${x} ${y - 14}`} className="flame-b" d={`M${x} ${y - 14} C ${x - 4} ${y - 18} ${x - 2} ${y - 24} ${x} ${y - 28} C ${x + 2} ${y - 24} ${x + 4} ${y - 18} ${x} ${y - 14} Z`} />
        </g>
      ))}

      {/* hands on the keys */}
      <Arm part="arm-l" d="M138 268 Q 124 300 156 304" hand={[158, 304]} />
      <Arm part="arm-r" d="M262 268 Q 276 300 244 304" hand={[242, 304]} />
    </CritterFrame>
  );
}
