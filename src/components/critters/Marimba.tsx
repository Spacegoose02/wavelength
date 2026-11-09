import { useRef } from 'react';
import { armJoint, beatClock, bend, lift } from './arm';
import { swell, windUp } from './flourish';
import { Arm, Body, BodyOutfits, CritterFrame, Head, Legs, Shadow, Skirt } from './parts';
import type { ActProps } from './species';
import { useCritterRig } from './rig';

/** The marimba's bars, low (long, left) to high (short, right): centre x and how far each bar reaches back. */
const BARS = Array.from({ length: 12 }, (_, i) => [107 + i * 16.9, 30 - i * 1.1] as const);
/** The line the bars' front edges sit on, where the mallets land. */
const BAR_Y = 330;
/** Butterflies: start x, y, how far they wander and how fast. */
const FLIES: [number, number, number, number][] = [
  [90, 150, 40, 0.6], [320, 120, 34, 0.8], [260, 200, 26, 1.1],
];
/** Fireflies of pollen in the light shafts: x, start of climb, speed. */
const MOTES: [number, number, number][] = [
  [70, 0, 1], [124, 0.4, 0.8], [180, 0.7, 1.2], [300, 0.2, 0.9], [350, 0.55, 1.1], [236, 0.85, 0.7],
];

const f1 = (n: number) => n.toFixed(1);

