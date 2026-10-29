import { useEffect, useRef } from 'react';
import { createAudioReader } from '../player/analysis';

/**
 * Now Playing scene: a raccoon DJ behind a pair of decks (inline SVG, 400×400).
 *
 * - Fur is fixed black and grey. The hoodie, headphones, record labels and deck lights take the skin's
 *   colours (`--accent`, `--viz-*`) from CSS (`.raccoon …` in styles.css), so every skin dresses him
 *   differently. Holiday skins add a hat the same way: each hat is in the SVG and CSS shows the one
 *   that matches `data-skin`.
 * - The head bobs on beats, the right hand scratches on strong high-frequency hits, the left hand rides
 *   the mixer with the mids, and the records spin while something plays.
 * - Paused: he sways slowly, blinks, yawns now and then and adjusts his headphones. On streams the
 *   WebView can't analyse (no CORS) he gets the same calm made-up signal as the other scenes and just sways.
 *
 * Animation writes SVG attributes straight from requestAnimationFrame (no React re-render per frame).
 */
export function RaccoonDJ() {
  const root = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = root.current!;
    const $ = (name: string) => svg.querySelector<SVGElement>(`[data-part="${name}"]`)!;
    const head = $('head');
    const body = $('body');
    const eyes = $('eyes');
    const smile = $('smile');
    const yawnMouth = $('yawn');
    const phones = $('phones');
    const armR = $('arm-r');
    const armL = $('arm-l');
    const tail = $('tail');
    const spot = $('spot');
    const marks = [$('mark-l'), $('mark-r')];
    const leds = [...svg.querySelectorAll<SVGElement>('[data-level]')];
    const strip = [...svg.querySelectorAll<SVGElement>('[data-strip]')];

    const read = createAudioReader();
    let t = 0;
    let raf = 0;
    let bob = 0;
    let scratchUntil = -1;
    let spin = 0;
    let nextBlink = 2;
    let nextYawn = 6;
    let nextAdjust = 11;
    let pulse = 0;

    const loop = () => {
      raf = requestAnimationFrame(loop);
      t += 1 / 60;
      const a = read(t);
      const idle = !a.playing;

      // head bob: kick on each detected beat, then ease back
      if (a.beat && a.live) bob = 1;
      bob *= 0.86;
      const sway = idle ? Math.sin(t * 0.8) * 2.5 : a.live ? Math.sin(t * 2.2) * 1.5 : Math.sin(t * 2) * 4;
      const nod = a.live ? bob * 10 : idle ? 0 : (Math.sin(t * 4) + 1) * 1.5;
      head.setAttribute('transform', `translate(0 ${nod.toFixed(2)}) rotate(${sway.toFixed(2)} 200 240)`);
      body.setAttribute('transform', `translate(0 ${(nod * 0.3).toFixed(2)})`);

      // scratch on strong highs: the right hand rocks and that record runs backwards for a moment
      if (a.transient) scratchUntil = t + 0.45;
      const scratching = t < scratchUntil;
      const rock = scratching ? Math.sin(t * 38) : 0;
      armR.setAttribute('transform', `rotate(${(rock * 9).toFixed(2)} 262 268)`);
      armL.setAttribute('transform', `rotate(${(a.live ? -a.mid * 14 : Math.sin(t * 1.3) * 2).toFixed(2)} 138 268)`);

      // records: 33⅓ rpm-ish while playing
      if (a.playing) spin += (Math.PI * 2 * 0.55) / 60;
      marks.forEach((m, i) => {
        const ang = i === 1 && scratching ? spin - rock * 0.9 : spin + i * 1.7;
        const cx = i ? 300 : 100;
        m.setAttribute('cx', (cx + Math.cos(ang) * 36).toFixed(1));
        m.setAttribute('cy', (326 + Math.sin(ang) * 11).toFixed(1));
      });

      // blink every few seconds; when idle, yawn and adjust the headphones now and then
      if (t > nextBlink) nextBlink = t + 2.5 + Math.random() * 3.5;
      let lids = nextBlink - t < 0.12 ? 0.1 : 1;
      let yawn = 0;
      if (idle) {
        if (t > nextYawn + 1.8) nextYawn = t + 8 + Math.random() * 6;
        const y = t - nextYawn;
        if (y > 0) {
          yawn = Math.sin((Math.min(y, 1.8) / 1.8) * Math.PI);
          lids = Math.min(lids, 1 - yawn * 0.85);
        }
        if (t > nextAdjust + 1.2) nextAdjust = t + 10 + Math.random() * 8;
      }
      const adj = idle && t > nextAdjust ? Math.sin(((t - nextAdjust) / 1.2) * Math.PI) : 0;
      eyes.setAttribute('transform', `translate(0 166) scale(1 ${lids.toFixed(2)}) translate(0 -166)`);
      yawnMouth.setAttribute('transform', `translate(0 212) scale(1 ${yawn.toFixed(2)}) translate(0 -212)`);
      smile.style.opacity = yawn > 0.15 ? '0' : '1';
      phones.setAttribute('transform', `translate(0 ${(-6 * adj).toFixed(2)})`);

      tail.setAttribute('transform', `rotate(${(Math.sin(t * (idle ? 0.9 : 1.8)) * 7 + bob * 4).toFixed(2)} 268 292)`);
      spot.style.opacity = (0.18 + a.bass * 0.55).toFixed(2);

      // mixer meters (5 lights per band) and the front light strip, which chases on beats
      const levels = [a.bass, a.mid, a.treble * 1.6];
      for (const led of leds) {
        const [band, step] = led.dataset.level!.split(':').map(Number);
        led.style.opacity = levels[band] * 6 > step ? '1' : '0.15';
      }
      if (a.beat) pulse = (pulse + 1) % strip.length;
      strip.forEach((s, i) => (s.style.opacity = a.playing ? ((i + pulse) % 3 === 0 ? '1' : '0.3') : '0.15'));
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <svg ref={root} className="np-scene-canvas raccoon" viewBox="0 0 400 400" role="img" aria-label="A raccoon DJ playing records">
      <defs>
        <radialGradient id="raccoon-spot">
          <stop offset="0" className="spot-stop" />
          <stop offset="1" className="spot-stop" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse data-part="spot" cx="200" cy="200" rx="190" ry="170" fill="url(#raccoon-spot)" />

      <g data-part="tail">
        <path d="M268 292 C 330 292, 352 244, 330 196" className="fur-mid" fill="none" strokeWidth="26" strokeLinecap="round" />
        <path d="M268 292 C 330 292, 352 244, 330 196" className="fur-dark" fill="none" strokeWidth="26" strokeDasharray="13 13" strokeDashoffset="6" />
      </g>

      <g data-part="body">
        <path className="hoodie" d="M116 304 C 116 262, 150 244, 200 244 C 250 244, 284 262, 284 304 Z" />
        <ellipse className="hoodie-shade" cx="200" cy="248" rx="54" ry="13" />
        <path d="M190 254 L188 284 M210 254 L212 284" className="strings" strokeWidth="3" strokeLinecap="round" />
      </g>

      <g data-part="head">
        <ellipse className="fur-mid" cx="138" cy="122" rx="22" ry="28" transform="rotate(-20 138 122)" />
        <ellipse className="fur-dark" cx="140" cy="125" rx="11" ry="16" transform="rotate(-20 140 125)" />
        <ellipse className="fur-mid" cx="262" cy="122" rx="22" ry="28" transform="rotate(20 262 122)" />
        <ellipse className="fur-dark" cx="260" cy="125" rx="11" ry="16" transform="rotate(20 260 125)" />
        <ellipse className="fur-mid" cx="200" cy="178" rx="80" ry="66" />
        <path className="fur-light" d="M122 196 Q 140 236 196 242 Q 150 214 122 196 Z M278 196 Q 260 236 204 242 Q 250 214 278 196 Z" />
        <path className="fur-dark-soft" d="M192 114 Q 200 110 208 114 L 204 156 L 196 156 Z" />
        <path className="fur-dark" d="M134 166 Q 150 140 184 154 Q 200 160 216 154 Q 250 140 266 166 Q 254 190 228 186 Q 210 182 200 176 Q 190 182 172 186 Q 146 190 134 166 Z" />
        <ellipse className="fur-light" cx="200" cy="208" rx="34" ry="24" />
        <g data-part="eyes">
          <circle cx="170" cy="166" r="9" fill="#fff" />
          <circle cx="230" cy="166" r="9" fill="#fff" />
          <circle cx="171" cy="167" r="5" fill="#111" />
          <circle cx="229" cy="167" r="5" fill="#111" />
          <circle cx="173" cy="164" r="1.6" fill="#fff" />
          <circle cx="231" cy="164" r="1.6" fill="#fff" />
        </g>
        <ellipse cx="200" cy="194" rx="10" ry="7" fill="#111" />
        <path data-part="smile" d="M186 212 Q 200 224 214 212" fill="none" stroke="#2b2b31" strokeWidth="3" strokeLinecap="round" />
        <ellipse data-part="yawn" cx="200" cy="220" rx="10" ry="11" fill="#5a1a24" transform="scale(1 0)" />

        <g data-part="phones">
          <path d="M122 182 C 122 80, 278 80, 278 182" className="phones" fill="none" strokeWidth="9" strokeLinecap="round" />
          <rect className="phones-cup" x="106" y="156" width="24" height="48" rx="10" />
          <rect className="phones-cup" x="270" y="156" width="24" height="48" rx="10" />
          <rect className="phones-pad" x="112" y="164" width="12" height="32" rx="6" />
          <rect className="phones-pad" x="276" y="164" width="12" height="32" rx="6" />
        </g>

        {/* holiday hats: hidden unless the skin shows one (styles.css) */}
        <g className="hat hat-witch">
          <path d="M150 112 L 214 18 Q 222 10 226 22 L 250 112 Z" fill="#2a1638" />
          <rect x="160" y="96" width="84" height="12" fill="#ff7a1a" />
          <ellipse cx="200" cy="112" rx="72" ry="12" fill="#1b0f24" />
        </g>
        <g className="hat hat-pilgrim">
          <path d="M160 112 L 170 40 L 230 40 L 240 112 Z" fill="#1d1a17" />
          <rect x="166" y="92" width="68" height="14" fill="#3a2a1a" />
          <rect x="190" y="90" width="20" height="18" rx="2" fill="none" stroke="#e8c15a" strokeWidth="4" />
          <ellipse cx="200" cy="112" rx="66" ry="10" fill="#141210" />
        </g>
        <g className="hat hat-santa">
          <path d="M146 112 Q 170 30 236 40 Q 270 50 282 92 L 254 104 Q 244 70 226 66 L 254 112 Z" fill="#d42a2a" />
          <rect x="140" y="100" width="120" height="20" rx="10" fill="#fff" />
          <circle cx="282" cy="96" r="12" fill="#fff" />
        </g>
        <g className="hat hat-sam">
          <path d="M166 112 L 172 30 L 228 30 L 234 112 Z" fill="#fff" />
          <path d="M170 36 L 230 36 M169 52 L 231 52 M168 68 L 232 68 M167 84 L 233 84" stroke="#e63946" strokeWidth="8" />
          <rect x="164" y="90" width="72" height="16" fill="#1d3b8f" />
          <circle cx="182" cy="98" r="3" fill="#fff" /><circle cx="200" cy="98" r="3" fill="#fff" /><circle cx="218" cy="98" r="3" fill="#fff" />
          <ellipse cx="200" cy="112" rx="64" ry="10" fill="#1d3b8f" />
        </g>
        <g className="hat hat-hearts">
          <path d="M176 112 Q 168 76 160 52 M224 112 Q 232 76 240 52" fill="none" stroke="#3d0f1f" strokeWidth="3" />
          <path d="M160 58 C 146 44, 146 28, 160 32 C 174 28, 174 44, 160 58 Z" fill="#e0245e" />
          <path d="M240 58 C 226 44, 226 28, 240 32 C 254 28, 254 44, 240 58 Z" fill="#ff5c8a" />
        </g>
      </g>

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

      <g data-part="arm-l">
        <path className="sleeve" d="M138 268 Q 146 300 176 318" fill="none" strokeWidth="20" strokeLinecap="round" />
        <circle className="fur-mid" cx="178" cy="320" r="11" />
        <circle className="fur-dark" cx="186" cy="318" r="3.5" />
      </g>
      <g data-part="arm-r">
        <path className="sleeve" d="M262 268 Q 284 290 290 316" fill="none" strokeWidth="20" strokeLinecap="round" />
        <circle className="fur-mid" cx="290" cy="318" r="11" />
        <circle className="fur-dark" cx="283" cy="316" r="3.5" />
      </g>
    </svg>
  );
}
