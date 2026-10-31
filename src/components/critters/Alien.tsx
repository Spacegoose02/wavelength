import { useRef } from 'react';
import { Arm, BodyOutfits, CritterFrame, Head, TORSO } from './parts';
import { useCritterRig } from './rig';

/** The alien's face for `Head`: a bulb-shaped green head with big black eyes, on the shared skeleton. */
function AlienFace() {
  return (
    <>
      <path className="alien-skin" d="M200 104 C 268 104 290 150 282 182 C 274 222 238 246 200 246 C 162 246 126 222 118 182 C 110 150 132 104 200 104 Z" />
      <path className="alien-dark" d="M150 124 q 6 -4 12 0 M238 124 q 6 -4 12 0 M196 116 q 4 -3 8 0" fill="none" strokeWidth="3" strokeLinecap="round" />
      <circle className="alien-dark" cx="138" cy="200" r="4" /><circle className="alien-dark" cx="262" cy="200" r="4" />
      <g data-part="eyes">
        <path d="M130 150 Q 162 142 186 166 Q 180 188 160 186 Q 134 180 130 150 Z" fill="#111" />
        <path d="M270 150 Q 238 142 214 166 Q 220 188 240 186 Q 266 180 270 150 Z" fill="#111" />
        <circle cx="150" cy="158" r="4.5" fill="#fff" />
        <circle cx="232" cy="162" r="4.5" fill="#fff" />
        <circle cx="168" cy="176" r="1.8" fill="#fff" />
        <circle cx="250" cy="176" r="1.8" fill="#fff" />
      </g>
      <circle cx="195" cy="198" r="2.2" fill="#2b4a1f" /><circle cx="205" cy="198" r="2.2" fill="#2b4a1f" />
      <path data-part="smile" d="M184 214 Q 200 226 216 214" fill="none" stroke="#2b4a1f" strokeWidth="3" strokeLinecap="round" />
      <ellipse data-part="yawn" cx="200" cy="220" rx="10" ry="10" fill="#3a1030" transform="scale(1 0)" />
    </>
  );
}

const STARS: [number, number, number][] = [
  [24, 140, 1.6], [130, 36, 1.4], [176, 18, 2], [214, 54, 1.2], [264, 22, 1.6], [290, 120, 1.3],
  [372, 150, 1.8], [384, 20, 1.2], [36, 220, 1.2], [362, 250, 1.4], [150, 92, 1.1], [318, 196, 1.2],
];

/**
 * Theremin alien on the moon, under a hovering UFO. The space suit, the UFO lights and the sound waves take
 * the skin's colours. The left hand rises over the volume loop with the bass, the right moves toward the
 * pitch antenna with the highs and wobbles on sharp hits, waves pour off the antenna, the antennae glow with
 * the bass and the stars twinkle. Paused, the hands drop and the antennae perk up now and then.
 */