/** A big split jungle leaf on a stem from `x`,`y`, pointing `rot` degrees (0 is up), `s` its size. */
function Leaf({ x, y, rot, s, className = 'jungle-leaf' }: { x: number; y: number; rot: number; s: number; className?: string }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`}>
      <path className={`${className} ol-thin`} d="M0 0 C -30 -10, -40 -50, -16 -80 C -6 -92, 6 -92, 16 -80 C 40 -50, 30 -10, 0 0 Z" />
      <path d="M0 0 V -84 M0 -20 L -20 -34 M0 -38 L -22 -54 M0 -56 L -16 -70 M0 -20 L 20 -34 M0 -38 L 22 -54 M0 -56 L 16 -70" stroke="rgb(0 0 0 / 0.22)" strokeWidth="2" fill="none" strokeLinecap="round" />
    </g>
  );
}

/**
 * In the jungle: the critter plays a marimba in a rainforest clearing by a waterfall, in an explorer's khaki
 * shirt with a neckerchief and a pith helmet (girls: a khaki skirt and a bow). The neckerchief, hat band and
 * the bars' glow take the skin's colours; the forest and the wood are fixed. A mallet in each hand: the low hand
 * plays on the beat and the high hand on the off-beat (twice as fast when the highs are busy), each moving
 * between the bars under it to where the music is loudest; a struck bar lights up and dips. The waterfall pours
 * faster with the bass, the vines and leaves sway, a parrot on a branch bobs its head on the beat and two
 * butterflies flutter about. Flourish: a fast roll while a glissando of light runs up the bars, then both hands
 * up and the parrot flaps. Paused, the mallets rest on the bars.
 */
export function Marimba({ species, still }: ActProps) {
  const root = useRef<SVGSVGElement>(null);
  const state = useRef({ beat: -1, half: -1, barL: 3, barR: 8, xl: 0, xr: 0, lit: new Array(BARS.length).fill(0) as number[], fall: 0, rise: 0 });

  useCritterRig(
    root,
    (f) => {
      const { t, a, idle, bob, flourish, $ } = f;
      const s = state.current;
      const svg = root.current!;
      const { phase, index } = beatClock(f);
      const halves = Math.floor((index + phase) * 2);
      const busy = a.live && a.treble > 0.45;
      // the bars under each hand: those its mallet reaches from where the hand rests (each species' arms differ)
      const near = (hand: 'arm-l' | 'arm-r') => {
        const j = armJoint($, hand);
        const head = j ? j.hx + (hand === 'arm-l' ? 8 : -8) : 200;
        const list = BARS.map(([x], i) => [i, Math.abs(x - head)] as const).filter(([, d]) => d < 26).map(([i]) => i);
        return list.length ? list : [BARS.reduce((b, [x], i) => (Math.abs(x - head) < Math.abs(BARS[b][0] - head) ? i : b), 0)];
      };
      const barsL = near('arm-l');
      const barsR = near('arm-r');
      // which of them it goes for next: the one where the music is loudest (low bars left, high right)
      const bins = a.freq.length;
      const loudest = (list: number[], k: number) => {
        if (!a.live) return list[k % list.length];
        let best = list[0];
        let max = -1;
        for (const i of list) {
          const v = a.freq[Math.floor(((i + 0.5) / BARS.length) * bins * 0.6)] ?? 0;
          if (v > max) {
            max = v;
            best = i;
          }
        }
        return best;
      };
      if (!barsL.includes(s.barL)) s.barL = barsL[0];
      if (!barsR.includes(s.barR)) s.barR = barsR[barsR.length - 1];
      // on its stroke a hand lands on the bar it was over (which lights up), then lifts and moves to the next
      if (!idle && index !== s.beat) {
        s.lit[s.barL] = 1;
        s.barL = loudest(barsL, [0, 2, 1, 2][index % 4]);
      }
      if (!idle && halves !== s.half && (halves % 2 === 1 || busy)) {
        s.lit[s.barR] = 1;
        s.barR = loudest(barsR, [1, 0, 2, 1][index % 4]);
      }
      s.beat = index;
      s.half = halves;

      // flourish: a fast roll with both mallets while a glissando of light runs up the bars, then both hands up
      const run = flourish && flourish < 0.7 ? Math.min(1, flourish / 0.7) : 0;
      const up = flourish > 0.7 ? swell((flourish - 0.7) / 0.3 / 2) : 0;
      if (run) s.lit[Math.min(BARS.length - 1, Math.floor(run * BARS.length))] = 1;

      // each hand slides over to its bar from the elbow (the mallet kept upright), then strikes
      const glide = (hand: 'arm-l' | 'arm-r', bar: number, cur: number) => {
        const j = armJoint($, hand);
        const want = j ? BARS[bar][0] + (hand === 'arm-l' ? -8 : 8) - j.hx : 0;
        return cur + (want - cur) * 0.3;
      };
      s.xl = idle ? s.xl * 0.9 : glide('arm-l', s.barL, s.xl);
      s.xr = idle ? s.xr * 0.9 : glide('arm-r', s.barR, s.xr);
      const hitL = idle ? 0 : run ? Math.abs(Math.sin(t * 30)) * 0.6 : lift(phase);
      const hitR = idle ? 0 : run ? Math.abs(Math.cos(t * 30)) * 0.6 : busy ? lift((phase * 2 + 0.5) % 1) : lift((phase + 0.5) % 1);
      const strike = (hand: 'arm-l' | 'arm-r', dx: number, hit: number, side: number) => {
        $(hand).setAttribute('transform', `rotate(${f1(side * up * 70 + side * (idle ? Math.sin(t * 0.9) : 0))} ${hand === 'arm-l' ? 138 : 262} 268)`);
        const to: [number, number] = [dx * (1 - up), -hit * 12];
        const [, , rot] = bend($, hand, { to, turn: side * up * 50 });
        bend($, hand, { to, turn: side * up * 50, wrist: -rot * (1 - up) - side * hit * 26 });
      };
      strike('arm-l', s.xl, hitL, 1);
      strike('arm-r', s.xr, hitR, -1);

      // struck bars light up in the skin's colour and dip, then fade
      svg.querySelectorAll<SVGElement>('[data-bar]').forEach((b, i) => {
        const v = s.lit[i];
        b.setAttribute('transform', `translate(0 ${f1(v * 2.5)})`);
        (b.lastElementChild as SVGElement).style.opacity = v.toFixed(2);
        s.lit[i] *= 0.88;
      });

      // the waterfall pours faster with the bass, its pool splashes on the beat
      s.fall += (0.6 + (a.playing ? a.bass * 2 : 0)) / 60;
      $('falls').setAttribute('stroke-dashoffset', f1(-(s.fall * 60) % 40));
      $('splash').setAttribute('transform', `translate(318 232) scale(${(1 + (a.playing ? bob * 0.25 : 0)).toFixed(3)}) translate(-318 -232)`);
      svg.querySelectorAll<SVGElement>('[data-vine]').forEach((v, i) => {
        const [x] = v.dataset.vine!.split(' ').map(Number);
        v.setAttribute('transform', `rotate(${f1(Math.sin(t * 0.9 + i * 1.7) * 3 + (a.playing ? a.bass * 2 : 0))} ${x} 0)`);
      });
      svg.querySelectorAll<SVGElement>('[data-sway]').forEach((l, i) => {
        const [x, y] = l.dataset.sway!.split(' ').map(Number);
        l.setAttribute('transform', `rotate(${f1(Math.sin(t * 1.2 + i * 2.3) * 3 + (a.playing ? bob * 2 * (i % 2 ? 1 : -1) : 0))} ${x} ${y})`);
      });
      // the parrot bobs on the beat and flaps in the flourish
      $('parrot').setAttribute('transform', `translate(0 ${f1(a.playing ? -bob * 3 : 0)}) rotate(${f1(a.playing ? Math.sin(Math.PI * (index + phase)) * 6 : 0)} 70 92)`);
      $('parrot-wing').setAttribute('transform', `rotate(${f1(flourish ? -Math.abs(Math.sin(t * 24)) * 50 * swell(flourish) : 0)} 74 84)`);
      // butterflies wander and flap
      FLIES.forEach(([x, y, r, k], i) => {
        const el = $(`fly-${i}`);
        const px = x + Math.sin(t * k + i) * r;
        const py = y + Math.sin(t * k * 1.7 + i * 2) * r * 0.5;
        el.setAttribute('transform', `translate(${f1(px)} ${f1(py)})`);
        (el.firstElementChild as SVGElement).setAttribute('transform', `scale(${Math.abs(Math.sin(t * (9 + i * 2) + i)).toFixed(2)} 1)`);
      });
      // pollen drifts up through the light shafts, faster with the highs
      s.rise += (a.playing ? 0.06 + a.treble * 0.2 : 0.03) / 60;
      svg.querySelectorAll<SVGElement>('[data-mote]').forEach((m, i) => {
        const [x, start, speed] = MOTES[i];
        const p = (s.rise * speed + start) % 1;
        m.setAttribute('transform', `translate(${f1(x + Math.sin(t + i) * 10)} ${f1(320 - p * 280)})`);
        m.style.opacity = (p < 0.1 ? p * 10 : p > 0.8 ? (1 - p) * 5 : 1).toFixed(2);
      });
      $('shafts').style.opacity = (0.8 + (a.playing ? bob * 0.2 : 0) + windUp(flourish) * 0.2).toFixed(2);
    },
    { still, nod: 10 },
  );

  return (
    <CritterFrame ref={root} kind="marimba" species={species} label={`A ${species.noun} playing a marimba in the jungle`}>
      <defs>
        <linearGradient id="jungle-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0f3d2a" />
          <stop offset="1" stopColor="#2d6b40" />
        </linearGradient>
      </defs>
      {/* the forest: far trunks, light through the canopy, the waterfall and its pool, the clearing */}
      <rect x="0" y="0" width="400" height="340" fill="url(#jungle-sky)" />
      <path className="jungle-far" d="M0 120 Q 40 90 80 110 Q 120 70 170 100 Q 220 60 260 96 Q 310 70 350 104 Q 380 90 400 100 V340 H0 Z" />
      {[[34, 16], [140, 12], [250, 14], [376, 18]].map(([x, w]) => <rect key={x} className="jungle-trunk" x={x - w / 2} y="40" width={w} height="300" />)}
      <g data-part="shafts" className="light-shaft">
        <path d="M60 0 H100 L 180 340 H136 Z M200 0 H226 L 280 340 H250 Z" />
      </g>
      <path className="cliff ol-thin" d="M276 44 Q 296 28 356 34 Q 370 70 362 130 Q 372 190 360 236 H276 Q 266 180 276 130 Q 268 80 276 44 Z" />
      <path className="falls" d="M294 40 Q 318 34 342 40 Q 346 140 350 234 H288 Q 292 140 294 40 Z" />
      <path data-part="falls" className="falls-streak" d="M300 44 Q 298 140 296 232 M310 42 Q 309 140 308 232 M320 40 V232 M330 42 Q 331 140 332 232 M339 44 Q 341 140 343 232" strokeWidth="3" strokeDasharray="16 22" strokeLinecap="round" fill="none" />
      <path className="falls-foam" d="M292 42 Q 300 34 308 42 Q 316 32 326 40 Q 334 32 344 42" fill="none" strokeWidth="5" strokeLinecap="round" />
      <ellipse className="pool" cx="318" cy="240" rx="54" ry="10" />
      <g data-part="splash">
        <path className="splash" d="M290 234 q 6 -14 12 -2 q 6 -16 14 -2 q 8 -16 14 0 q 6 -12 12 2" fill="none" strokeWidth="3" strokeLinecap="round" />
      </g>
      <path className="jungle-floor" d="M0 326 Q 100 316 200 322 T 400 320 V400 H0 Z" />
      <path className="moss" d="M20 350 q 14 -6 28 0 M312 384 q 18 -6 36 0 M130 392 q 14 -5 28 0" fill="none" strokeWidth="3" strokeLinecap="round" />
      {MOTES.map((_, i) => <circle key={i} data-mote="" className="pollen" cx="0" cy="0" r="2.2" style={{ opacity: 0 }} />)}

      {/* hanging vines */}
      {[[18, 150], [112, 90], [372, 170]].map(([x, len]) => (
        <g key={x} data-vine={`${x}`}>
          <path className="vine" d={`M${x} 0 Q ${x + 10} ${len / 2} ${x} ${len}`} fill="none" strokeWidth="4" strokeLinecap="round" />
          {[0.35, 0.6, 0.85].map((k) => (
            <ellipse key={k} className="vine-leaf" cx={x + 6} cy={len * k} rx="7" ry="4" transform={`rotate(-30 ${x + 6} ${len * k})`} />
          ))}
        </g>
      ))}

      {/* a parrot on a branch, top left */}
      <path className="branch" d="M0 104 Q 60 96 120 108" fill="none" strokeWidth="7" strokeLinecap="round" />
      <g data-part="parrot">
        <path className="parrot-tail" d="M64 112 L 58 146 L 70 144 L 74 112 Z" />
        <ellipse className="parrot ol-thin" cx="70" cy="92" rx="13" ry="18" />
        <g data-part="parrot-wing">
          <path className="parrot-wing ol-thin" d="M74 84 Q 90 92 82 112 Q 72 104 74 84 Z" />
        </g>
        <circle className="parrot ol-thin" cx="68" cy="72" r="11" />
        <path className="parrot-beak ol-thin" d="M58 70 Q 50 72 52 80 Q 56 76 60 77 Z" />
        <circle cx="66" cy="69" r="3" fill="#fff" />
        <circle cx="65.5" cy="69" r="1.6" fill="#111" />
        <path d="M64 108 l -2 6 M74 108 l 2 6" stroke="#4a3a2a" strokeWidth="2" strokeLinecap="round" />
      </g>

      {/* butterflies */}
      {FLIES.map((_, i) => (
        <g key={i} data-part={`fly-${i}`}>
          <g>
            <path className={`butterfly butterfly-${i}`} d="M0 0 C -10 -12, -14 -2, -6 2 C -12 8, -4 12, 0 2 C 4 12, 12 8, 6 2 C 14 -2, 10 -12, 0 0 Z" />
          </g>
          <path d="M0 -3 V5" stroke="#1b1b1f" strokeWidth="1.6" strokeLinecap="round" />
        </g>
      ))}

      {/* big leaves at the edges */}
      <g data-sway="0 400">
        <Leaf x={0} y={400} rot={40} s={1.3} />
        <Leaf x={10} y={400} rot={12} s={1.1} className="jungle-leaf-2" />
      </g>
      <g data-sway="400 400">
        <Leaf x={400} y={400} rot={-40} s={1.3} />
        <Leaf x={392} y={400} rot={-14} s={1.05} className="jungle-leaf-2" />
      </g>

      <Shadow cx={200} cy={364} rx={62} />
      <Legs species={species} shoe="boot" />

      <Body species={species}>
        {/* an explorer's khaki shirt: two flap pockets, epaulettes, a placket, a neckerchief */}
        <path className="khaki-pocket ol-thin" d="M160 274 h 26 v 22 h -26 Z M214 274 h 26 v 22 h -26 Z" />
        <path className="khaki-flap ol-thin" d="M158 270 h 30 v 8 l -15 4 l -15 -4 Z M212 270 h 30 v 8 l -15 4 l -15 -4 Z" />
        <path className="khaki-flap" d="M150 258 l 26 6 M250 258 l -26 6" strokeWidth="6" strokeLinecap="round" />
        <path d="M200 262 V336" stroke="rgb(0 0 0 / 0.2)" strokeWidth="2" />
        {[286, 304, 322].map((y) => <circle key={y} cx="203" cy={y} r="2" fill="#7a6a40" />)}
        <path className="neckerchief ol-thin" d="M176 246 Q 200 258 224 246 L 206 276 L 200 268 L 194 276 Z" />
        <BodyOutfits />
      </Body>
      <Skirt species={species} style="pleated" />

      <Head
        species={species}
        hat={
          <g data-part="adjust" className="own-hat">
            {/* a pith helmet: a khaki dome with a band in the skin's colour and a wide brim */}
            <path className="pith ol" d="M140 118 Q 140 66 200 64 Q 260 66 260 118 Z" />
            <path d="M200 66 V114 M170 72 Q 160 92 162 116 M230 72 Q 240 92 238 116" stroke="rgb(0 0 0 / 0.15)" strokeWidth="2" fill="none" />
            <rect className="hat-band" x="140" y="104" width="120" height="10" />
            <path className="pith ol" d="M108 122 Q 200 104 292 122 Q 296 134 282 136 Q 200 124 118 136 Q 104 134 108 122 Z" />
            <circle className="pith ol-thin" cx="200" cy="64" r="5" />
          </g>
        }
      />

      {/* the marimba: a wooden frame on legs, the resonator pipes, the bars seen from above and a front rail */}
      <Shadow cx={200} cy={392} rx={110} ry={5} />
      <path className="marimba-frame" d="M96 334 V388 M304 334 V388 M96 384 H304" fill="none" strokeWidth="6" strokeLinecap="round" />
      {BARS.map(([x], i) => (
        <rect key={x} className="resonator ol-thin" x={x - 5.5} y={BAR_Y + 4} width="11" height={44 - i * 2.4} rx="4" />
      ))}
      <path className="marimba-rail ol-thin" d={`M92 ${BAR_Y - 34} L 308 ${BAR_Y - 22} L 308 ${BAR_Y - 16} L 92 ${BAR_Y - 28} Z`} />
      {BARS.map(([x, depth], i) => (
        <g key={x} data-bar={i}>
          <rect className="marimba-bar ol-thin" x={x - 7.5} y={BAR_Y - depth} width="15" height={depth} rx="2.5" />
          <rect x={x - 5} y={BAR_Y - depth + 3} width="3" height={depth - 6} rx="1.5" fill="rgb(255 255 255 / 0.2)" />
          <rect className="bar-lit" x={x - 7.5} y={BAR_Y - depth} width="15" height={depth} rx="2.5" style={{ opacity: 0 }} />
        </g>
      ))}
      <rect className="marimba-rail ol-thin" x="90" y={BAR_Y - 2} width="220" height="9" rx="3" />

      {/* two mallets, held over the bars */}
      <Arm part="arm-l" d="M138 268 Q 122 296 154 290" hand={[156, 290]}>
        {([x, y]) => (
          <g>
            <path className="mallet-shaft" d={`M${x} ${y} L ${x + 7} ${y + 24}`} strokeWidth="3.5" strokeLinecap="round" />
            <circle className="mallet-head ol-thin" cx={x + 8} cy={y + 26} r="6.5" />
          </g>
        )}
      </Arm>
      <Arm part="arm-r" d="M262 268 Q 278 296 246 290" hand={[244, 290]}>
        {([x, y]) => (
          <g>
            <path className="mallet-shaft" d={`M${x} ${y} L ${x - 7} ${y + 24}`} strokeWidth="3.5" strokeLinecap="round" />
            <circle className="mallet-head ol-thin" cx={x - 8} cy={y + 26} r="6.5" />
          </g>
        )}
      </Arm>
    </CritterFrame>
  );
}
