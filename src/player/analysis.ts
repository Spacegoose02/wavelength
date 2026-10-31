import { engine } from './engine';
import { usePlayer } from '../store/player';

export interface AudioSample {
  freq: Float32Array;
  wave: Float32Array;
  bass: number;
  mid: number;
  treble: number;
  /** bass jumped well above its recent average */
  beat: boolean;
  /** highs jumped well above their recent average (a snare, a clap, a scratch) */
  transient: boolean;
  /**
   * 0..1, how far the vocal band (about 250 Hz to 3 kHz) sits above its recent average: rises on sung or
   * spoken syllables and falls between them. The critters' mouths follow it. Made up while not `live`.
   */
  voice: number;
  /** false when the numbers are made up: paused, or a stream the WebView can't read (no CORS) */
  live: boolean;
  playing: boolean;
}

/**
 * Reads the shared analyser once a frame (see `engine.ts`) and finds beats. When there's no readable
 * audio (paused, or a CORS-less stream) it returns a calm synthetic signal instead, so scenes keep moving.
 * Call the returned function with the scene's clock in seconds.
 */
export function createAudioReader() {
  let bytes = new Uint8Array(256);
  let waveBytes = new Uint8Array(512);
  let freq = new Float32Array(256);
  let wave = new Float32Array(512);
  let avgBass = 0;
  let avgTreble = 0;
  let avgVocal = 0;
  let lastBeat = 0;
  let lastTransient = 0;

  return (t: number): AudioSample => {
    const analyser = engine.analyser();
    const playing = usePlayer.getState().playing;
    const live = !!analyser && playing;
    if (analyser && playing) {
      if (bytes.length !== analyser.frequencyBinCount) {
        bytes = new Uint8Array(analyser.frequencyBinCount);
        freq = new Float32Array(bytes.length);
      }
      if (waveBytes.length !== analyser.fftSize) {
        waveBytes = new Uint8Array(analyser.fftSize);
        wave = new Float32Array(waveBytes.length);
      }
      analyser.getByteFrequencyData(bytes);
      analyser.getByteTimeDomainData(waveBytes);
      for (let i = 0; i < bytes.length; i++) freq[i] = bytes[i] / 255;
      for (let i = 0; i < waveBytes.length; i++) wave[i] = (waveBytes[i] - 128) / 128;
    } else {
      // no readable audio (CORS-less stream) or paused: a calm synthetic signal
      const energy = playing ? 0.45 : 0.08;
      for (let i = 0; i < freq.length; i++) {
        const x = i / freq.length;
        freq[i] = energy * (1 - x) * (0.6 + 0.4 * Math.sin(t * 3 + i * 0.3) * Math.sin(t * 1.3 + i * 0.07));
      }
      for (let i = 0; i < wave.length; i++) wave[i] = energy * 0.5 * Math.sin(i * 0.05 + t * 6) * Math.sin(i * 0.011 + t);
    }

    const band = (a: number, b: number) => {
      const lo = Math.floor(a * freq.length);
      const hi = Math.max(lo + 1, Math.floor(b * freq.length));
      let s = 0;
      for (let i = lo; i < hi; i++) s += freq[i];
      return s / (hi - lo);
    };
    const bass = band(0, 0.06);
    const treble = band(0.3, 0.8);
    // at most ~4 beats a second, so one kick doesn't fire on several frames in a row
    const beat = bass > 0.35 && bass > avgBass * 1.25 && t - lastBeat > 0.25;
    if (beat) lastBeat = t;
    avgBass = avgBass * 0.93 + bass * 0.07;
    const transient = live && treble > 0.18 && treble > avgTreble * 1.6 && t - lastTransient > 0.6;
    if (transient) lastTransient = t;
    avgTreble = avgTreble * 0.9 + treble * 0.1;

    const vocal = band(0.012, 0.14);
    const voice = live
      ? Math.min(1, Math.max(0, vocal - avgVocal * 0.92) / Math.max(0.04, avgVocal * 0.35))
      : playing
        ? Math.max(0, Math.sin(t * 7.5) * Math.sin(t * 2.3 + 1)) * 0.9
        : 0;
    avgVocal = avgVocal * 0.96 + vocal * 0.04;

    return { freq, wave, bass, mid: band(0.06, 0.3), treble, beat, transient, voice, live, playing };
  };
}
