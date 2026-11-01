/**
 * What a song sounds like, from its audio (sonic/worker.ts decodes it with ffmpeg to mono 22 050 Hz floats).
 * No machine-learning model: classic signal features that are cheap to compute on a NAS CPU and good enough to
 * tell a ballad from a banger and rap from metal:
 *
 * - **Timbre**: the average and spread of 24 log-mel bands (how bright, bassy, dense or sparse it sounds).
 * - **Harmony**: a 12-bin chroma (which notes sound most), which also gives the **key** (Krumhansl–Schmuckler
 *   profiles, major or minor).
 * - **Tempo**: the autocorrelation of the onset strength (spectral flux) between 60 and 190 BPM, and how strong
 *   that beat is (**beat strength**, 0..1), plus the first beat's time for AutoMix.
 * - **Loudness** (RMS, dB), **energy** (loudness and onset density, 0..1) and **brightness** (spectral centroid).
 *
 * `vector()` packs them for nearest-neighbour search (sonic/index.ts), which z-scores each dimension across the
 * library first so no single feature dominates.
 */

export interface SonicFeatures {
  bpm: number;
  /** 0..1, how clear the beat is */
  beatStrength: number;
  /** seconds into the analysed stretch of the first beat; with `offset`, where beats fall in the song */
  beatPhase: number;
  /** "C major", "A minor" … */
  key: string;
  /** dBFS */
  loudness: number;
  energy: number;
  /** Hz */
  brightness: number;
  mel: number[];
  melSpread: number[];
  chroma: number[];
}

export const SR = 22_050;
const N = 2048;
const HOP = 512;
const MELS = 24;

/** In-place radix-2 FFT of re/im (length a power of two). */
export function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

const hzToMel = (f: number) => 2595 * Math.log10(1 + f / 700);
const melToHz = (m: number) => 700 * (10 ** (m / 2595) - 1);

/** Triangular mel filters over the FFT bins, 40 Hz to 10 kHz. */
function melFilters(): { lo: number; mid: number; hi: number }[] {
  const lo = hzToMel(40), hi = hzToMel(10_000);
  const pts = Array.from({ length: MELS + 2 }, (_, i) => Math.round((melToHz(lo + ((hi - lo) * i) / (MELS + 1)) * N) / SR));
  return Array.from({ length: MELS }, (_, i) => ({ lo: pts[i], mid: Math.max(pts[i] + 1, pts[i + 1]), hi: Math.max(pts[i] + 2, pts[i + 2]) }));
}

// Krumhansl–Kessler key profiles
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function correlate(a: number[], b: number[]) {
  const ma = a.reduce((x, y) => x + y, 0) / a.length, mb = b.reduce((x, y) => x + y, 0) / b.length;
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    n += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return n / Math.sqrt(da * db || 1);
}

export function keyOf(chroma: number[]): string {
  let best = { r: -2, name: 'C major' };
  for (let t = 0; t < 12; t++) {
    const rot = chroma.map((_, i) => chroma[(i + t) % 12]);
    const maj = correlate(rot, MAJOR), min = correlate(rot, MINOR);
    if (maj > best.r) best = { r: maj, name: `${NOTES[t]} major` };
    if (min > best.r) best = { r: min, name: `${NOTES[t]} minor` };
  }
  return best.name;
}

/** Tempo from an onset envelope sampled every `hop` seconds. */
export function tempoOf(env: Float64Array, hop: number): { bpm: number; strength: number; phase: number } {
  const n = env.length;
  const mean = env.reduce((a, b) => a + b, 0) / (n || 1);
  const x = env.map((v) => v - mean);
  const lag = (bpm: number) => 60 / bpm / hop;
  const ac = (l: number) => {
    // linear interpolation between whole lags
    const a = Math.floor(l), f = l - a;
    let s = 0;
    for (let i = 0; i + a + 1 < n; i++) s += x[i] * (x[i + a] * (1 - f) + x[i + a + 1] * f);
    return s;
  };
  const zero = ac(0) || 1;
  let best = { bpm: 120, v: -Infinity };
  for (let bpm = 60; bpm <= 190; bpm += 0.5) {
    // favour the "felt" tempo a little (Gaussian around 120 on a log scale), and reward the half-tempo lag too
    const w = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    const v = (ac(lag(bpm)) + 0.5 * ac(lag(bpm) * 2)) * w;
    if (v > best.v) best = { bpm, v };
  }
  const strength = Math.max(0, Math.min(1, ac(lag(best.bpm)) / zero));
  // phase: where along one beat period the onsets line up best
  const period = lag(best.bpm);
  let phase = 0, top = -Infinity;
  for (let p = 0; p < period; p += 1) {
    let s = 0;
    for (let t = p; t < n; t += period) s += env[Math.round(t)] ?? 0;
    if (s > top) {
      top = s;
      phase = p;
    }
  }
  return { bpm: Math.round(best.bpm * 10) / 10, strength: Math.round(strength * 100) / 100, phase: phase * hop };
}

