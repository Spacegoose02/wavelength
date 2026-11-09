import { useRef } from 'react';
import { beatClock } from './arm';
import { swell, windUp } from './flourish';
import { newGuitarHands, playGuitar } from './guitar';
import { Arm, ArmHand, Body, BodyOutfits, CritterFrame, Head, Legs, Shadow, Skirt } from './parts';
import type { ActProps } from './species';
import { useCritterRig } from './rig';

const f1 = (n: number) => n.toFixed(1);

/** The offset electric's body (neck along +x): a lopsided waist, the upper horn longer than the lower. */
const AXE = 'M-50 -6 C -56 -30, -40 -40, -20 -34 C -4 -30, 10 -38, 30 -40 C 46 -42, 52 -30, 40 -20 C 34 -14, 40 -10, 46 -8 L 46 8 C 40 12, 36 18, 40 26 C 44 36, 30 42, 14 36 C -2 30, -14 40, -32 38 C -52 36, -58 18, -50 -6 Z';
/** Seagulls: x, y. */
const GULLS: [number, number][] = [[64, 96], [96, 76], [300, 62]];

/**
 * Surf rock on the beach: a tank top with a wave print, a shell necklace and shades, playing an offset electric
 * guitar barefoot on the sand by the sea, with surfboards stuck in the sand, a palm and gulls. Only the sea, the
 * sand and the props are drawn, so the album colours show through as the sky, like the first scenes. The tank
 * top, the guitar and the boards take the skin's colours; the sand and the sea are fixed. Strums eighth notes in
 * time with a twangy wobble on the whammy bar on strong highs; the waves roll in on the beat and the gulls bob.
 * Flourish: a whammy dive, the guitar tipped down then up while a wave breaks behind. Paused, the hands rest.
 */
