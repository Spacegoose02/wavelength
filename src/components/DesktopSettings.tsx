import { useState } from 'react';
import { canDesktop, hotkeyProblem, toggleMiniPlayer } from '../lib/desktop';
import { isMac } from '../lib/platform';
import { useSettings } from '../store/settings';

/** Settings → Playback: the mini player, the tray and the hotkeys (desktop app only, lib/desktop.ts). */
export function DesktopSettings() {
  const d = useSettings((s) => s.desktop);
  const set = useSettings((s) => s.setDesktop);
  const [, redraw] = useState(0);
  if (!canDesktop) return null;
  const mod = isMac ? '⌃⌥' : 'Ctrl+Alt+';
  return (
    <section>
      <h2>Mini player, tray and hotkeys</h2>
      <p className="muted">
        Wavelength has an icon in the {isMac ? 'menu bar' : 'tray'} with play/pause, next, previous and the mini player: a small window that stays on top of
        your other apps.
      </p>
      <button type="button" onClick={() => void toggleMiniPlayer()}>Open the mini player</button>
      <label className="check">
        <input type="checkbox" checked={d.hotkeys} onChange={(e) => { set({ hotkeys: e.target.checked }); setTimeout(() => redraw((n) => n + 1), 300); }} />
        Hotkeys that work in any app: {mod}Space play/pause, {mod}→ next, {mod}← previous
      </label>
      {d.hotkeys && hotkeyProblem && <p className="errors">{hotkeyProblem}</p>}
      <label className="check">
        <input type="checkbox" checked={d.closeToTray} onChange={(e) => set({ closeToTray: e.target.checked })} />
        Keep playing in the {isMac ? 'menu bar' : 'tray'} when I close the window (Quit from the {isMac ? 'menu bar' : 'tray'} icon)
      </label>
    </section>
  );
}