/** Analyse mono samples at SR. Needs at least a few seconds. */
export function analyse(samples: Float32Array): SonicFeatures {
  const filters = melFilters();
  const win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const frames = Math.max(0, Math.floor((samples.length - N) / HOP));
  const melSum = new Float64Array(MELS), melSq = new Float64Array(MELS);
  const chroma = new Float64Array(12);
  const flux = new Float64Array(frames);
  let prev = new Float64Array(N / 2);
  let rmsSum = 0, centroidSum = 0, centroidW = 0;
  const re = new Float64Array(N), im = new Float64Array(N);
  // chroma bins: each FFT bin from 55 Hz to 5 kHz to its pitch class
  const pc = new Int8Array(N / 2).fill(-1);
  for (let k = 1; k < N / 2; k++) {
    const f = (k * SR) / N;
    if (f >= 55 && f <= 5000) pc[k] = ((Math.round(12 * Math.log2(f / 440)) + 9) % 12 + 12) % 12;
  }
  for (let fr = 0; fr < frames; fr++) {
    const o = fr * HOP;
    let e = 0;
    for (let i = 0; i < N; i++) {
      const v = samples[o + i];
      e += v * v;
      re[i] = v * win[i];
      im[i] = 0;
    }
    rmsSum += e / N;
    fft(re, im);
    const mag = new Float64Array(N / 2);
    let fl = 0, cs = 0, cw = 0;
    for (let k = 0; k < N / 2; k++) {
      const m = Math.hypot(re[k], im[k]);
      mag[k] = m;
      const d = Math.log1p(m) - Math.log1p(prev[k]);
      if (d > 0) fl += d;
      cs += k * m;
      cw += m;
      if (pc[k] >= 0) chroma[pc[k]] += m * m;
    }
    flux[fr] = fl;
    prev = mag;
    if (cw > 0) {
      centroidSum += (cs / cw) * cw;
      centroidW += cw;
    }
    for (let b = 0; b < MELS; b++) {
      const { lo, mid, hi } = filters[b];
      let s = 0;
      for (let k = lo; k < hi && k < N / 2; k++) s += mag[k] * (k < mid ? (k - lo) / (mid - lo) : (hi - k) / (hi - mid));
      const l = Math.log10(s + 1e-6);
      melSum[b] += l;
      melSq[b] += l * l;
    }
  }
  const f = frames || 1;
  const mel = [...melSum].map((s) => s / f);
  const melSpread = [...melSq].map((s, i) => Math.sqrt(Math.max(0, s / f - mel[i] ** 2)));
  const cmax = Math.max(...chroma, 1e-12);
  const chromaN = [...chroma].map((c) => c / cmax);
  const loudness = 10 * Math.log10(rmsSum / f + 1e-12);
  const t = tempoOf(flux, HOP / SR);
  const onsetRate = flux.reduce((a, b) => a + b, 0) / f;
  const energy = Math.max(0, Math.min(1, ((loudness + 30) / 25) * 0.6 + Math.min(1, onsetRate / 60) * 0.4));
  const brightness = centroidW > 0 ? ((centroidSum / centroidW) * SR) / N : 0;
  const r = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
  return {
    bpm: t.bpm,
    beatStrength: t.strength,
    beatPhase: r(t.phase),
    key: keyOf(chromaN),
    loudness: r(loudness, 1),
    energy: r(energy, 2),
    brightness: Math.round(brightness),
    mel: mel.map((v) => r(v)),
    melSpread: melSpread.map((v) => r(v)),
    chroma: chromaN.map((v) => r(v)),
  };
}

/** A rough mood from the features, for filters and descriptions. */
export function moodOf(f: Pick<SonicFeatures, 'energy' | 'key' | 'bpm' | 'brightness' | 'beatStrength'>): 'energetic' | 'upbeat' | 'chill' | 'dark' | 'mellow' {
  const minor = f.key.endsWith('minor');
  if (f.energy > 0.7 && f.bpm >= 115) return 'energetic';
  if (f.energy > 0.5 && !minor) return 'upbeat';
  if (minor && f.brightness < 1800) return 'dark';
  if (f.energy < 0.35) return 'mellow';
  return 'chill';
}

/** The numbers nearest-neighbour search compares (sonic/index.ts z-scores them). */
export function vector(f: SonicFeatures): number[] {
  return [...f.mel, ...f.melSpread.map((v) => v * 2), ...f.chroma.map((v) => v * 0.5), f.bpm / 40, f.energy * 4, f.brightness / 800, f.beatStrength * 2];
}
