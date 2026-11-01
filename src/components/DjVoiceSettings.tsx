import { useEffect, useState } from 'react';
import { canSpeak, djVoiceProblem, say, voices } from '../lib/djVoice';
import { useFeature } from '../lib/features';
import { useSettings } from '../store/settings';

/** Settings → Playback: the talking DJ (lib/djVoice.ts). Shown when an admin turned the feature on. */
export function DjVoiceSettings() {
  const on = useFeature('djVoice');
  const v = useSettings((s) => s.djVoice);
  const set = useSettings((s) => s.setDjVoice);
  const [list, setList] = useState<SpeechSynthesisVoice[]>(voices);
  useEffect(() => {
    if (!canSpeak) return;
    const load = () => setList(voices());
    speechSynthesis.addEventListener('voiceschanged', load);
    return () => speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);
  if (!on) return null;
  return (
    <section id="dj-voice">
      <h2>Talking DJ</h2>
      <p className="muted small">
        Every few songs the AI DJ says a line about what you just heard and what's next, over the start of the song with the music
        turned down. It uses the Hub's AI DJ (and a little of your monthly allowance) and this device's own voice.
      </p>
      {!canSpeak ? <p className="muted small">This device has no text-to-speech voice, so the DJ can't talk here.</p> : <>
        <label className="check">
          <span className="switch"><input type="checkbox" checked={v.on} onChange={(e) => set({ on: e.target.checked })} /><span /></span>
          <span><b>Talk between songs</b></span>
        </label>
        {v.on && <>
          <label className="range-field">
            <span>{v.every === 1 ? 'Before every song' : `Before every ${v.every} songs`}</span>
            <input type="range" min={1} max={10} step={1} value={v.every} onChange={(e) => set({ every: Number(e.target.value) })} style={{ ['--pct' as string]: `${((v.every - 1) / 9) * 100}%` }} />
          </label>
          <div className="chips">
            {([['chill', 'Laid back'], ['hype', 'Hype'], ['trivia', 'Trivia']] as const).map(([k, label]) => (
              <button key={k} className={`chip ${v.style === k ? 'on' : ''}`} onClick={() => set({ style: k })}>{label}</button>
            ))}
          </div>
          <div className="editor-grid">
          <label>What the DJ calls you
            <input value={v.name} maxLength={40} placeholder="(no name)" onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label>Voice on this device
            <select value={v.voice} onChange={(e) => set({ voice: e.target.value })}>
              <option value="">System default</option>
              {list.map((x) => <option key={x.name} value={x.name}>{x.name} ({x.lang})</option>)}
            </select>
          </label>
          </div>
          <label className="range-field">
            <span>Speed {v.rate.toFixed(1)}×</span>
            <input type="range" min={0.7} max={1.4} step={0.1} value={v.rate} onChange={(e) => set({ rate: Number(e.target.value) })} style={{ ['--pct' as string]: `${((v.rate - 0.7) / 0.7) * 100}%` }} />
          </label>
          <button className="btn small" onClick={() => void say(`Hi${v.name ? ` ${v.name}` : ''}, this is your DJ. Here's how I sound.`)}>Hear the voice</button>
          {djVoiceProblem && <p className="errors">{djVoiceProblem}</p>}
        </>}
      </>}
    </section>
  );
}
