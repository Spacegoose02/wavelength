import { useEffect, useState } from 'react';
import { DEFAULT_PLAY, alarmAt, keepPlaying, snooze, stopAlarm, useAlarm, type AlarmPlay } from '../lib/alarm';
import { daysText, whenText } from '../lib/alarmTime';
import { useFeature } from '../lib/features';
import { isAndroid } from '../lib/platform';
import { useMixes } from '../lib/mixes';

const DAY_NAMES = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** What the alarm can play, grouped for the dropdown. */
function useChoices(): { group: string; items: AlarmPlay[] }[] {
  const djMode = useFeature('djMode');
  const mixes = useMixes((s) => s.mixes);
  const [lists, setLists] = useState<{ playlists: AlarmPlay[]; radio: AlarmPlay[] }>({ playlists: [], radio: [] });
  useEffect(() => {
    let alive = true;
    void import('../lib/carBrowse').then(async (m) => {
      const [pl, st] = await Promise.all([m.carChildren('playlists').catch(() => []), m.carChildren('radio').catch(() => [])]);
      if (alive) setLists({ playlists: pl.map((x) => ({ id: x.id, name: x.title })), radio: st.map((x) => ({ id: x.id, name: x.title })) });
    });
    return () => {
      alive = false;
    };
  }, []);
  const seen = new Set<string>();
  const mixItems: AlarmPlay[] = [];
  for (const m of mixes) {
    // the daylist and the Daily Mixes change: pick them by kind, so it's always today's
    const id = m.kind === 'daylist' ? 'mix:daylist' : m.kind === 'daily' || m.kind === 'blend' ? `mix:${m.id}` : `mix:${m.kind}`;
    if (seen.has(id)) continue;
    seen.add(id);
    mixItems.push({ id, name: m.kind === 'daylist' ? 'daylist (for the time of day)' : m.name });
  }
  return [
    { group: 'Quick picks', items: [DEFAULT_PLAY, { id: 'resume', name: 'Where I left off' }, ...(djMode ? [{ id: 'dj', name: 'DJ mode' }] : [])] },
    ...(mixItems.length ? [{ group: 'Made for you', items: mixItems }] : []),
    ...(lists.playlists.length ? [{ group: 'Playlists', items: lists.playlists }] : []),
    ...(lists.radio.length ? [{ group: 'Radio', items: lists.radio }] : []),
  ];
}

/** Settings → Playback → Wake-up alarm (lib/alarm.ts). */
export function AlarmSettings() {
  const a = useAlarm();
  const choices = useChoices();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const at = alarmAt();
  const all = choices.flatMap((c) => c.items);
  const toggleDay = (d: number) => a.set({ days: a.days.includes(d) ? a.days.filter((x) => x !== d) : [...a.days, d].sort() });
  return (
    <section id="alarm">
      <h2>Wake-up alarm</h2>
      <label className="check">
        <span className="switch"><input type="checkbox" checked={a.on} onChange={(e) => a.set({ on: e.target.checked })} /><span /></span>
        <span>Wake me up with music{a.on && at ? ` · ${whenText(at, Date.now())}` : ''}</span>
      </label>
      <div className="alarm-row">
        <input type="time" value={a.time} onChange={(e) => e.target.value && a.set({ time: e.target.value })} aria-label="Alarm time" />
        <div className="chips" role="group" aria-label="Days">
          {DAY_NAMES.map((n, d) => (
            <button key={DAY_LABELS[d]} className={`chip day-chip ${a.days.includes(d) ? 'on' : ''}`} onClick={() => toggleDay(d)} aria-pressed={a.days.includes(d)} title={DAY_LABELS[d]}>{n}</button>
          ))}
        </div>
        <small className="muted">{daysText(a.days)}</small>
      </div>
      <div className="alarm-row">
        <label className="sort-select">
          <span className="muted small">Play</span>
          <select value={a.play.id} onChange={(e) => a.set({ play: all.find((x) => x.id === e.target.value) ?? DEFAULT_PLAY })} aria-label="What the alarm plays">
            {!all.some((x) => x.id === a.play.id) && <option value={a.play.id}>{a.play.name}</option>}
            {choices.map((c) => (
              <optgroup key={c.group} label={c.group}>
                {c.items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="sort-select">
          <span className="muted small">Fade in</span>
          <select value={a.fadeIn} onChange={(e) => a.set({ fadeIn: Number(e.target.value) })} aria-label="Fade in">
            {[0, 30, 60, 120, 300].map((s) => <option key={s} value={s}>{s ? (s < 60 ? `${s} s` : `${s / 60} min`) : 'Off'}</option>)}
          </select>
        </label>
      </div>
      {a.error && <p className="errors">{a.error}</p>}
      <p className="muted small">
        {isAndroid
          ? 'Android wakes Wavelength for it, even when it’s closed and the phone is locked. An alarm icon shows in the status bar.'
          : 'Wavelength has to be running at that time (it can wait in the tray). Leave the computer awake.'}{' '}
        It starts quiet and comes up to your volume. Snooze waits {a.snoozeMinutes} minutes.
      </p>
    </section>
  );
}

/** The banner while the alarm is going off: Snooze, I'm up (keep the music), Stop. */
export function AlarmBanner() {
  const { ringing, error, snoozeMinutes } = useAlarm();
  if (!ringing) return null;
  return (
    <div className="alarm-banner" role="alertdialog" aria-label="Wake-up alarm">
      <span>⏰ {error ?? 'Good morning!'}</span>
      <button className="btn primary" onClick={snooze}>Snooze {snoozeMinutes} min</button>
      <button className="btn" onClick={keepPlaying}>I’m up</button>
      <button className="btn" onClick={stopAlarm}>Stop</button>
    </div>
  );
}
