import { useEffect, useState } from 'react';
import { canDiscord, discordProblem, onDiscordProblem } from '../lib/discord';
import { useFeature } from '../lib/features';
import { useSettings } from '../store/settings';

/** Settings → Playback: Discord status (lib/discord.ts). Desktop app only. */
export function DiscordSettings() {
  const on = useFeature('discordStatus');
  const d = useSettings((s) => s.discord);
  const set = useSettings((s) => s.setDiscord);
  const [, bump] = useState(0);
  useEffect(() => onDiscordProblem(() => bump((n) => n + 1)), []);
  if (!on || !canDiscord) return null;
  return (
    <section id="discord">
      <h2>Discord status</h2>
      <p className="muted small">
        Shows <b>Listening to</b> the song and artist on your Discord profile while music plays (not podcasts' or books' names,
        and nothing while paused). Discord needs to be open on this computer.
      </p>
      <label className="check">
        <span className="switch"><input type="checkbox" checked={d.on} onChange={(e) => set({ on: e.target.checked })} /><span /></span>
        <span><b>Show what I'm listening to</b></span>
      </label>
      {d.on && <>
        <div className="editor-grid">
          <label>Discord Application ID
            <input value={d.appId} inputMode="numeric" placeholder="e.g. 1234567890123456789" onChange={(e) => set({ appId: e.target.value.replace(/\D/g, '') })} />
          </label>
        </div>
        <p className="muted small">
          Make one once at <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer">discord.com/developers/applications</a>:
          <b> New Application</b>, name it <i>Wavelength</i> (that's the name your friends see), and copy its <b>Application ID</b> here.
        </p>
        {discordProblem && <p className="errors">{discordProblem}</p>}
      </>}
    </section>
  );
}
