import { useEffect, useRef } from 'react';
import { engine } from '../player/engine';
import { usePlayer } from '../store/player';
import { createCssVars, createPacer } from '../lib/framePace';

interface Props {
  bars?: number;
  /** 'classic' = Winamp segmented bars with falling peaks; 'smooth' = soft Plexamp-ish bars. */
  mode?: 'classic' | 'smooth';
  className?: string;
  /** covered by something (Now Playing over the deck): don't draw at all */
  off?: boolean;
}

export function Visualizer({ bars = 32, mode = 'classic', className, off = false }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (off) return;
    const canvas = ref.current!;
    const g = canvas.getContext('2d')!;
    const peaks = new Float32Array(bars);
    const levels = new Float32Array(bars);
    let data = new Uint8Array(256);
    let raf = 0;
    let t = 0;
    const pace = createPacer();
    const cssVar = createCssVars(canvas);

    const draw = (now = performance.now()) => {
      raf = requestAnimationFrame(draw);
      const playing = usePlayer.getState().playing;
      const dt = pace(now, playing);
      if (!dt) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);

      const analyser = engine.analyser();
      t += dt * 1.8; // 0.03 a frame at 60 Hz
      if (analyser && playing) {
        if (data.length !== analyser.frequencyBinCount) data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
      }

      const c1 = cssVar('--viz-low', '#00e000', now);
      const c2 = cssVar('--viz-mid', '#e0e000', now);
      const c3 = cssVar('--viz-high', '#ff3020', now);
      const grad = g.createLinearGradient(0, h, 0, 0);
      grad.addColorStop(0, c1);
      grad.addColorStop(0.6, c2);
      grad.addColorStop(1, c3);

      const gap = mode === 'classic' ? 1 : 3;
      const bw = (w - gap * (bars - 1)) / bars;
      for (let i = 0; i < bars; i++) {
        let v: number;
        if (analyser && playing) {
          // log-ish frequency spread so bass doesn't hog every bar
          const lo = Math.floor(Math.pow(i / bars, 1.8) * data.length * 0.7);
          const hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / bars, 1.8) * data.length * 0.7));
          let sum = 0;
          for (let j = lo; j < hi; j++) sum += data[j];
          v = sum / (hi - lo) / 255;
        } else if (playing) {
          // stream without CORS: no real data, show a gentle idle dance
          v = 0.25 + 0.2 * Math.sin(t * 2 + i * 0.5) * Math.sin(t * 0.7 + i * 0.13);
        } else v = 0;
        levels[i] += (v - levels[i]) * 0.5;
        const bh = Math.max(1, levels[i] * h);
        peaks[i] = Math.max(peaks[i] - h * 0.012, bh);
        const x = i * (bw + gap);
        g.fillStyle = grad;
        if (mode === 'classic') {
          for (let y = h; y > h - bh; y -= 3) g.fillRect(x, y - 2, bw, 2);
          g.fillStyle = cssVar('--viz-peak', '#c0c0c0', now);
          g.fillRect(x, h - peaks[i] - 2, bw, 1.5);
        } else {
          const r = Math.min(bw / 2, 4);
          g.beginPath();
          g.roundRect(x, h - bh, bw, bh, [r, r, 0, 0]);
          g.fill();
        }
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [bars, mode, off]);

  return <canvas ref={ref} className={className} />;
}
