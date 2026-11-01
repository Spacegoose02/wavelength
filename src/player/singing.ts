import { lineAt, sungLinesFor } from '../lib/singAlong';
import { featureOn } from '../lib/features';
import { sourceFor } from '../sources/registry';
import { usePlayer } from '../store/player';
import { useSettings } from '../store/settings';
import type { AudioSample } from './analysis';
import { engine } from './engine';
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
  at: number;
}

export const singingReading: SingingReading = { detector: 0, mouth: 0, line: 'none', mode: 'quiet', mono: false, centred: 0, tonal: 0, level: -120, loud: -60, hit: false, live: false, at: 0 };

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

  return (t: number, a: AudioSample): number => {
    if (!a.playing) return report({ detector: 0, mode: 'quiet', line: 'none', live: false }, 0);
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
      detector = voiceFrame(state, dbToLinear(mid), dbToLinear(side), taps.sampleRate / taps.mid.fftSize, t, !!line, tune);
      if (line === null) return report({ detector, mode: 'quiet', line: lineState, live: true }, 0);
      // in mono the detector can't tell the voice from the band: follow the lyrics' syllables when we have them
      if (!line || !tune.monoFallback || !heardInMono(state)) return report({ detector, mode: 'voice', line: lineState, live: true }, detector);
    }
    if (line) {
      const rate = line.syllables / Math.max(0.5, line.end - line.start);
      return report({ detector, mode: 'lyrics', line: lineState, live: !!taps }, Math.abs(Math.sin(Math.PI * rate * (pos - offset - line.start))) * 0.85);
    }
    if (line === null) return report({ detector, mode: 'quiet', line: lineState, live: !!taps }, 0);
    return report({ detector, mode: 'chatter', line: lineState, live: !!taps }, Math.max(0, Math.sin(t * 7.5) * Math.sin(t * 2.3 + 1)) * 0.7);
  };
}
