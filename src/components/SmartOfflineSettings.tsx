import { useState } from 'react';
import { useFeature } from '../lib/features';
import { isTauri } from '../lib/http';
import { runSmartOffline } from '../lib/smartOffline';
import { useOffline } from '../store/offline';
import { useSettings } from '../store/settings';

const mb = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`);
const CAPS = [1000, 2000, 4000, 8000, 16000, 32000];

/** Settings → Downloads → Smart offline (lib/smartOffline.ts). */
export function SmartOfflineSettings() {
  const on = useFeature('smartOffline');
  const c = useSettings((s) => s.smartOffline);
  const set = useSettings((s) => s.setSmartOffline);
  const { collections, tracks } = useOffline();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  if (!on || !isTauri) return null;
  const autoKeys = new Set(collections.filter((x) => x.kind === 'auto').flatMap((x) => x.keys));
  const used = [...autoKeys].reduce((a, k) => a + (tracks[k]?.size ?? 0), 0);
  const run = async () => {
    setBusy(true);
    setNote('Updating…');
    setNote(await runSmartOffline(true).catch((e) => String(e?.message ?? e)));
    setBusy(false);
  };
  return (
    <section id="smart-offline">
      <h2>Smart offline</h2>
      <p className="muted small">
        Keeps music on this device by itself, so it plays with no signal: your ♥ songs, what you've played lately and your Made for
        you mixes. It checks every few hours while Wavelength is open, and deletes songs that drop off (unless an album or playlist
        you downloaded has them). They show in <b>Downloaded</b>.
      </p>
      <label className="check">
        <span className="switch"><input type="checkbox" checked={c.enabled} onChange={(e) => set({ enabled: e.target.checked })} /><span /></span>
        <span>Keep music offline automatically on this device</span>
      </label>
      {c.enabled && (
        <>
          <label className="check"><input type="checkbox" checked={c.favorites} onChange={(e) => set({ favorites: e.target.checked })} /> ♥ Favourites</label>
          <label className="check"><input type="checkbox" checked={c.mixes} onChange={(e) => set({ mixes: e.target.checked })} /> Made for you mixes</label>
          <label className="check">
            <input type="checkbox" checked={c.recentDays > 0} onChange={(e) => set({ recentDays: e.target.checked ? 30 : 0 })} /> Songs played in the last
            <select value={c.recentDays || 30} disabled={!c.recentDays} onChange={(e) => set({ recentDays: Number(e.target.value) })}>
              {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} days</option>)}
            </select>
          </label>
          <label className="check"><input type="checkbox" checked={c.wifiOnly} onChange={(e) => set({ wifiOnly: e.target.checked })} /> Only on Wi-Fi</label>
          <label className="check">
            Use at most
            <select value={c.capMb} onChange={(e) => set({ capMb: Number(e.target.value) })}>
              {CAPS.map((v) => <option key={v} value={v}>{v >= 1000 ? `${v / 1000} GB` : `${v} MB`}</option>)}
            </select>
            <small className="muted">(now {mb(used)}; favourites fill first, then mixes, then recent plays)</small>
          </label>
          <div className="chips">
            <button className="chip" disabled={busy} onClick={run}>Update now</button>
            {c.lastRun && <small className="muted">Last updated {new Date(c.lastRun).toLocaleString()}</small>}
          </div>
          {note && <p className="small muted">{note}</p>}
        </>
      )}
    </section>
  );
}
