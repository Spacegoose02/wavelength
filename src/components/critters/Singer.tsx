import { useRef } from 'react';
import { singingReading } from '../../player/singing';
import { beatClock, bend } from './arm';
import { swell } from './flourish';
import { Arm, Body, BodyOutfits, CritterFrame, Head, Legs, Shadow, Skirt } from './parts';
import type { ActProps } from './species';
import { useCritterRig } from './rig';

/** The mic stand's foot, which it tips about, and where the hand holds it (just under the mic). */
const FOOT: [number, number] = [146, 372];
const GRIP: [number, number] = [146, 262];
/** Fans in the front row: x, how big. */
const CROWD: [number, number][] = [[16, 0.8], [50, 0.68], [86, 0.74], [314, 0.74], [350, 0.68], [384, 0.8]];
const NOTES = 5;

const f1 = (n: number) => n.toFixed(1);

/** Where point `p` goes when turned by `deg` about `c`, as an offset from `p`. */
function turned(p: [number, number], c: [number, number], deg: number): [number, number] {
  const r = (deg * Math.PI) / 180;
  const x = p[0] - c[0];
  const y = p[1] - c[1];
  return [c[0] + x * Math.cos(r) - y * Math.sin(r) - p[0], c[1] + x * Math.sin(r) + y * Math.cos(r) - p[1]];
}

/**
 * Singer on a stage: a sequined jacket, one hand on a vintage mic on a stand held off to the side of the face,
 * so the whole mouth shows while they sing along with the vocals (rig.ts, face.ts). Spotlights from above and a
 * front row of fans with phone lights, nothing behind, so the album colours show through. The jacket, the beams
 * and the footlights take the skin's colours. The free hand acts out the song: it sways with the beat, opens out
 * wide on a long held note and drops back between lines; notes float up while they sing, more the louder the
 * voice. The stand rocks with the beat and the fans sway and wave their lights. Flourish: the free arm thrown up
 * high for the big note, the stand tipped back. Paused, the hand rests on the mic.
 */
