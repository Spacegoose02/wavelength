import { lineAt, sungLinesFor } from '../lib/singAlong';
import { sourceFor } from '../sources/registry';
import { usePlayer } from '../store/player';
import { useSettings } from '../store/settings';
import type { AudioSample } from './analysis';
import { engine } from './engine';
import { dbToLinear, heardInMono, newVoiceState, voiceFrame } from './voice';

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
 */
export function createSingingReader() {
  const state = newVoiceState();
  let mid = new Float32Array(1024);
  let side = new Float32Array(1024);

  return (t: number, a: AudioSample): number => {
    if (!a.playing) return 0;
    const track = usePlayer.getState().current();
    const sung = sungLinesFor(track, () => {
      const cfg = track && useSettings.getState().sources.find((s) => s.id === track.sourceId);
      return cfg ? sourceFor(cfg) : undefined;
    });
    const pos = engine.el.currentTime;
    const line = lineAt(sung, pos);

    const taps = a.live ? engine.voiceTaps() : null;
    if (taps) {
      if (mid.length !== taps.mid.frequencyBinCount) {
        mid = new Float32Array(taps.mid.frequencyBinCount);
        side = new Float32Array(taps.side.frequencyBinCount);
      }
      taps.mid.getFloatFrequencyData(mid);
      taps.side.getFloatFrequencyData(side);
      const v = voiceFrame(state, dbToLinear(mid), dbToLinear(side), taps.sampleRate / taps.mid.fftSize, t, !!line);
      if (line === null) return 0;
      // in mono the detector can't tell the voice from the band: follow the lyrics' syllables when we have them
      if (!line || !heardInMono(state)) return v;
    }
    if (line) {
      const rate = line.syllables / Math.max(0.5, line.end - line.start);
      return Math.abs(Math.sin(Math.PI * rate * (pos - line.start))) * 0.85;
    }
    if (line === null) return 0;
    return Math.max(0, Math.sin(t * 7.5) * Math.sin(t * 2.3 + 1)) * 0.7;
  };
}
