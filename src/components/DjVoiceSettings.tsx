import { useEffect, useState } from 'react';
import { canSpeak, djVoiceProblem, hubVoiceInfo, say, voices } from '../lib/djVoice';
import { voiceLabel } from '../lib/djVoiceNames';
import type { HubDjVoiceInfo } from '../sources/hub';
import { useFeature } from '../lib/features';
import { useSettings } from '../store/settings';

/** Settings → Playback: the talking DJ (lib/djVoice.ts). Shown when an admin turned the feature on. */
export function DjVoiceSettings() {
  const on = useFeature('djVoice');
  const v = useSettings((s) => s.djVoice);
  const set = useSettings((s) => s.setDjVoice);
  const [list, setList] = useState<SpeechSynthesisVoice[]>(voices);
  const [hub, setHub] = useState<HubDjVoiceInfo | null>(null);
  const [, redraw] = useState(0);
  useEffect(() => {
    if (on) void hubVoiceInfo(true).then(setHub);
  }, [on]);
  useEffect(() => {
    if (!canSpeak) return;
    const load = () => setList(voices());
    speechSynthesis.addEventListener('voiceschanged', load);
    return () => speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);
  if (!on) return null;
  const hubHas = !!hub && hub.engine !== 'device' && !hub.error;
  const useHub = hubHas && !v.useDevice;
  return (
    <section id="dj-voice">
      <h2>Talking DJ</h2>
      <p className="muted small">
        Every few songs the AI DJ says a line about what you just heard and what's next, over the start of the song with the music
        turned down. It uses the Hub's AI DJ (and a little of your monthly allowance){hubHas ? `, read by ${engineName(hub!.engine)} on your Hub` : ' and this device\'s own voice'}.
      </p>
      {!canSpeak && !hubHas ? <p className="muted small">This device has no text-to-speech voice, so the DJ can't talk here.</p> : <>
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
          <label>Voice
            <select value={useHub ? `hub:${v.hubVoice}` : `device:${v.voice}`} onChange={(e) => {
              const [kind, ...rest] = e.target.value.split(':');
              const name = rest.join(':');
              set(kind === 'hub' ? { useDevice: false, hubVoice: name } : { useDevice: true, voice: name });
            }}>
              {hubHas && (
                <optgroup label={`DJ voices (${engineName(hub!.engine)})`}>
                  <option value="hub:">{hub!.default ? `${voiceLabel(hub!.default, hub!.engine)} (the Hub’s pick)` : 'The Hub’s pick'}</option>
                  {hub!.voices.filter((x) => x !== hub!.default).map((x) => <option key={x} value={`hub:${x}`}>{voiceLabel(x, hub!.engine)}</option>)}
                  {v.hubVoice && !hub!.voices.includes(v.hubVoice) && <option value={`hub:${v.hubVoice}`}>{voiceLabel(v.hubVoice, hub!.engine)}</option>}
                </optgroup>
              )}
              {canSpeak && (
                <optgroup label="This device’s voices">
                  <option value="device:">System default</option>
                  {list.map((x) => <option key={x.name} value={`device:${x.name}`}>{x.name} ({x.lang})</option>)}
                </optgroup>
              )}
            </select>
          </label>
          </div>
          <label className="range-field">
            <span>DJ loudness {Math.round((v.loudness ?? 1.6) * 100)}% <small className="muted">(next to the music)</small></span>
            <input type="range" min={0.5} max={2.5} step={0.1} value={v.loudness ?? 1.6} onChange={(e) => set({ loudness: Number(e.target.value) })} style={{ ['--pct' as string]: `${(((v.loudness ?? 1.6) - 0.5) / 2) * 100}%` }} />
          </label>
          <label className="range-field">
            <span>Speed {v.rate.toFixed(1)}×</span>
            <input type="range" min={0.7} max={1.4} step={0.1} value={v.rate} onChange={(e) => set({ rate: Number(e.target.value) })} style={{ ['--pct' as string]: `${((v.rate - 0.7) / 0.7) * 100}%` }} />
          </label>
          <button className="btn small" onClick={() => void say(`Hi${v.name ? ` ${v.name}` : ''}, this is DJ Trash Panda. Here's how I sound.`).then(() => redraw((n) => n + 1))}>Hear the voice</button>
          {hub?.error && <p className="muted small">The Hub’s voice isn’t available right now ({hub.error}), so this device’s voice reads it.</p>}
          {djVoiceProblem && <p className="errors">{djVoiceProblem}</p>}
        </>}
      </>}
    </section>
  );
}

const engineName = (e: HubDjVoiceInfo['engine']) => (e === 'kokoro' ? 'Kokoro' : e === 'openai' ? 'OpenAI' : 'this device');