export function Singer({ species, still }: ActProps) {
  const root = useRef<SVGSVGElement>(null);
  const state = useRef({ tip: 0, open: 0, notes: Array.from({ length: NOTES }, () => -9), next: 0, lastNote: 0 });

  useCritterRig(
    root,
    (f) => {
      const { t, a, idle, bob, flourish, $ } = f;
      const s = state.current;
      const svg = root.current!;
      const { phase, index } = beatClock(f);
      const big = swell(flourish);
      const swing = Math.sin(Math.PI * (index + phase));
      const voice = idle ? 0 : singingReading.mouth;

      // the stand rocks with the beat (and leans back for the big note); the hand stays on it
      const tip = idle ? Math.sin(t * 0.7) * 1 : swing * 3 - big * 8;
      s.tip += (tip - s.tip) * 0.25;
      $('stand').setAttribute('transform', `rotate(${f1(s.tip)} ${FOOT[0]} ${FOOT[1]})`);
      bend($, 'arm-l', { to: turned(GRIP, FOOT, s.tip), wrist: s.tip });

      // the free hand: sways with the beat, opens out wide on a held note, thrown up high on a flourish
      const held = voice > 0.45 ? 1 : 0;
      s.open += ((idle ? 0 : held) - s.open) * (held ? 0.08 : 0.05);
      const sway = idle ? 0 : swing * 10 + bob * 4;
      $('arm-r').setAttribute('transform', `rotate(${f1(-s.open * 34 - big * 70 + sway * 0.4)} 262 268)`);
      bend($, 'arm-r', { turn: -s.open * 30 - big * 20 + sway, wrist: (idle ? 0 : Math.sin(t * 2.4) * 8) - s.open * 10 });

      // notes float up from the mouth while singing, more the louder the voice
      if (!idle && (voice > 0.3 || flourish) && t - s.lastNote > 0.55 - Math.min(0.35, voice * 0.3)) {
        s.notes[s.next] = t;
        s.next = (s.next + 1) % NOTES;
        s.lastNote = t;
      }
      svg.querySelectorAll<SVGElement>('[data-note]').forEach((n, i) => {
        const age = t - s.notes[i];
        const p = Math.min(1, age / 2.4);
        const side = i % 2 ? 1 : -1;
        n.style.opacity = age > 2.4 ? '0' : (Math.min(1, age * 5) * (1 - p)).toFixed(2);
        n.setAttribute('transform', `translate(${f1(200 + side * (40 + p * 90) + Math.sin(age * 4 + i) * 8)} ${f1(196 - p * 150)}) rotate(${f1(Math.sin(age * 3 + i) * 16)}) scale(${(0.7 + p * 0.5).toFixed(2)})`);
      });

      // spotlights sweep and brighten with the music; footlights chase the beat; fans sway with their lights up
      svg.querySelectorAll<SVGElement>('[data-beam]').forEach((b, i) => {
        const [x] = b.dataset.beam!.split(',').map(Number);
        b.setAttribute('transform', `rotate(${f1(Math.sin(t * 0.6 + i * 2.2) * 8)} ${x} -10)`);
        b.style.opacity = (0.16 + (a.playing ? a.mid * 0.22 + bob * 0.08 : 0)).toFixed(2);
      });
      svg.querySelectorAll<SVGElement>('[data-foot]').forEach((l, i) => {
        l.style.opacity = a.playing ? ((i + index) % 3 === 0 ? '1' : '0.4') : '0.25';
      });
      svg.querySelectorAll<SVGElement>('[data-fan]').forEach((fan, i) => {
        const [x, k] = CROWD[i];
        const lean = a.playing ? Math.sin(Math.PI * (index + phase) + i * 0.8) * 6 : Math.sin(t * 0.5 + i) * 2;
        fan.setAttribute('transform', `translate(${x} 400) scale(${k}) rotate(${f1(lean)}) translate(0 ${f1(a.playing ? -bob * 3 : 0)})`);
      });
    },
    { still, nod: 8 },
  );

  return (
    <CritterFrame ref={root} kind="singer" species={species} label={`A ${species.noun} singing into a microphone on stage`}>
      {/* spotlights from above */}
      {[[90, 'beam-a'], [200, 'beam-b'], [310, 'beam-a']].map(([x, cls]) => (
        <g key={x as number} data-beam={`${x},0`} style={{ opacity: 0.2 }}>
          <path className={cls as string} d={`M${(x as number) - 10} -10 L ${(x as number) + 10} -10 L ${(x as number) + 70} 350 L ${(x as number) - 70} 350 Z`} />
        </g>
      ))}
      {[90, 200, 310].map((x) => <rect key={x} className="spot-can ol-thin" x={x - 12} y="-6" width="24" height="18" rx="4" />)}

      {/* the stage, with footlights along its edge */}
      <rect className="stage" x="0" y="340" width="400" height="60" />
      <path d="M0 340 H400" stroke="rgb(255 255 255 / 0.12)" strokeWidth="2" />
      {Array.from({ length: 9 }, (_, i) => (
        <path key={i} data-foot="" className={`led led-${i % 3}`} d={`M${24 + i * 44} 352 h 18 l -3 -8 h -12 Z`} />
      ))}

      <Shadow cx={200} cy={366} rx={64} />
      <Shadow cx={FOOT[0]} cy={FOOT[1] + 2} rx={22} ry={4} />
      <Legs species={species} shoe="boot-black" />

      <Body species={species}>
        {/* a sequined jacket with wide lapels over a dark shirt */}
        <rect className="shirt-dark" x="178" y="240" width="44" height="120" />
        <path className="sequin-jacket" d="M100 400 V252 Q 150 240 182 244 L 196 330 L 178 400 Z" />
        <path className="sequin-jacket" d="M300 400 V252 Q 250 240 218 244 L 204 330 L 222 400 Z" />
        <path className="lapel ol-thin" d="M182 244 L 166 262 L 190 304 L 196 330 Z" />
        <path className="lapel ol-thin" d="M218 244 L 234 262 L 210 304 L 204 330 Z" />
        {Array.from({ length: 28 }, (_, i) => {
          const x = 112 + ((i * 37) % 176);
          const y = 262 + ((i * 23) % 90);
          return x > 170 && x < 230 ? null : <circle key={i} className="sequin" cx={x} cy={y} r="2" />;
        })}
        <path className="star-pin" d="M248 272 l 3 6 l 7 1 l -5 5 l 1 7 l -6 -3 l -6 3 l 1 -7 l -5 -5 l 7 -1 Z" />
        <BodyOutfits />
      </Body>
      <Skirt species={species} style="tutu" className="skirt-sequin" />

      <Head species={species} />

      {/* the mic stand: a heavy round foot, the pole and a vintage mic held off to the side of the face */}
      <g data-part="stand">
        <ellipse className="stand-foot ol-thin" cx={FOOT[0]} cy={FOOT[1]} rx="18" ry="5" />
        <path className="stand" d={`M${FOOT[0]} ${FOOT[1]} V258`} strokeWidth="4" strokeLinecap="round" />
        <path className="mic-body ol-thin" d="M139 256 Q 136 232 146 226 Q 156 232 153 256 Z" />
        <rect className="mic-grille ol-thin" x="138" y="216" width="16" height="22" rx="8" />
        <path d="M140 222 H152 M139 227 H153 M139 232 H153" stroke="#6e6e78" strokeWidth="1.2" />
      </g>

      {/* one hand on the mic, the other free to act out the song */}
      <Arm part="arm-l" d="M138 268 Q 124 284 146 264" hand={GRIP} />
      <Arm part="arm-r" d="M262 268 Q 296 290 312 262" hand={[314, 258]} />

      {/* fans down front with their phone lights up */}
      {CROWD.map(([x, k], i) => (
        <g key={x} data-fan="" transform={`translate(${x} 400) scale(${k})`}>
          <path className="fan" d="M-22 0 Q -22 -26 0 -28 Q 22 -26 22 0 Z" />
          <circle className="fan" cx="0" cy="-38" r="13" />
          <path className="fan-arm" d={i % 2 ? 'M12 -20 L 22 -58' : 'M-12 -20 L -22 -58'} strokeWidth="6" strokeLinecap="round" />
          <rect className="phone-light" x={i % 2 ? 18 : -26} y="-70" width="8" height="12" rx="2" filter="url(#critter-glow)" />
        </g>
      ))}

      {/* notes floating up as they sing */}
      {Array.from({ length: NOTES }, (_, i) => (
        <g key={i} data-note="" style={{ opacity: 0 }}>
          <path className="sing-note" d={i % 2 ? 'M0 0 V-16 L 12 -20 V-4' : 'M0 0 V-18 Q 8 -14 10 -8'} fill="none" strokeWidth="2.6" strokeLinecap="round" />
          <ellipse className="sing-note-head" cx="-3" cy="0" rx="4.5" ry="3.4" transform="rotate(-20 -3 0)" />
          {i % 2 ? <ellipse className="sing-note-head" cx="9" cy="-4" rx="4.5" ry="3.4" transform="rotate(-20 9 -4)" /> : null}
        </g>
      ))}
    </CritterFrame>
  );
}
