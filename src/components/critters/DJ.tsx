import { useRef } from 'react';
import { Arm, BodyOutfits, Head, CritterFrame, TORSO } from './parts';
import type { ActProps } from './species';
import { useCritterRig, type RigFrame } from './rig';

/**
 * DJ raccoon behind a pair of decks. The hoodie, headphones, record labels and deck lights take the skin's
 * colours. The right hand scratches on strong high-frequency hits, the left rides the mixer with the mids,
 * and the records spin while something plays. Paused, he adjusts his headphones now and then.
 */
export function DJ({ species, still }: ActProps) {
  const { Face, Tail } = species;
  const root = useRef<SVGSVGElement>(null);
  const state = useRef({ spin: 0, pulse: 0 });

  useCritterRig(
    root,
    ({ t, a, rock, hit, $ }: RigFrame) => {
      const s = state.current;
      const svg = root.current!;
      $('arm-r').setAttribute('transform', `rotate(${(rock * 9).toFixed(2)} 262 268)`);
      $('arm-l').setAttribute('transform', `rotate(${(a.live ? -a.mid * 14 : Math.sin(t * 1.3) * 2).toFixed(2)} 138 268)`);

      // records: 33⅓ rpm-ish while playing; the scratched one runs backwards for a moment
      if (a.playing) s.spin += (Math.PI * 2 * 0.55) / 60;
      [$('mark-l'), $('mark-r')].forEach((m, i) => {
        const ang = i === 1 && hit ? s.spin - rock * 0.9 : s.spin + i * 1.7;
        const cx = i ? 300 : 100;
        m.setAttribute('cx', (cx + Math.cos(ang) * 36).toFixed(1));
        m.setAttribute('cy', (326 + Math.sin(ang) * 11).toFixed(1));
      });

      // mixer meters (5 lights per band) and the front light strip, which chases on beats
      const levels = [a.bass, a.mid, a.treble * 1.6];
      svg.querySelectorAll<SVGElement>('[data-level]').forEach((led) => {
        const [band, step] = led.dataset.level!.split(':').map(Number);
        led.style.opacity = levels[band] * 6 > step ? '1' : '0.15';
      });
      const strip = svg.querySelectorAll<SVGElement>('[data-strip]');
      if (a.beat) s.pulse = (s.pulse + 1) % strip.length;
      strip.forEach((el, i) => (el.style.opacity = a.playing ? ((i + s.pulse) % 3 === 0 ? '1' : '0.3') : '0.15'));
    },
    { still },
  );

  return (
    <CritterFrame ref={root} kind="dj" species={species.id} label={`A ${species.noun} DJ playing records`}>
      {Tail && <Tail />}

      <g data-part="body">
        <path className="top" d={TORSO} />
        <ellipse className="top-shade" cx="200" cy="248" rx="54" ry="13" />
        <path d="M190 254 L188 284 M210 254 L212 284" className="strings" strokeWidth="3" strokeLinecap="round" />
        <BodyOutfits />
      </g>

      <Head
        face={<Face />}
        over={
          <g data-part="adjust">
            <path d="M122 182 C 122 80, 278 80, 278 182" className="phones" fill="none" strokeWidth="9" strokeLinecap="round" />
            <rect className="phones-cup" x="106" y="156" width="24" height="48" rx="10" />
            <rect className="phones-cup" x="270" y="156" width="24" height="48" rx="10" />
            <rect className="phones-pad" x="112" y="164" width="12" height="32" rx="6" />
            <rect className="phones-pad" x="276" y="164" width="12" height="32" rx="6" />
          </g>
        }
      />

      {/* the desk sits in front of his body; arms and hands go on top of it */}
      <path className="desk-top" d="M28 300 L372 300 L392 352 L8 352 Z" />
      <rect className="desk-front" x="8" y="352" width="384" height="44" />
      {Array.from({ length: 12 }, (_, i) => (
        <rect key={i} data-strip="" className={`led led-${i % 3}`} x={26 + i * 30} y="370" width="18" height="6" rx="3" />
      ))}
      {[100, 300].map((cx, i) => (
        <g key={cx}>
          <ellipse cx={cx} cy="326" rx="62" ry="20" fill="#121215" />
          <ellipse cx={cx} cy="326" rx="54" ry="17" fill="#0b0b0d" stroke="#2a2a2e" strokeWidth="1.5" />
          <ellipse cx={cx} cy="326" rx="38" ry="12" fill="none" stroke="#202024" strokeWidth="1" />
          <ellipse className="record-label" cx={cx} cy="326" rx="16" ry="5" />
          <ellipse data-part={i ? 'mark-r' : 'mark-l'} cx={cx + 36} cy="326" rx="4" ry="1.8" fill="#d8d8de" />
        </g>
      ))}
      <rect x="170" y="304" width="60" height="42" rx="4" fill="#16161a" />
      {[0, 1, 2].map((band) =>
        Array.from({ length: 5 }, (_, step) => (
          <rect key={`${band}-${step}`} data-level={`${band}:${step}`} className={`led led-${band}`} x={178 + band * 16} y={336 - step * 7} width="12" height="5" rx="1" />
        )),
      )}

      <Arm part="arm-l" d="M138 268 Q 146 300 176 318" hand={[178, 320]} thumb={[186, 318]} />
      <Arm part="arm-r" d="M262 268 Q 284 290 290 316" hand={[290, 318]} thumb={[283, 316]} />
    </CritterFrame>
  );
}
