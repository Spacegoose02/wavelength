import { useRef } from 'react';
import { beatClock } from './arm';
import { swell } from './flourish';
import { newGuitarHands, playGuitar } from './guitar';
import { Arm, ArmHand, Body, BodyOutfits, CritterFrame, Head, Legs, Shadow, Skirt } from './parts';
import type { ActProps } from './species';
import { useCritterRig } from './rig';

/** Fairy lights along the top: x, y of each bulb on a sagging wire. */
const BULBS: [number, number][] = Array.from({ length: 9 }, (_, i) => {
  const x = 22 + i * 45;
  return [x, 30 + Math.sin((x / 400) * Math.PI) * 30];
});

const f1 = (n: number) => n.toFixed(1);

/** The acoustic's body: a figure-eight, the lower bout round the bridge, the upper round the sound hole (neck along +x). */
const BODY = 'M-56 0 C -56 -30, -36 -42, -12 -40 C 6 -38, 10 -28, 22 -30 C 42 -33, 64 -24, 64 0 C 64 24, 42 33, 22 30 C 10 28, 6 38, -12 40 C -36 42, -56 30, -56 0 Z';

/**
 * Acoustic in a cosy room: a cardigan over a tee, strumming an acoustic guitar on a rug, with a floor lamp, a
 * potted plant and fairy lights along the top. Nothing behind them but the room's props, so the album colours
 * show through, like the first scenes. The cardigan, the rug and the lights take the skin's colours; the wood is
 * fixed. Strums eighth notes in time (guitar.ts), the strings buzzing with the bass. The lamp's glow and the
 * plant's leaves breathe with the music and the fairy lights twinkle on the beat. Flourish: a big strum with the
 * guitar lifted. Paused, the hands rest on the strings.
 */
