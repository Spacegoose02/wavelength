import { useRef } from 'react';
import { beatClock, bend, lift } from './arm';
import { swell } from './flourish';
import { Arm, Body, BodyOutfits, CritterFrame, Head, Legs, Shadow, Skirt } from './parts';
import type { ActProps } from './species';
import { useCritterRig } from './rig';

/** The two bongos: centre x of each head, their half-widths, and the line the heads sit on. */
const SMALL = 172;
const BIG = 229;
const HEAD_Y = 316;

/** Flowers on the shirt: x, y, size. */
const PRINT: [number, number, number][] = [
  [146, 262, 7], [178, 300, 6], [236, 270, 7], [258, 306, 6], [150, 318, 6], [214, 318, 5], [262, 248, 5],
];
/** Lei flowers round the neck, left to right. */
const LEI = Array.from({ length: 9 }, (_, i) => {
  const u = i / 8;
  return [164 + u * 72, 248 + Math.sin(u * Math.PI) * 22] as const;
});

const f1 = (n: number) => n.toFixed(1);

/** A five-petal flower round `x`,`y`, petals `r` across. */
function Flower({ x, y, r, className }: { x: number; y: number; r: number; className: string }) {
  return (
    <g className={className}>
      {[0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        return <circle key={i} cx={f1(x + Math.cos(a) * r * 0.6)} cy={f1(y + Math.sin(a) * r * 0.6)} r={f1(r * 0.55)} />;
      })}
      <circle className="flower-eye" cx={x} cy={y} r={f1(r * 0.3)} />
    </g>
  );
}

/**
 * On the beach: the critter slaps a pair of bongos on a stand by the sea on a sunny afternoon, in a Hawaiian
 * shirt, a flower lei and a straw hat (girls: a grass skirt and a bow). The shirt, hat band and the bands
 * round the drums take the skin's colours; the sea, sand and palms are fixed. One hand slaps the small drum on every beat,
 * the other the big one on the off-beats (with a quick double when the highs are busy) and both land
 * together at the end of each bar; the heads give under each slap. The waves roll in with the bass, the palms
 * sway, the tiki torches flicker and a little crab scuttles side to side on the beat. Flourish: a fast roll on
 * both drums, then both hands up. Paused, the hands rest on the drums.
 */
