/**
 * "Is someone singing right now, and how loud?" for the critters' mouths (components/critters/rig.ts).
 *
 * True voice separation needs a neural model, too heavy to run live here. Instead each frame looks at the
 * spectrum the way a listener picks out a voice:
 *
 * - **Centre channel.** Lead vocals are mixed to the middle; guitars, keys, reverb and backing parts are often
 *   spread wide. The engine taps mid (L+R) and side (L−R) spectra (`engine.voiceTaps`). Per bin, the more
 *   side there is next to mid, the less of it counts, so a part panned even halfway drops out. The voice
 *   must make up a good share of the whole voice range, so a centred voice over a wide band stands out.
 * - **Voice range.** Only ~150 Hz to 4 kHz counts: sung fundamentals and the formants that make vowels.
 * - **Tonal, not noisy.** A voice is a stack of harmonics, a peaky spectrum; a snare, hi-hat or clap is broadband
 *   noise, a flat one. Spectral flatness over the voice range scales the level down for flat (noisy) frames.
 * - **Drum hits rejected.** A sudden jump in the very low (kick) or very high (cymbals, snare crack) bands marks
 *   a hit; for a moment after one the level can't rise.
 * - **Loud enough.** The centre level is in dB against the song's recent loudest, so quiet and loud songs both
 *   open the mouth fully on a sung syllable and close it between them.
 *
 * Centred, tonal instruments (a synth lead, a centred keyboard) can still open it; that's what the lyrics
 * gate is for. Synced lyrics (lib/singAlong.ts) gate it in `singing.ts`: mouths stay shut outside sung lines,
 * and inside one (`inLine`) the centre test is looser, since the line already says someone is singing.
 *
 * **Mono songs** (old recordings, mono streams, or a mono file the browser upmixes to L = R) have no side
 * channel, so everything looks centred and the mouth would open for any instrument. `heardInMono` notices
 * and `singing.ts` falls back to mouthing the lyrics' syllables instead.
 *
 * Measured on real songs (Oct 2026; vocals separated with Spleeter for the answer key, the analysers
 * simulated frame by frame): the mouth opens about 33 ms after the voice. With synced lyrics it opens on 72%
 * and 62% of the sung moments in two stereo pop songs (53% and 19% before the looser in-line test) and on 2%
 * or less of the rest. Without lyrics, the strict test opens on 1–3% of three stereo instrumentals.
 */

export interface VoiceState {
  /** loudest recent centre level in the voice range, dB (decays slowly) */
  loud: number;
  /** previous low / high band levels, for hit detection */
  low: number;
  high: number;
  /** level can't rise until this time (s), after a drum hit */
  holdUntil: number;
  /** last output */
  out: number;
  /** side against mid power in the voice range, averaged over a few seconds: near 0 for a mono song */
  width: number;
  /** the last frame's parts, for the tuner's meters: centre share 0..1, tonal 0..1, level dB, drum hit */
  centred: number;
  tonal: number;
  level: number;
  hit: boolean;
}

export const newVoiceState = (): VoiceState => ({ loud: -60, low: 0, high: 0, holdUntil: -1, out: 0, width: 0.2, centred: 0, tonal: 0, level: -120, hit: false });

/**
 * The knobs of the mouth tuner (Settings → Playback → Tune mouths, components/MouthTuner.tsx). The defaults are
 * the values measured in Oct 2026 (above); people can move them to fit their music and their ears.
 */
export interface MouthTune {
  /** how far below the song's recent loudest centre level the mouth shuts, dB (bigger opens on quieter singing) */
  sensitivity: number;
  /** 0..1, how much of the voice range must sit in the centre before it counts (outside a sung line) */
  centre: number;
  /** the voice range, Hz */
  lowHz: number;
  highHz: number;
  /** 0..1, spectral flatness above which a frame counts as noise (drums, hiss), not voice */
  noise: number;
  /** after a drum hit the level can't rise for this long, ms */
  drumHoldMs: number;
  /** shut the mouth outside sung lines when the song has synced lyrics */
  useLyrics: boolean;
  /** seconds to shift the lyrics by: + when the lyrics come in too early (the singing is later) */
  lyricsOffset: number;
  /** seconds per syllable, for mouthing along with a line's words */
  syllable: number;
  /** 0..1, how fast the mouth opens and closes */
  attack: number;
  release: number;
  /** 0..1, how wide the mouth opens at most */
  gain: number;
  /** on mono songs, follow the lyrics' syllables instead of the audio (the centre test can't work in mono) */
  monoFallback: boolean;
}

export const DEFAULT_TUNE: MouthTune = {
  sensitivity: 24,
  centre: 0.4,
  lowHz: 150,
  highHz: 4000,
  noise: 0.5,
  drumHoldMs: 90,
  useLyrics: true,
  lyricsOffset: 0,
  syllable: 0.32,
  attack: 0.55,
  release: 0.3,
  gain: 0.9,
  monoFallback: true,
};