export function Acoustic({ species, still }: ActProps) {
  const root = useRef<SVGSVGElement>(null);
  const hands = useRef(newGuitarHands());
  const pulse = useRef(0);

  useCritterRig(
    root,
    (f) => {
      const { t, a, bob, flourish, $ } = f;
      const svg = root.current!;
      playGuitar(f, hands.current, 22, 1.1, 2);
      if (flourish) {
        const up = swell(flourish);
        $('guitar').setAttribute('transform', `rotate(${f1(-12 * up)} 200 320) translate(0 ${f1(-6 * up)})`);
        $('arm-l').setAttribute('transform', `rotate(${f1(-26 * up)} 138 268)`);
      }
      const { index } = beatClock(f);
      if (a.beat) pulse.current = index;
      svg.querySelectorAll<SVGElement>('[data-bulb]').forEach((b, i) => {
        b.style.opacity = (a.playing ? ((i + pulse.current) % 3 === 0 ? 0.65 + bob * 0.35 : 0.5) : 0.45 + Math.sin(t * 0.7 + i) * 0.1).toFixed(2);
      });
      $('lamp-glow').style.opacity = (0.35 + (a.playing ? a.mid * 0.35 : 0) + Math.sin(t * 1.3) * 0.03).toFixed(2);
      svg.querySelectorAll<SVGElement>('[data-leaf]').forEach((l, i) => {
        l.setAttribute('transform', `rotate(${f1(Math.sin(t * 1.2 + i * 1.4) * (2 + (a.playing ? a.bass * 4 : 0)))} 366 330)`);
      });
    },
    { still, nod: 10 },
  );

  return (
    <CritterFrame ref={root} kind="acoustic" species={species} label={`A ${species.noun} playing an acoustic guitar in a cosy room`}>
      {/* fairy lights along the top */}
      <path className="light-wire" d={`M0 26 Q 200 ${f1(26 + 30 * 2)} 400 26`} fill="none" strokeWidth="1.5" />
      {BULBS.map(([x, y], i) => (
        <circle key={x} data-bulb="" className={`led led-${i % 3}`} cx={x} cy={f1(y + 6)} r="4" filter="url(#critter-glow)" />
      ))}

      {/* the floorboards and a round rug */}
      <path className="room-floor" d="M0 336 Q 200 328 400 336 V400 H0 Z" />
      <path className="room-board" d="M0 356 H400 M0 378 H400 M80 336 L 70 400 M210 334 L 214 400 M330 336 L 366 400" fill="none" strokeWidth="1.5" />
      <ellipse className="rug" cx="200" cy="372" rx="150" ry="22" />
      <ellipse className="rug-ring" cx="200" cy="372" rx="128" ry="16" fill="none" strokeWidth="3" strokeDasharray="8 6" />

      {/* a floor lamp on the left */}
      <circle data-part="lamp-glow" className="lamp-glow" cx="52" cy="150" r="56" />
      <Shadow cx={52} cy={352} rx={22} ry={4} />
      <path className="lamp-pole" d="M52 166 V346 M36 350 H68" fill="none" strokeWidth="5" strokeLinecap="round" />
      <path className="lamp-shade ol" d="M28 166 L 38 124 H66 L 76 166 Z" />
      <path d="M32 158 H72" stroke="rgb(0 0 0 / 0.15)" strokeWidth="3" />

      {/* a potted plant on the right */}
      <Shadow cx={366} cy={352} rx={26} ry={4} />
      {[[-34, 0], [-12, 1], [12, 2], [34, 3], [0, 4]].map(([r, i]) => (
        <g key={i} data-leaf="">
          <path className={i % 2 ? 'leaf leaf-2 ol-thin' : 'leaf ol-thin'} d={`M366 330 Q ${366 + r * 1.6} ${260 - Math.abs(r) * 0.6} ${366 + r * 2.2} ${236 + Math.abs(r)} Q ${366 + r * 0.6} ${280} 366 330 Z`} />
        </g>
      ))}
      <path className="pot ol" d="M342 314 H390 L 384 350 H348 Z" />
      <path className="pot-rim" d="M340 314 H392" strokeWidth="6" strokeLinecap="round" />

      <Shadow cx={200} cy={364} rx={64} />
      <Legs species={species} shoe="sneaker" />

      <Body species={species}>
        {/* a cardigan open over a cream tee, with buttons down one side */}
        <rect className="tee-under" x="178" y="240" width="44" height="120" />
        <path className="cardigan" d="M100 400 V250 Q 150 240 184 244 L 178 400 Z" />
        <path className="cardigan" d="M300 400 V250 Q 250 240 216 244 L 222 400 Z" />
        <path d="M184 244 L 178 400 M216 244 L 222 400" stroke="rgb(0 0 0 / 0.25)" strokeWidth="2.5" fill="none" />
        {[270, 290, 310].map((y) => <circle key={y} className="cardigan-button" cx="181" cy={y} r="2.6" />)}
        <BodyOutfits />
      </Body>
      <Skirt species={species} style="pleated" className="skirt-alt" />

      <Head species={species} />

      <Arm part="arm-r" d="M262 268 Q 262 308 306 262" hand={[306, 262]} handLater />

      {/* the acoustic guitar, neck up to the right */}
      <g data-part="guitar">
        <g transform="translate(168 318) rotate(-22)">
          <path className="acoustic-body" d={BODY} />
          <path d={BODY} className="acoustic-edge" fill="none" strokeWidth="3" />
          <path d={BODY} fill="url(#critter-vinyl)" />
          <circle cx="24" cy="0" r="13" className="acoustic-rosette" />
          <circle cx="24" cy="0" r="10" className="acoustic-hole" />
          <path className="acoustic-guard" d="M2 4 Q 4 26 22 24 Q 30 18 14 12 Z" />
          <rect className="acoustic-bridge" x="-30" y="-12" width="8" height="24" rx="2" />
          <rect className="neck" x="62" y="-6" width="138" height="12" rx="2" />
          {[86, 106, 124, 140, 154, 168, 180, 192].map((x) => <path key={x} d={`M${x} -6 V6`} stroke="#c9b48a" strokeWidth="1.2" />)}
          {[115, 147, 174].map((x) => <circle key={x} cx={x} cy="0" r="1.6" fill="#f2ead8" />)}
          <path className="neck" d="M198 -8 L 230 -11 Q 234 0 230 11 L 198 8 Z" />
          {[206, 216, 226].map((x) => <g key={x}><circle cx={x} cy="-12" r="2.6" fill="#d8d8de" /><circle cx={x} cy="12" r="2.6" fill="#d8d8de" /></g>)}
          <g data-part="strings">
            {[-4, -2.4, -0.8, 0.8, 2.4, 4].map((y) => <path key={y} d={`M-26 ${y} H222`} stroke="#d8d0c0" strokeWidth="0.8" />)}
          </g>
        </g>
      </g>

      {/* the strumming hand over the sound hole; only the fretting arm goes behind the neck */}
      <Arm part="arm-l" d="M138 268 Q 146 302 178 312" hand={[180, 312]} />
      <ArmHand part="arm-r" d="M262 268 Q 262 308 306 262" hand={[306, 262]} />
    </CritterFrame>
  );
}
