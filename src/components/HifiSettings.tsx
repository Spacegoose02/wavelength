import { useFeature } from '../lib/features';
import { useHifi } from '../lib/hifi';

/** Settings → Playback: bit-perfect output (lib/hifi.ts). Windows app only. */
export function HifiSettings() {
  const allowed = useFeature('exclusiveAudio');
  const { on, set, format, error, available } = useHifi();
  if (!allowed || !available) return null;
  return (
    <section id="bit-perfect">
      <h2>Bit-perfect output</h2>
      <p className="muted small">
        Plays songs straight to your sound card in exclusive mode, at each file's own sample rate and bit depth (a 96 kHz / 24-bit
        FLAC reaches your DAC as exactly that). While it's on, other apps can't play sound, and the equalizer, volume levelling,
        crossfade, sing mode and visualizers are off, since they would change the sound. Keep the volume slider at the top for
        bit-perfect; lower, and Wavelength turns it down digitally.
      </p>
      <label className="check">
        <span className="switch"><input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} /><span /></span>
        <span><b>Bit-perfect (WASAPI exclusive)</b>{on && format ? <span className="muted"> · now {format}</span> : null}</span>
      </label>
      {on && error && <p className="errors">{error}</p>}
      <p className="muted small">
        FLAC, ALAC, WAV, AIFF, MP3, AAC and Ogg Vorbis. Turn on <i>Allow applications to take exclusive control of this device</i>
        in Windows' sound settings (it's on by default).
      </p>
    </section>
  );
}
