import { lineAt, sungLinesFor, type SungLine } from '../lib/singAlong';
import { featureOn } from '../lib/features';
import { sourceFor } from '../sources/registry';
import { usePlayer } from '../store/player';
import { useSettings } from '../store/settings';
import type { AudioSample } from './analysis';
import { engine } from './engine';
import { shapeAt, vowelFromFormants, type Viseme } from './visemes';
import { DEFAULT_TUNE, dbToLinear, heardInMono, newVoiceState, voiceFrame, type MouthTune } from './voice';

/**
 * How open a singing mouth should be, 0..1, each frame (components/critters/rig.ts). Combines the vocal
 * detector (player/voice.ts) with the song's synced lyrics (lib/singAlong.ts):
 *
 * - readable audio + synced lyrics: the detector, but only inside sung lines (shut in intros, solos, gaps), and
 *   a little more willing to open inside one;
 * - readable audio, no synced lyrics: the detector alone;
 * - audio the app can't read (no CORS), or a mono song (the detector needs stereo to find the voice) +
 *   synced lyrics: mouthing in time with each line's syllables;
 * - neither: a gentle made-up chatter while playing.
 *
 * The knobs come from the mouth tuner (Settings → Playback, `mouthTune`), plus a lyrics offset per song
 * (`mouthOffsets`), unless a Hub admin turned the tuner off (lib/features.ts), which puts the defaults back.
 */

/** What the reader saw on its last frame, for the tuner's meters and graph (components/MouthTuner.tsx). */
export interface SingingReading {
  /** the detector's output, 0..1 (before the lyrics gate) */
  detector: number;
  /** what the mouth was told, 0..1 */
  mouth: number;
  /** 'sung' inside a synced line, 'gap' between lines, 'none' without synced lyrics */
  line: 'sung' | 'gap' | 'none';
  /** how the mouth was driven this frame */
  mode: 'voice' | 'lyrics' | 'chatter' | 'quiet';
  mono: boolean;
  centred: number;
  tonal: number;
  /** centre level and the song's recent loudest, dB */
  level: number;
  loud: number;
  hit: boolean;
  live: boolean;
  /**
   * the mouth shape the singing suggests (player/visemes.ts): the lyric syllable being sung, else a rough vowel
   * from the voice spectrum, else null (the face picks one)
   */
  shape: Viseme | null;
  /** 0..1, how bright (high) the voice sounds: its spectral centre between ~300 Hz and ~2.5 kHz */
  bright: number;
  at: number;
}

export const singingReading: SingingReading = { detector: 0, mouth: 0, line: 'none', mode: 'quiet', mono: false, centred: 0, tonal: 0, level: -120, loud: -60, hit: false, live: false, shape: null, bright: 0, at: 0 };

/** The tune in force: the person's own, or the defaults when the tuner is switched off on the Hub. */
export function currentTune(): MouthTune {
  return featureOn('mouthTuner') ? useSettings.getState().mouthTune : DEFAULT_TUNE;
}

/** The key the per-song lyrics offset is saved under. */
export const offsetKey = (t: { sourceId: string; id: string } | undefined) => (t ? `${t.sourceId}:${t.id}` : '');

