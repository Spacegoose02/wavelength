import { useSettings } from '../store/settings';
import { QUALITIES, onMobileData, type StreamQuality } from '../lib/streamQuality';
import { LibraryServer } from '../lib/serverName';

/** Settings → Playback: streaming quality on Wi-Fi and mobile data (lib/streamQuality.ts), and resuming (lib/resume.ts). */
export function StreamingSettings() {
  const q = useSettings((s) => s.streamQuality);
  const set = useSettings((s) => s.setStreamQuality);
  const resume = useSettings((s) => s.resume);
  const setResume = useSettings((s) => s.setResume);
  const row = (which: 'wifi' | 'mobile', label: string) => (
    <div className="quality-row">
      <span>{label}</span>
      <div className="chips" role="group" aria-label={label}>
        {QUALITIES.map((x) => (
          <button key={x.value} className={`chip ${(q?.[which] ?? 'original') === x.value ? 'on' : ''}`} title={x.note} onClick={() => set({ [which]: x.value as StreamQuality })}>{x.label}</button>
        ))}
      </div>
    </div>
  );
  const mobileNote = QUALITIES.find((x) => x.value === (q?.mobile ?? 'original'))?.note;
  return (
    <>
      <section id="streaming-quality">
        <h2>Streaming quality</h2>
        <p className="muted small">
          Music from {LibraryServer()} can stream smaller on mobile data, so a FLAC library doesn't eat your plan. The server converts each song
          as it plays. Downloads, bit-perfect output and speakers always get the original.
        </p>
        {row('wifi', 'On Wi-Fi')}
        {row('mobile', 'On mobile data')}
        <p className="muted small">On mobile data: {mobileNote}.{onMobileData() ? ' This device is on mobile data now.' : ''}</p>
      </section>
      <section id="resume">
        <h2>Pick up where you left off</h2>
        <label className="check">
          <span className="switch"><input type="checkbox" checked={resume !== false} onChange={(e) => setResume(e.target.checked)} /><span /></span>
          <span>Bring back the queue and the spot in the song when Wavelength opens</span>
        </label>
        <p className="muted small">
          It comes back paused; press play to carry on. Audiobooks carry on from where Audiobookshelf says you are. Kept on this device
          for whoever is signed in.
        </p>
      </section>
    </>
  );
}
