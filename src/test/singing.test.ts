import { describe, expect, it } from 'vitest';
import { lineAt, sungLines, syllables } from '../lib/singAlong';
import { heardInMono, newVoiceState, voiceFrame } from '../player/voice';

const BINS = 1024;
const BIN_HZ = 48000 / 2048;

/** A sung vowel: harmonics of `f0` under a couple of formant bumps, plus a faint noise floor. */
function voice(f0: number, amp = 0.2) {
  const s = new Float32Array(BINS).fill(1e-4);
  for (let h = 1; h * f0 < 5000; h++) {
    const f = h * f0;
    const formant = Math.exp(-(((f - 700) / 300) ** 2)) + 0.6 * Math.exp(-(((f - 1200) / 400) ** 2)) + 0.15;
    s[Math.round(f / BIN_HZ)] += amp * formant;
  }
  return s;
}
/** A drum hit: broadband noise, strongest in the lows and highs. */
function drum(amp = 0.2) {
  const s = new Float32Array(BINS);
  for (let i = 0; i < BINS; i++) s[i] = amp * (0.5 + 0.5 * ((i * 7919) % 13) / 13);
  return s;
}
const silence = () => new Float32Array(BINS).fill(1e-6);
const zero = () => new Float32Array(BINS);

/** Run a few warm-up frames of `warm`, then return the output for `frame`. */
function run(frames: [Float32Array, Float32Array][], inLine = false) {
  const st = newVoiceState();
  let v = 0;
  frames.forEach(([m, s], i) => (v = voiceFrame(st, m, s, BIN_HZ, i / 60, inLine)));
  return v;
}

/** A centred voice over a wide band: the band is as loud as the voice in mid and all of it is in side. */
function busyMix(): [Float32Array, Float32Array] {
  const v = voice(220);
  const band = voice(330, 0.14);
  const m = v.map((x, i) => x + band[i]);
  return [m, band];
}

describe('voiceFrame', () => {
  it('opens for a centred sung vowel', () => {
    expect(run(Array.from({ length: 20 }, () => [voice(220), zero()]))).toBeGreaterThan(0.6);
  });
  it('stays shut for silence', () => {
    expect(run(Array.from({ length: 20 }, () => [silence(), zero()]))).toBe(0);
  });
  it('ignores a drum hit', () => {
    const quiet: [Float32Array, Float32Array][] = Array.from({ length: 20 }, () => [silence(), zero()]);
    expect(run([...quiet, [drum(), zero()], [drum(0.1), zero()]])).toBeLessThan(0.15);
  });
  it('ignores a tone panned to one side (side as strong as mid)', () => {
    expect(run(Array.from({ length: 20 }, () => [voice(220), voice(220)]))).toBeLessThan(0.1);
  });
  it('opens for a voice in a busy stereo mix inside a sung line, but not outside one', () => {
    const frames = Array.from({ length: 30 }, busyMix);
    expect(run(frames, true)).toBeGreaterThan(0.3);
    expect(run(frames, false)).toBeLessThan(0.15);
  });
  it('notices a mono song (no side at all) within a few seconds, and not a stereo one', () => {
    const mono = newVoiceState();
    const stereo = newVoiceState();
    for (let i = 0; i < 180; i++) {
      voiceFrame(mono, voice(220), zero(), BIN_HZ, i / 60);
      voiceFrame(stereo, ...busyMix(), BIN_HZ, i / 60);
    }
    expect(heardInMono(mono)).toBe(true);
    expect(heardInMono(stereo)).toBe(false);
  });
  it('closes again when the voice stops', () => {
    const sing: [Float32Array, Float32Array][] = Array.from({ length: 20 }, () => [voice(220), zero()]);
    const rest: [Float32Array, Float32Array][] = Array.from({ length: 10 }, () => [voice(220, 0.002), zero()]);
    expect(run([...sing, ...rest])).toBeLessThan(0.1);
  });
});

describe('sing-along lyrics', () => {
  it('counts syllables roughly', () => {
    expect(syllables('Never gonna give you up')).toBe(7);
    expect(syllables('love')).toBe(1);
  });
  it('treats long gaps after a line as quiet, and empty lines as breaks', () => {
    const sung = sungLines([
      { time: 10, text: 'Hello darkness my old friend' },
      { time: 30, text: '' },
      { time: 40, text: 'I have come to talk' },
    ]);
    expect(sung).toHaveLength(2);
    expect(lineAt(sung, 11)?.start).toBe(10);
    expect(lineAt(sung, 20)).toBeNull(); // the line ended long before the next one
    expect(lineAt(sung, 35)).toBeNull();
    expect(lineAt(sung, 40.5)?.start).toBe(40);
    expect(lineAt(undefined, 5)).toBeUndefined();
    expect(lineAt([], 5)).toBeNull(); // instrumental
  });
});