export function Bongo({ species, still }: ActProps) {
  const root = useRef<SVGSVGElement>(null);
  const state = useRef({ beat: -1, half: -1, hitL: 0, hitR: 0, sea: 0 });

  useCritterRig(
    root,
    (f) => {
      const { t, a, idle, bob, flourish, $ } = f;
      const s = state.current;
      const svg = root.current!;
      const { phase, index } = beatClock(f);
      const halves = Math.floor((index + phase) * 2);
      const busy = a.live && a.treble > 0.45;
      const lastBeat = index % 4 === 3;
      // the small drum on the beat; the big one on the "and", twice as fast when the highs are busy, and on the
      // last beat of the bar both hands come down together
      const upL = idle ? 0 : lift(phase);
      const upR = idle ? 0 : lastBeat ? upL : busy ? lift((phase * 2 + 0.5) % 1) : lift((phase + 0.5) % 1);
      if (!idle && index !== s.beat) s.hitL = 1;
      if (!idle && halves !== s.half && (halves % 2 === 1 || lastBeat || busy)) s.hitR = 1;
      s.beat = index;
      s.half = halves;
      let l = upL;
      let r = upR;
      // flourish: a fast roll, then both hands thrown up
      const throwUp = flourish > 0.7 ? swell((flourish - 0.7) / 0.3 / 2) : 0;
      if (flourish && flourish <= 0.7) {
        l = Math.abs(Math.sin(t * 34)) * 0.7;
        r = Math.abs(Math.cos(t * 34)) * 0.7;
        if (l < 0.1) s.hitL = 1;
        if (r < 0.1) s.hitR = 1;
      }
      $('arm-l').setAttribute('transform', `rotate(${(l * 4 + throwUp * 70 + (idle ? Math.sin(t * 0.9) : 0)).toFixed(2)} 138 268)`);
      bend($, 'arm-l', { to: [-l * 3, -l * 16], wrist: -l * 22, turn: throwUp * 50 });
      $('arm-r').setAttribute('transform', `rotate(${(-r * 4 - throwUp * 70 - (idle ? Math.sin(t * 0.9) : 0)).toFixed(2)} 262 268)`);
      bend($, 'arm-r', { to: [r * 3, -r * 16], wrist: r * 22, turn: -throwUp * 50 });
      s.hitL *= 0.8;
      s.hitR *= 0.8;
      $('head-small').setAttribute('transform', `translate(${SMALL} ${HEAD_Y}) scale(${(1 + s.hitL * 0.06).toFixed(3)} ${(1 - s.hitL * 0.35).toFixed(3)}) translate(${-SMALL} ${-HEAD_Y})`);
      $('head-big').setAttribute('transform', `translate(${BIG} ${HEAD_Y}) scale(${(1 + s.hitR * 0.06).toFixed(3)} ${(1 - s.hitR * 0.35).toFixed(3)}) translate(${-BIG} ${-HEAD_Y})`);

      // the sea rolls in with the bass, the palms sway, the torches flicker, the clouds drift
      s.sea += (0.4 + (a.playing ? a.bass * 1.6 : 0)) / 60;
      svg.querySelectorAll<SVGElement>('[data-wave]').forEach((w, i) => {
        w.setAttribute('transform', `translate(${f1(((s.sea * (14 + i * 6) + i * 37) % 60) - 30)} 0)`);
      });
      $('foam').setAttribute('transform', `translate(0 ${f1(Math.sin(s.sea * 1.6) * 3 + (a.playing ? -bob * 2 : 0))})`);
      ['palm-l', 'palm-r'].forEach((name, i) => {
        const [x, y] = i ? [350, 112] : [56, 98];
        $(name).setAttribute('transform', `rotate(${f1(Math.sin(t * 0.8 + i * 2) * 3 + (a.playing ? a.bass * 3 * (i ? -1 : 1) : 0))} ${x} ${y})`);
      });
      ['torch-l', 'torch-r'].forEach((name, i) => {
        const x = i ? 304 : 96;
        const k = 1 + Math.sin(t * 13 + i * 3) * 0.06 + Math.sin(t * 7.3 + i) * 0.05 + (a.playing ? bob * 0.12 : 0);
        $(name).setAttribute('transform', `translate(${x} 232) scale(${(1 + Math.sin(t * 9 + i) * 0.05).toFixed(3)} ${k.toFixed(3)}) translate(${-x} -232)`);
      });
      svg.querySelectorAll<SVGElement>('[data-cloud]').forEach((c, i) => {
        c.setAttribute('transform', `translate(${f1(((t * (3 + i * 2) + i * 180) % 520) - 120)} 0)`);
      });
      $('sun-rays').setAttribute('transform', `rotate(${f1(t * 6)} 330 62)`);
      // the crab scuttles one way each beat, pinching on the beat
      const scuttle = a.playing ? Math.sin(Math.PI * (index + phase)) * 12 : 0;
      $('crab').setAttribute('transform', `translate(${f1(scuttle)} ${f1(a.playing ? -Math.abs(Math.sin(Math.PI * 2 * phase)) * 2 : 0)})`);
      const pinch = a.playing ? bob * 18 : 0;
      $('claw-l').setAttribute('transform', `rotate(${f1(-pinch)} 330 368)`);
      $('claw-r').setAttribute('transform', `rotate(${f1(pinch)} 358 368)`);
    },
    { still, nod: 12 },
  );

  return (
    <CritterFrame ref={root} kind="bongo" species={species} label={`A ${species.noun} playing bongos on the beach`}>

      {/* sun and clouds over the sea with an island, the sand: no sky drawn, so the album colours show through */}
      <g data-part="sun-rays">
        {Array.from({ length: 12 }, (_, i) => {
          const ang = (i / 12) * Math.PI * 2;
          return <path key={i} className="sun-ray" d={`M${f1(330 + Math.cos(ang) * 32)} ${f1(62 + Math.sin(ang) * 32)} L${f1(330 + Math.cos(ang) * 44)} ${f1(62 + Math.sin(ang) * 44)}`} strokeWidth="4" strokeLinecap="round" />;
        })}
      </g>
      <circle className="beach-sun" cx="330" cy="62" r="25" />
      {[[60, 0], [260, 1]].map(([y, i]) => (
        <g key={i} data-cloud="">
          <path className="cloud" d={`M${i ? 60 : 140} ${y + 40} q 0 -16 18 -16 q 6 -14 24 -10 q 18 -6 26 10 q 16 0 16 16 Z`} />
        </g>
      ))}
      <rect className="sea" x="0" y="212" width="400" height="96" />
      <rect className="sea-far" x="0" y="212" width="400" height="10" />
      <path className="island" d="M30 216 Q 66 196 104 216 Z" />
      <path className="island-palm" d="M70 206 Q 72 196 68 188 M68 188 q -8 -2 -12 4 M68 188 q 8 -4 12 2 M68 188 q 0 -8 6 -10" fill="none" strokeWidth="2" strokeLinecap="round" />
      {[236, 256, 278].map((y, i) => (
        <path key={y} data-wave="" className="wave-line" d={`M-40 ${y} ${Array.from({ length: 10 }, () => `q 12 -6 24 0 q 12 6 24 0`).join(' ')}`} fill="none" strokeWidth={2 + i * 0.5} strokeLinecap="round" />
      ))}
      <path className="sand" d="M0 304 Q 100 296 200 302 T 400 300 V400 H0 Z" />
      <path data-part="foam" className="foam" d="M0 302 Q 50 294 100 300 T 200 300 T 300 298 T 400 300" fill="none" strokeWidth="5" strokeLinecap="round" />
      <path className="sand-dark" d="M24 362 q 16 -5 32 0 M318 392 q 20 -6 40 0 M140 388 q 14 -4 28 0" fill="none" strokeWidth="2.5" strokeLinecap="round" />
      <path className="starfish" d="M44 382 l 4 -9 l 4 9 l 9 1 l -7 6 l 3 9 l -9 -5 l -9 5 l 3 -9 l -7 -6 Z" />

      {/* palm trees at the edges */}
      <path className="palm-trunk" d="M18 380 Q 26 220 56 98" fill="none" strokeWidth="13" strokeLinecap="round" />
      <path className="palm-ring" d="M22 340 l 10 2 M26 290 l 10 2 M32 240 l 10 2 M40 190 l 10 2 M48 144 l 9 2" fill="none" strokeWidth="2" />
      <g data-part="palm-l">
        <path className="frond" d="M56 98 Q 20 70 -6 96 Q 24 86 56 98 Z M56 98 Q 90 64 126 84 Q 90 82 56 98 Z M56 98 Q 40 50 6 46 Q 36 64 56 98 Z M56 98 Q 80 50 110 46 Q 74 66 56 98 Z M56 98 Q 72 126 84 150 Q 60 124 56 98 Z" />
        <circle className="coconut" cx="52" cy="104" r="6" /><circle className="coconut" cx="62" cy="106" r="6" />
      </g>
      <path className="palm-trunk" d="M392 380 Q 380 230 350 112" fill="none" strokeWidth="12" strokeLinecap="round" />
      <path className="palm-ring" d="M384 340 l 10 -2 M380 290 l 10 -2 M374 240 l 10 -2 M366 190 l 9 -2 M358 150 l 9 -2" fill="none" strokeWidth="2" />
      <g data-part="palm-r">
        <path className="frond" d="M350 112 Q 386 84 412 110 Q 382 100 350 112 Z M350 112 Q 316 78 280 98 Q 316 96 350 112 Z M350 112 Q 366 64 400 60 Q 370 78 350 112 Z M350 112 Q 326 64 296 60 Q 332 80 350 112 Z M350 112 Q 334 140 322 164 Q 346 138 350 112 Z" />
        <circle className="coconut" cx="346" cy="118" r="6" /><circle className="coconut" cx="356" cy="120" r="6" />
      </g>

      {/* tiki torches either side */}
      {[96, 304].map((x, i) => (
        <g key={x}>
          <Shadow cx={x} cy={356} rx={12} ry={3} />
          <rect className="bamboo ol-thin" x={x - 4} y="240" width="8" height="116" rx="3" />
          <path d={`M${x - 4} 280 H${x + 4} M${x - 4} 320 H${x + 4}`} stroke="rgb(0 0 0 / 0.3)" strokeWidth="2" />
          <circle data-glow="" className="fire-glow" cx={x} cy="222" r="22" />
          <g data-part={i ? 'torch-r' : 'torch-l'}>
            <path className="flame-a" d={`M${x} 234 C ${x - 14} 224 ${x - 10} 208 ${x - 2} 196 C ${x} 208 ${x + 6} 206 ${x + 4} 194 C ${x + 16} 208 ${x + 14} 226 ${x} 234 Z`} />
            <path className="flame-b" d={`M${x} 234 C ${x - 6} 228 ${x - 5} 220 ${x} 212 C ${x + 2} 220 ${x + 6} 222 ${x + 5} 216 C ${x + 9} 226 ${x + 6} 232 ${x} 234 Z`} />
          </g>
          <path className="torch-cup ol-thin" d={`M${x - 11} 230 L ${x + 11} 230 L ${x + 7} 246 L ${x - 7} 246 Z`} />
          <path d={`M${x - 10} 236 H${x + 10} M${x - 8} 241 H${x + 8}`} stroke="rgb(0 0 0 / 0.3)" strokeWidth="1.5" />
        </g>
      ))}

      {/* a crab on the sand */}
      <g data-part="crab">
        <Shadow cx={344} cy={384} rx={20} ry={3} />
        <path className="crab-leg" d="M330 378 l -10 6 M332 381 l -8 8 M358 378 l 10 6 M356 381 l 8 8" fill="none" strokeWidth="2.5" strokeLinecap="round" />
        <ellipse className="crab ol-thin" cx="344" cy="376" rx="16" ry="10" />
        <g data-part="claw-l"><path className="crab ol-thin" d="M330 368 q -10 -4 -10 -12 q 6 4 10 0 q 2 8 0 12 Z" /></g>
        <g data-part="claw-r"><path className="crab ol-thin" d="M358 368 q 10 -4 10 -12 q -6 4 -10 0 q -2 8 0 12 Z" /></g>
        <path d="M339 366 V360 M349 366 V360" stroke="#24170f" strokeWidth="1.5" />
        <circle cx="339" cy="359" r="2.4" fill="#fff" stroke="#24170f" strokeWidth="1" /><circle cx="349" cy="359" r="2.4" fill="#fff" stroke="#24170f" strokeWidth="1" />
        <path d="M339 380 Q 344 384 349 380" fill="none" stroke="#24170f" strokeWidth="1.5" strokeLinecap="round" />
      </g>

      <Shadow cx={200} cy={364} rx={62} />
      {/* bare legs and feet in the sand */}
      <Legs species={species} legs="bare" />

      <Body species={species}>
        {/* a Hawaiian shirt: big flowers and leaves, a camp collar open at the neck, and a lei */}
        {PRINT.map(([x, y, r], i) => (
          <g key={i}>
            <path className="leaf" d={`M${x} ${y} q ${r * 1.4} ${-r * 0.4} ${r * 2} ${r * 0.8} q ${-r * 1.4} ${r * 0.2} ${-r * 2} ${-r * 0.8} Z`} />
            <Flower x={x} y={y} r={r} className="shirt-flower" />
          </g>
        ))}
        <path className="neckline" d="M184 244 L 200 280 L 216 244 Z" />
        <path className="collar ol-thin" d="M168 242 L 200 280 L 186 252 Z M232 242 L 200 280 L 214 252 Z" />
        <path d="M200 280 V330" stroke="rgb(0 0 0 / 0.2)" strokeWidth="2" />
        {LEI.map(([x, y], i) => <Flower key={i} x={x} y={y} r={8} className={`lei lei-${i % 3}`} />)}
        <BodyOutfits />
      </Body>
      <Skirt species={species} style="fringe" className="grass-skirt" />

      <Head
        species={species}
        hat={
          <g data-part="adjust" className="own-hat">
            {/* a straw hat with a band in the skin's colour */}
            <path className="straw ol" d="M150 116 Q 148 76 200 74 Q 252 76 250 116 Z" />
            <path d="M160 92 Q 200 84 240 92 M156 104 Q 200 96 244 104" className="straw-weave" fill="none" strokeWidth="1.5" />
            <rect className="hat-band" x="150" y="104" width="100" height="10" />
            <path className="straw ol" d="M98 120 Q 200 104 302 120 Q 308 134 290 136 Q 200 126 110 136 Q 92 134 98 120 Z" />
            <path d="M120 128 Q 200 118 280 128" className="straw-weave" fill="none" strokeWidth="1.5" />
            <Flower x={238} y={106} r={9} className="lei lei-0" />
          </g>
        }
      />

      {/* the bongos on a stand: a small drum and a big one joined in the middle */}
      <Shadow cx={200} cy={386} rx={30} ry={4} />
      <path className="stand" d="M200 336 V368 L 182 384 M200 368 L 218 384 M200 368 V386" fill="none" strokeWidth="4" strokeLinecap="round" />
      <rect className="bongo-block ol-thin" x="188" y="322" width="24" height="14" rx="3" />
      <path className="bongo-shell ol" d={`M${SMALL - 19} ${HEAD_Y} L ${SMALL - 14} 348 Q ${SMALL} 353 ${SMALL + 14} 348 L ${SMALL + 19} ${HEAD_Y} Z`} />
      <path className="bongo-shell ol" d={`M${BIG - 24} ${HEAD_Y} L ${BIG - 18} 352 Q ${BIG} 357 ${BIG + 18} 352 L ${BIG + 24} ${HEAD_Y} Z`} />
      <path className="bongo-band" d={`M${SMALL - 17} 334 Q ${SMALL} 340 ${SMALL + 17} 334 M${BIG - 22} 336 Q ${BIG} 342 ${BIG + 22} 336`} fill="none" strokeWidth="4" />
      <g data-part="head-small">
        <ellipse className="bongo-head ol-thin" cx={SMALL} cy={HEAD_Y} rx="19" ry="5.5" />
      </g>
      <g data-part="head-big">
        <ellipse className="bongo-head ol-thin" cx={BIG} cy={HEAD_Y} rx="24" ry="6.5" />
      </g>
      <path className="bongo-hoop" d={`M${SMALL - 20} ${HEAD_Y + 1} Q ${SMALL} ${HEAD_Y + 10} ${SMALL + 20} ${HEAD_Y + 1} M${BIG - 25} ${HEAD_Y + 1} Q ${BIG} ${HEAD_Y + 12} ${BIG + 25} ${HEAD_Y + 1}`} fill="none" strokeWidth="3" />

      {/* hands on the heads */}
      <Arm part="arm-l" d="M138 268 Q 124 306 168 312" hand={[170, 312]} />
      <Arm part="arm-r" d="M262 268 Q 278 306 232 312" hand={[230, 312]} />
    </CritterFrame>
  );
}