export function Alien({ still }: { still?: boolean }) {
  const root = useRef<SVGSVGElement>(null);
  const state = useRef({ pulse: 0, vol: 0, pitch: 0 });

  useCritterRig(
    root,
    ({ t, a, idle, bob, rock, $ }) => {
      const s = state.current;
      const svg = root.current!;
      s.vol += ((idle ? 0 : a.live ? a.bass : 0.4 + Math.sin(t * 1.5) * 0.3) - s.vol) * 0.15;
      s.pitch += ((idle ? 0 : a.live ? Math.min(1, a.treble * 1.6 + a.mid * 0.5) : 0.5 + Math.sin(t * 0.9) * 0.4) - s.pitch) * 0.12;
      const vibrato = a.playing ? Math.sin(t * 14) * 1.5 : 0;
      $('arm-l').setAttribute('transform', `rotate(${(s.vol * 22 - (idle ? 6 : 0)).toFixed(2)} 138 268)`);
      $('arm-r').setAttribute('transform', `rotate(${(s.pitch * 14 + vibrato + rock * 4 - (idle ? 8 : 0)).toFixed(2)} 262 268)`);

      // two sine waves off the pitch antenna: louder with the mids, tighter with the highs
      const amp = a.playing ? 3 + a.mid * 14 + bob * 4 : 0;
      const freq = 0.1 + s.pitch * 0.18;
      ['wave-a', 'wave-b'].forEach((name, i) => {
        let d = '';
        for (let x = 262; x <= 392; x += 4) {
          const fade = (x - 262) / 130;
          const y = 236 + i * 14 + Math.sin(x * freq - t * 9 - i) * amp * (1 - fade * 0.6) * (i ? 0.6 : 1);
          d += `${d ? 'L' : 'M'}${x} ${y.toFixed(1)} `;
        }
        $(name).setAttribute('d', d);
        $(name).style.opacity = a.playing ? '0.9' : '0';
      });

      $('ufo').setAttribute('transform', `translate(${(Math.sin(t * 0.5) * 6).toFixed(2)} ${(Math.sin(t * 1.3) * 4 - bob * 3).toFixed(2)})`);
      const lights = svg.querySelectorAll<SVGElement>('[data-ufo]');
      if (a.beat) s.pulse = (s.pulse + 1) % lights.length;
      lights.forEach((el, i) => (el.style.opacity = a.playing ? ((i + s.pulse) % 3 === 0 ? '1' : '0.3') : '0.2'));
      svg.querySelectorAll<SVGElement>('[data-star]').forEach((el, i) => {
        el.style.opacity = (0.35 + 0.3 * Math.sin(t * (1.3 + (i % 4) * 0.4) + i) + (a.playing ? a.treble * 0.5 : 0)).toFixed(2);
      });
    },
    { still, nod: 10 },
  );

  return (
    <CritterFrame ref={root} kind="alien" label="An alien playing a theremin on the moon">
      {/* space: stars, a ringed planet, the UFO, the moon's surface */}
      {STARS.map(([cx, cy, r]) => <circle key={`${cx},${cy}`} data-star="" cx={cx} cy={cy} r={r} fill="#fff" />)}
      <circle className="planet" cx="336" cy="74" r="22" />
      <ellipse className="planet-ring" cx="336" cy="74" rx="40" ry="8" fill="none" strokeWidth="3" transform="rotate(-18 336 74)" />
      <g data-part="ufo">
        <ellipse cx="78" cy="64" rx="18" ry="14" fill="rgb(180 230 255 / 0.55)" stroke="rgb(255 255 255 / 0.5)" strokeWidth="1.5" />
        <ellipse className="ufo" cx="78" cy="74" rx="46" ry="12" />
        <ellipse className="ufo-rim" cx="78" cy="78" rx="44" ry="5" />
        {[0, 1, 2, 3, 4].map((i) => <circle key={i} data-ufo="" className={`led led-${i % 3}`} cx={50 + i * 14} cy="74" r="3.5" />)}
      </g>
      <path className="moon" d="M0 352 Q 120 340 220 350 T 400 344 V400 H0 Z" />
      <ellipse className="crater" cx="60" cy="376" rx="22" ry="6" />
      <ellipse className="crater" cx="330" cy="384" rx="30" ry="7" />
      <ellipse className="crater" cx="250" cy="364" rx="12" ry="3.5" />

      {/* space-suit trousers and moon boots */}
      <path className="legs" d="M160 296 H188 V348 H160 Z M212 296 H240 V348 H212 Z" />
      <path className="moon-boot" d="M152 342 H192 V364 H146 Q 146 348 152 342 Z" />
      <path className="moon-boot" d="M208 342 H248 Q 254 348 254 364 H208 Z" />

      <g data-part="body">
        <path className="top" d={TORSO} />
        <ellipse className="suit-trim" cx="200" cy="248" rx="48" ry="9" />
        <rect x="178" y="262" width="44" height="22" rx="4" fill="#16161a" />
        {[0, 1, 2].map((i) => <circle key={i} data-glow="" className={`led led-${i}`} cx={188 + i * 12} cy="273" r="4" />)}
        <BodyOutfits />
      </g>

      <Head
        face={<AlienFace />}
        own={
          <g data-part="adjust" className="own-hat">
            <path className="alien-dark" d="M178 110 Q 168 82 154 66 M222 110 Q 232 82 246 66" fill="none" strokeWidth="4" strokeLinecap="round" />
            <circle data-glow="" className="antenna" cx="154" cy="64" r="8" filter="url(#critter-glow)" />
            <circle data-glow="" className="antenna" cx="246" cy="64" r="8" filter="url(#critter-glow)" />
          </g>
        }
      />

      {/* the theremin: a cabinet on a stand, volume loop on the left, pitch antenna on the right */}
      <path className="stand" d="M200 326 V362 L 182 376 M200 362 L 218 376" fill="none" strokeWidth="4" strokeLinecap="round" />
      <path className="rod" d="M140 308 H122 Q 102 308 102 292 Q 102 276 122 276 H130" fill="none" strokeWidth="4" strokeLinecap="round" />
      <path className="rod" d="M254 302 V196" fill="none" strokeWidth="4" strokeLinecap="round" />
      <circle className="rod-tip" cx="254" cy="194" r="4" />
      <rect className="theremin" x="138" y="298" width="124" height="30" rx="5" />
      <rect className="theremin-panel" x="146" y="304" width="108" height="18" rx="3" />
      {[164, 200, 236].map((cx) => <circle key={cx} cx={cx} cy="313" r="5" fill="#d8d8de" stroke="#55555e" strokeWidth="1.5" />)}
      <path data-part="wave-a" className="wave wave-a" d="M262 236" fill="none" strokeWidth="3" strokeLinecap="round" filter="url(#critter-glow)" />
      <path data-part="wave-b" className="wave wave-b" d="M262 250" fill="none" strokeWidth="2.5" strokeLinecap="round" filter="url(#critter-glow)" />

      {/* volume hand over the loop (left of picture), pitch hand by the antenna (right) */}
      <Arm part="arm-l" d="M138 268 Q 114 276 112 262" hand={[112, 258]} thumb={[120, 254]} />
      <Arm part="arm-r" d="M262 268 Q 244 262 234 248" hand={[232, 246]} thumb={[226, 252]} />
    </CritterFrame>
  );
}
