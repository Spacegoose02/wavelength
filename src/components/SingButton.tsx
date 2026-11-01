import { engine } from '../player/engine';
import { useFeature } from '../lib/features';
import { useSing } from '../lib/singMode';

/** Now Playing: sing mode on/off (lib/singMode.ts). Turning it on opens the lyrics too. */
export function SingButton({ onOn }: { onOn(): void }) {
  const allowed = useFeature('singMode');
  const { on, set } = useSing();
  if (!allowed) return null;
  return (
    <button className={`chip ${on ? 'on' : ''}`} title="Turn the singer down and sing along with the lyrics"
      onClick={() => { set({ on: !on }); if (!on) onOn(); }}>Sing</button>
  );
}

/** Above the lyrics while sing mode is on: how far down the vocal goes. */
export function SingControls() {
  const allowed = useFeature('singMode');
  const { on, amount, set } = useSing();
  if (!allowed || !on) return null;
  return (
    <div className="sing-controls small">
      <label className="range-field">
        <span>Singer turned down {Math.round(amount * 100)}%</span>
        <input type="range" min={0.3} max={1} step={0.05} value={amount} onChange={(e) => set({ amount: Number(e.target.value) })} style={{ ['--pct' as string]: `${((amount - 0.3) / 0.7) * 100}%` }} />
      </label>
      {!engine.vocalCutAvailable() ? (
        <span className="muted">This song is playing in a way sing mode can't reach (a speaker, or a server that blocks it).</span>
      ) : (
        <span className="muted">Works best on studio songs with the singer in the middle. Songs in mono lose their middle too.</span>
      )}
    </div>
  );
}
