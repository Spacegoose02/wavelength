import { useFeature } from '../lib/features';
import { isTauri } from '../lib/http';
import { AHEAD_ID, SIMILAR_ID } from '../lib/deadZone';
import { useOffline } from '../store/offline';
import { useSettings } from '../store/settings';

const MINUTES = [10, 20, 30, 45, 60];

/** Settings → Downloads → Dead zones (lib/deadZone.ts). */
export function DeadZoneSettings() {
  const on = useFeature('smartOffline');
  const c = useSettings((s) => s.deadZone);
  const set = useSettings((s) => s.setDeadZone);
  const { collections, tracks } = useOffline();
  if (!on || !isTauri) return null;
  const keys = new Set(collections.filter((x) => x.id === AHEAD_ID || x.id === SIMILAR_ID).flatMap((x) => x.keys));
  const used = [...keys].reduce((a, k) => a + (tracks[k]?.size ?? 0), 0);
  return (
    <section id="dead-zones">
      <h2>Dead zones</h2>
      <p className="muted small">
        Keeps the music going when you lose signal. While you listen, Wavelength saves the next few songs in your queue and a
        handful of songs like the one playing. If the signal drops, it plays those, and picks your queue back up once the
        signal is back. Old songs are deleted as new ones come in.
      </p>
      <label className="check">
        <span className="switch"><input type="checkbox" checked={c.enabled} onChange={(e) => set({ enabled: e.target.checked })} /><span /></span>
        <span>Keep music ready for dead zones</span>
      </label>
      {c.enabled && (
        <>
          <label className="check">
            Keep about
            <select value={c.minutes} onChange={(e) => set({ minutes: Number(e.target.value) })}>
              {MINUTES.map((m) => <option key={m} value={m}>{m} minutes</option>)}
            </select>
            <small className="muted">of music ready (now {Math.round(used / 1e6)} MB on this device)</small>
          </label>
          <label className="check"><input type="checkbox" checked={c.similar} onChange={(e) => set({ similar: e.target.checked })} /> Also keep songs like the one playing, for when the queue runs out</label>
          <label className="check"><input type="checkbox" checked={c.wifiOnly} onChange={(e) => set({ wifiOnly: e.target.checked })} /> Only on Wi-Fi</label>
        </>
      )}
    </section>
  );
}