/** A saved tune with any missing or broken values back at their defaults. */
export function cleanTune(t: Partial<MouthTune> | undefined | null): MouthTune {
  const out = { ...DEFAULT_TUNE };
  if (!t || typeof t !== 'object') return out;
  for (const k of Object.keys(DEFAULT_TUNE) as (keyof MouthTune)[]) {
    const v = t[k];
    if (typeof v === typeof DEFAULT_TUNE[k] && (typeof v !== 'number' || Number.isFinite(v))) (out as Record<string, unknown>)[k] = v;
  }
  if (out.highHz <= out.lowHz + 100) out.highHz = out.lowHz + 100;
  return out;
}

/**
 * True once the song has had (almost) no side channel for a few seconds: stereo songs measured 0.17 to 0.5,
 * a mono one 0.003. The centre test can't find a voice in mono.
 */
export const heardInMono = (s: VoiceState) => s.width < 0.02;

const db = (p: number) => 10 * Math.log10(p + 1e-12);

/**
 * One frame. `mid` and `side` are linear magnitude spectra of the same size; `binHz` is the width of a bin;
 * `t` is seconds; `inLine` when synced lyrics say a line is being sung now. Returns 0..1, how strongly a
 * centred, tonal voice is sounding.
 */
export function voiceFrame(s: VoiceState, mid: ArrayLike<number>, side: ArrayLike<number>, binHz: number, t: number, inLine = false, tune: MouthTune = DEFAULT_TUNE): number {
  const bin = (hz: number) => Math.min(mid.length - 1, Math.max(0, Math.round(hz / binHz)));
  const lo = bin(tune.lowHz);
  const hi = Math.max(lo, bin(tune.highHz));

  // centre spectrum in the voice range. Each bin keeps the part of mid that side doesn't explain: a centred
  // voice has almost no side, a part panned even halfway has side about half of mid and drops out.
  let power = 0;
  let midPower = 0;
  let sidePower = 0;
  let sum = 0;
  let logSum = 0;
  for (let i = lo; i <= hi; i++) {
    const m = mid[i];
    const c = m * Math.min(1, Math.max(0, 1 - (2 * side[i]) / (m + 1e-9)));
    power += c * c;
    midPower += m * m;
    sidePower += side[i] * side[i];
    sum += c;
    logSum += Math.log(c + 1e-9);
  }
  const n = hi - lo + 1;
  const mean = sum / n;
  const flatness = mean > 1e-9 ? Math.exp(logSum / n) / mean : 1;
  // voice ≈ 0.05–0.3, noise ≈ 0.5+
  const tonal = Math.min(1, Math.max(0, (tune.noise - flatness) / 0.3));
  // how much of the voice range sits in the centre: high while a lead vocal sings over the band. A busy stereo
  // mix keeps it low even under a clear voice (one test song sang at a median of 0.3), so inside a sung line
  // it counts from 0.2 instead of 0.4.
  const share = power / (midPower + 1e-12);
  const from = inLine ? tune.centre / 2 : tune.centre;
  const centred = Math.min(1, Math.max(0, (share - from) / 0.4));
  if (midPower > 1e-10) s.width += (sidePower / midPower - s.width) * 0.02;

  // drum hits: a jump in the kick band (40–120 Hz) or the cymbal/snare band (6–12 kHz) on the mid channel
  const band = (a: number, b: number) => {
    let p = 0;
    for (let i = bin(a); i <= bin(b); i++) p += mid[i] * mid[i];
    return p / (bin(b) - bin(a) + 1);
  };
  const low = band(40, 120);
  const high = band(6000, 12000);
  const hit = (low > s.low * 2.2 && low > 1e-4) || (high > s.high * 2.5 && high > 1e-5);
  s.low = s.low * 0.8 + low * 0.2;
  s.high = s.high * 0.8 + high * 0.2;
  if (hit) s.holdUntil = t + tune.drumHoldMs / 1000;

  // and loud enough: against the song's recent loudest centre level, shut ~24 dB below it
  const level = db(power / n);
  s.loud = Math.max(level, s.loud - 0.04);
  let v = centred * tonal * Math.min(1, Math.max(0, (level - (s.loud - tune.sensitivity)) / 12));
  if (level < -90) v = 0;
  if (t < s.holdUntil) v = Math.min(v, s.out);
  s.out = v;
  s.centred = centred;
  s.tonal = tonal;
  s.level = level;
  s.hit = hit;
  return v;
}

/** dB spectra from AnalyserNode.getFloatFrequencyData → linear magnitudes, in place. */
export function dbToLinear(spectrum: Float32Array): Float32Array {
  for (let i = 0; i < spectrum.length; i++) spectrum[i] = Number.isFinite(spectrum[i]) ? 10 ** (spectrum[i] / 20) : 0;
  return spectrum;
}
