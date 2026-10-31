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
 * gate below is for. On a test mix (drums, bass, double-tracked guitars, centred synth stabs and a centred
 * singer) this opened the mouth on 76% of sung frames and 9% of unsung ones, against 65% and 28% for the
 * plain vocal-band level it replaced. The lyrics gate roughly halves the unsung openings again.
 *
 * Synced lyrics (lib/singAlong.ts) then gate it: mouths stay shut outside sung lines.
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
}

export const newVoiceState = (): VoiceState => ({ loud: -60, low: 0, high: 0, holdUntil: -1, out: 0 });

const db = (p: number) => 10 * Math.log10(p + 1e-12);

/**
 * One frame. `mid` and `side` are linear magnitude spectra of the same size; `binHz` is the width of a bin;
 * `t` is seconds. Returns 0..1, how strongly a centred, tonal voice is sounding.
 */
export function voiceFrame(s: VoiceState, mid: ArrayLike<number>, side: ArrayLike<number>, binHz: number, t: number): number {
  const bin = (hz: number) => Math.min(mid.length - 1, Math.max(0, Math.round(hz / binHz)));
  const lo = bin(150);
  const hi = bin(4000);

  // centre spectrum in the voice range. Each bin keeps the part of mid that side doesn't explain: a centred
  // voice has almost no side, a part panned even halfway has side about half of mid and drops out.
  let power = 0;
  let midPower = 0;
  let sum = 0;
  let logSum = 0;
  for (let i = lo; i <= hi; i++) {
    const m = mid[i];
    const c = m * Math.min(1, Math.max(0, 1 - (2 * side[i]) / (m + 1e-9)));
    power += c * c;
    midPower += m * m;
    sum += c;
    logSum += Math.log(c + 1e-9);
  }
  const n = hi - lo + 1;
  const mean = sum / n;
  const flatness = mean > 1e-9 ? Math.exp(logSum / n) / mean : 1;
  // voice ≈ 0.05–0.3, noise ≈ 0.5+
  const tonal = Math.min(1, Math.max(0, (0.5 - flatness) / 0.3));
  // how much of the voice range sits in the centre: high while a lead vocal sings over the band
  const centred = Math.min(1, Math.max(0, (power / (midPower + 1e-12) - 0.4) / 0.4));

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
  if (hit) s.holdUntil = t + 0.09;

  // and loud enough: against the song's recent loudest centre level, shut ~24 dB below it
  const level = db(power / n);
  s.loud = Math.max(level, s.loud - 0.04);
  let v = centred * tonal * Math.min(1, Math.max(0, (level - (s.loud - 24)) / 12));
  if (level < -90) v = 0;
  if (t < s.holdUntil) v = Math.min(v, s.out);
  s.out = v;
  return v;
}

/** dB spectra from AnalyserNode.getFloatFrequencyData → linear magnitudes, in place. */
export function dbToLinear(spectrum: Float32Array): Float32Array {
  for (let i = 0; i < spectrum.length; i++) spectrum[i] = Number.isFinite(spectrum[i]) ? 10 ** (spectrum[i] / 20) : 0;
  return spectrum;
}