export function createSingingReader() {
  const state = newVoiceState();
  let mid = new Float32Array(1024);
  let side = new Float32Array(1024);

  const report = (r: Partial<SingingReading>, out: number) => {
    Object.assign(singingReading, r, { mouth: out, centred: state.centred, tonal: state.tonal, level: state.level, loud: state.loud, hit: state.hit, mono: heardInMono(state), at: performance.now() });
    return out;
  };

  // smoothed formant bands and brightness, so the guessed shape doesn't flicker frame to frame
  let f1Low = 0;
  let f1High = 0;
  let f2 = 0;
  let bright = 0;

  /** The syllable being sung in `line` at song time `pos`, as `singing.ts` times them (one hump each). */
  const lyricShape = (line: SungLine, pos: number, rate: number) => {
    const x = Math.max(0, rate * pos);
    return shapeAt(line.shapes, Math.floor(x), x % 1);
  };

  /** Formant bands and brightness from the centre spectrum (linear magnitudes), smoothed. */
  const listen = (m: Float32Array, s: Float32Array, binHz: number) => {
    const band = (lo: number, hi: number) => {
      let p = 0;
      for (let i = Math.round(lo / binHz); i <= Math.round(hi / binHz) && i < m.length; i++) {
        const c = m[i] * Math.min(1, Math.max(0, 1 - (2 * s[i]) / (m[i] + 1e-9)));
        p += c * c;
      }
      return p;
    };
    const k = 0.25;
    f1Low += (band(250, 550) - f1Low) * k;
    f1High += (band(550, 1000) - f1High) * k;
    f2 += (band(1800, 3000) - f2) * k;
    let w = 0;
    let wf = 0;
    for (let i = Math.round(300 / binHz); i <= Math.round(2500 / binHz) && i < m.length; i++) {
      w += m[i];
      wf += m[i] * i * binHz;
    }
    const centre = w > 1e-9 ? wf / w : 300;
    bright += (Math.min(1, Math.max(0, (centre - 600) / 1400)) - bright) * 0.1;
  };

  return (t: number, a: AudioSample): number => {
    if (!a.playing) return report({ detector: 0, mode: 'quiet', line: 'none', live: false, shape: null }, 0);
    const tune = currentTune();
    const track = usePlayer.getState().current();
    const sung = tune.useLyrics
      ? sungLinesFor(track, () => {
          const cfg = track && useSettings.getState().sources.find((s) => s.id === track.sourceId);
          return cfg ? sourceFor(cfg) : undefined;
        }, tune.syllable)
      : undefined;
    const pos = engine.el.currentTime;
    const offset = tune.lyricsOffset + (featureOn('mouthTuner') ? useSettings.getState().mouthOffsets[offsetKey(track)] ?? 0 : 0);
    const line = lineAt(sung, pos, offset);
    const lineState: SingingReading['line'] = line === undefined ? 'none' : line ? 'sung' : 'gap';

    const taps = a.live ? engine.voiceTaps() : null;
    let detector = 0;
    if (taps) {
      if (mid.length !== taps.mid.frequencyBinCount) {
        mid = new Float32Array(taps.mid.frequencyBinCount);
        side = new Float32Array(taps.side.frequencyBinCount);
      }
      taps.mid.getFloatFrequencyData(mid);
      taps.side.getFloatFrequencyData(side);
      const binHz = taps.sampleRate / taps.mid.fftSize;
      dbToLinear(mid);
      dbToLinear(side);
      detector = voiceFrame(state, mid, side, binHz, t, !!line, tune);
      listen(mid, side, binHz);
      if (line === null) return report({ detector, mode: 'quiet', line: lineState, live: true, shape: null, bright }, 0);
      // in mono the detector can't tell the voice from the band: follow the lyrics' syllables when we have them
      if (!line || !tune.monoFallback || !heardInMono(state)) {
        const shape = line ? lyricShape(line, pos - offset - line.start, line.syllables / Math.max(0.5, line.end - line.start)) : vowelFromFormants(f1Low, f1High, f2);
        return report({ detector, mode: 'voice', line: lineState, live: true, shape, bright }, detector);
      }
    }
    if (line) {
      const rate = line.syllables / Math.max(0.5, line.end - line.start);
      const at = pos - offset - line.start;
      // without the audio, brightness follows the vowel: ee sounds brighter than oh
      const shape = lyricShape(line, at, rate);
      if (!taps) bright += ((shape === 'ee' ? 0.7 : shape === 'ah' ? 0.45 : 0.2) - bright) * 0.1;
      return report({ detector, mode: 'lyrics', line: lineState, live: !!taps, shape, bright }, Math.abs(Math.sin(Math.PI * rate * at)) * 0.85);
    }
    if (line === null) return report({ detector, mode: 'quiet', line: lineState, live: !!taps, shape: null, bright }, 0);
    return report({ detector, mode: 'chatter', line: lineState, live: !!taps, shape: null, bright }, Math.max(0, Math.sin(t * 7.5) * Math.sin(t * 2.3 + 1)) * 0.7);
  };
}