export function Surf({ species, still }: ActProps) {
  const root = useRef<SVGSVGElement>(null);
  const hands = useRef(newGuitarHands());
  const drift = useRef(0);

  useCritterRig(
    root,
    (f) => {
      const { t, a, idle, bob, hit, rock, flourish, $ } = f;
      const svg = root.current!;
      playGuitar(f, hands.current, 24, 1.15, 2);
      // the whammy bar wobbles on strong highs, and dives on a flourish
      const dive = flourish ? Math.sin(windUp(flourish) * Math.PI * 2) * 10 : 0;
      if (flourish || hit) $('guitar').setAttribute('transform', `rotate(${f1(dive + (hit ? rock * 1.5 : 0))} 200 320)`);
      $('whammy').setAttribute('transform', `rotate(${f1(hit ? rock * 8 : flourish ? dive * 2 : 0)} -24 22)`);

      // waves roll in, a little faster with the bass; a big one breaks on a flourish
      const { phase, index } = beatClock(f);
      drift.current += (0.25 + (a.playing ? a.bass * 0.8 : 0)) / 60;
      svg.querySelectorAll<SVGElement>('[data-wave]').forEach((w, i) => {
        w.setAttribute('transform', `translate(${f1(((drift.current * (12 + i * 6)) % 48) - 48)} ${f1(a.playing ? Math.sin(Math.PI * (index + phase) + i) * 1.5 : 0)})`);
      });
      const roll = idle ? Math.sin(t * 0.6) * 0.5 : Math.sin(Math.PI * 2 * phase) * 3;
      $('foam').setAttribute('transform', `translate(0 ${f1(roll)})`);
      const crest = swell(flourish);
      $('breaker').setAttribute('transform', `translate(0 ${f1(40 - crest * 40)})`);
      $('breaker').style.opacity = crest.toFixed(2);
      svg.querySelectorAll<SVGElement>('[data-gull]').forEach((g, i) => {
        const [x, y] = GULLS[i];
        g.setAttribute('transform', `translate(${f1(x + Math.sin(t * 0.4 + i * 2) * 14)} ${f1(y + Math.sin(t * 1.3 + i) * 4 - bob * 2)}) scale(1 ${(0.6 + Math.abs(Math.sin(t * 5 + i)) * 0.6).toFixed(2)})`);
      });
      $('palm').setAttribute('transform', `rotate(${f1(Math.sin(t * 0.9) * 2 + (a.playing ? a.bass * 2 : 0))} 372 380)`);
    },
    { still, nod: 12 },
  );

  return (
    <CritterFrame ref={root} kind="surf" species={species} label={`A ${species.noun} playing surf guitar on the beach`}>
      {/* the sea, with a wave that breaks behind on a flourish, gulls overhead */}
      <path className="surf-sea" d="M0 236 Q 200 228 400 236 V312 H0 Z" />
      <g data-part="breaker" style={{ opacity: 0 }}>
        <path className="surf-crest" d="M-10 252 Q 60 196 120 236 Q 150 214 190 236 Q 260 190 320 232 Q 360 206 410 236 V260 H-10 Z" />
      </g>
      {[250, 268, 288].map((y, i) => (
        <path key={y} data-wave="" className="wave-line" d={`M-48 ${y} ${Array.from({ length: 10 }, () => 'q 12 -5 24 0 q 12 5 24 0').join(' ')}`} fill="none" strokeWidth={2 + i * 0.5} strokeLinecap="round" />
      ))}
      {GULLS.map(([x, y]) => (
        <g key={x} data-gull="" transform={`translate(${x} ${y})`}>
          <path className="gull" d="M-10 0 Q -5 -6 0 0 Q 5 -6 10 0" fill="none" strokeWidth="2.4" strokeLinecap="round" />
        </g>
      ))}
      <path className="sand" d="M0 310 Q 100 302 200 308 T 400 306 V400 H0 Z" />
      <path data-part="foam" className="foam" d="M0 308 Q 50 300 100 306 T 200 306 T 300 304 T 400 306" fill="none" strokeWidth="5" strokeLinecap="round" />
      <path className="sand-dark" d="M24 362 q 16 -5 32 0 M318 392 q 20 -6 40 0 M140 392 q 14 -4 28 0" fill="none" strokeWidth="2.5" strokeLinecap="round" />
      <path className="seashell ol-thin" d="M286 382 q 8 -12 16 0 Z" />

      {/* surfboards stuck in the sand on the left */}
      {[[34, -8, 'board'], [70, 6, 'board board-2']].map(([x, r, cls]) => (
        <g key={x as number} transform={`rotate(${r} ${x} 350)`}>
          <Shadow cx={x as number} cy={352} rx={16} ry={3} />
          <path className={`${cls} ol`} d={`M${x} 196 C ${(x as number) + 18} 226, ${(x as number) + 18} 320, ${x} 352 C ${(x as number) - 18} 320, ${(x as number) - 18} 226, ${x} 196 Z`} />
          <path d={`M${x} 204 V346`} className="board-stripe" strokeWidth="3" />
        </g>
      ))}

      {/* a palm leaning in from the right */}
      <g data-part="palm">
        <path className="palm-trunk" d="M372 380 Q 368 250 330 150" fill="none" strokeWidth="12" strokeLinecap="round" />
        <path className="palm-ring" d="M364 340 l 10 -2 M362 290 l 10 -2 M354 240 l 10 -3 M344 194 l 9 -3" fill="none" strokeWidth="2" />
        <path className="frond" d="M330 150 Q 366 122 412 146 Q 372 138 330 150 Z M330 150 Q 296 116 260 136 Q 296 134 330 150 Z M330 150 Q 346 102 380 98 Q 350 116 330 150 Z M330 150 Q 306 102 276 98 Q 312 118 330 150 Z M330 150 Q 314 178 302 202 Q 326 176 330 150 Z" />
        <circle className="coconut" cx="326" cy="156" r="6" /><circle className="coconut" cx="336" cy="158" r="6" />
      </g>

      <Shadow cx={200} cy={364} rx={62} />
      {/* bare legs and feet in the sand */}
      <Legs species={species} legs="bare" />

      <Body species={species}>
        {/* a tank top with a wave print and a shell necklace */}
        <path className="tank-wave" d="M120 312 q 14 -14 28 0 q 14 -14 28 0 q 14 -14 28 0 q 14 -14 28 0 q 14 -14 28 0 q 14 -14 28 0 V400 H120 Z" />
        <path d="M120 312 q 14 -14 28 0 q 14 -14 28 0 q 14 -14 28 0 q 14 -14 28 0 q 14 -14 28 0 q 14 -14 28 0" fill="none" stroke="rgb(255 255 255 / 0.7)" strokeWidth="3" />
        <path d="M164 248 Q 200 282 236 248" fill="none" stroke="#6b4a2a" strokeWidth="1.6" />
        {[0.15, 0.32, 0.5, 0.68, 0.85].map((u) => {
          const x = 164 + 72 * u;
          const y = 248 + Math.sin(u * Math.PI) * 24;
          return <circle key={u} className="shell-bead ol-thin" cx={f1(x)} cy={f1(y)} r={u === 0.5 ? 4.5 : 3.2} />;
        })}
        <BodyOutfits />
      </Body>
      <Skirt species={species} style="ruffle" className="skirt-alt" />

      <Head
        species={species}
        eyewear={
          <g className="own-eyewear">
            {/* round-cornered shades */}
            <path className="shades ol-thin" d="M140 156 H190 Q 192 182 166 184 Q 142 182 140 156 Z M210 156 H260 Q 258 182 234 184 Q 208 182 210 156 Z" />
            <path d="M190 160 Q 200 154 210 160" fill="none" stroke="#111" strokeWidth="3" />
            <path d="M148 162 L 160 160 M218 162 L 230 160" stroke="rgb(255 255 255 / 0.55)" strokeWidth="3" strokeLinecap="round" />
          </g>
        }
      />

      <Arm part="arm-r" d="M262 268 Q 260 310 304 262" hand={[304, 262]} handLater />

      {/* the offset electric, neck up to the right */}
      <g data-part="guitar">
        <g transform="translate(172 318) rotate(-24)">
          <path className="surf-axe" d={AXE} />
          <path d={AXE} fill="none" stroke="#111" strokeWidth="2" />
          <path d={AXE} fill="url(#critter-vinyl)" />
          <path className="surf-guard" d="M-36 -22 C -20 -26, 10 -30, 30 -32 L 44 -10 V10 L 20 26 C 0 22, -20 30, -36 24 C -44 10, -44 -10, -36 -22 Z" />
          {[-14, 14].map((x) => <rect key={x} x={x - 5} y="-11" width="10" height="22" rx="2" className="pickup" />)}
          <rect x="-34" y="-8" width="8" height="16" rx="1.5" fill="#c9c9d1" />
          <circle cx="-30" cy="24" r="3" fill="#d8d8de" /><circle cx="-18" cy="28" r="3" fill="#d8d8de" />
          <g data-part="whammy">
            <path d="M-24 22 Q -40 32 -58 30" fill="none" stroke="#d8d8de" strokeWidth="2.2" strokeLinecap="round" />
          </g>
          <rect className="fretboard" x="44" y="-6" width="140" height="12" rx="1" />
          {[66, 88, 108, 126, 142, 156, 170].map((x) => <path key={x} d={`M${x} -6 V6`} stroke="#9a9aa4" strokeWidth="1" />)}
          {[98, 134, 163].map((x) => <circle key={x} cx={x} cy="0" r="1.8" fill="#e8e8ee" />)}
          <path className="surf-head" d="M182 -7 L 214 -14 Q 222 -10 218 -2 L 206 8 L 182 7 Z" />
          {[192, 200, 208].map((x) => <circle key={x} cx={x} cy={f1(-9 - (x - 192) * 0.2)} r="2.4" fill="#d8d8de" />)}
          <g data-part="strings">
            {[-4, -2.4, -0.8, 0.8, 2.4, 4].map((y) => <path key={y} d={`M-30 ${y} H200`} stroke="#eef" strokeWidth="0.8" />)}
          </g>
        </g>
      </g>

      <Arm part="arm-l" d="M138 268 Q 146 302 180 312" hand={[182, 312]} />
      <ArmHand part="arm-r" d="M262 268 Q 260 310 304 262" hand={[304, 262]} />
    </CritterFrame>
  );
}
