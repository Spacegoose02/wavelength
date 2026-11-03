import { useEffect, useState } from 'react';
import { pickStation, SEGMENT_LABELS, startStation, stopStation, useStation } from '../lib/djStation';
import { useSettings } from '../store/settings';
import { useDjAvailable } from '../lib/djStatus';
import { useFeature } from '../lib/features';
import { getSong, NotOnDeezer } from '../lib/getSong';
import { useMustRequest } from '../lib/inbox';
import { myPlaylists, type MyPlaylist } from '../lib/myPlaylists';
import type { HubMixSong, HubStationKind } from '../sources/hub';
import { IconDownload, IconX } from './Icons';
import { DJ_NAME, TrashPanda } from './TrashPanda';

/** Whether this person can use DJ mode (the feature is on and the AI DJ is on for them). */
export function useDjMode(): boolean {
  const feature = useFeature('djMode');
  const dj = useDjAvailable();
  return feature && dj;
}

/** On a phone with nothing playing (no mini player, so no DJ button): a slim bar to start DJ mode. */
export function DjModeBar() {
  const can = useDjMode();
  const on = useStation((s) => s.on || s.picking);
  if (!can || on) return null;
  return (
    <button className="dj-mode-bar" onClick={pickStation}>
      <TrashPanda /> <span>DJ mode: let {DJ_NAME} run a station for you</span>
    </button>
  );
}

/** The DJ button in the player: starts DJ mode, or opens its panel when it's running. */
export function DjModeButton({ className = 'tbtn small' }: { className?: string }) {
  const can = useDjMode();
  const on = useStation((s) => s.on);
  const busy = useStation((s) => s.busy);
  if (!can) return null;
  return (
    <button
      className={`${className} dj-mode-btn ${on ? 'on' : ''}`}
      title={on ? `${DJ_NAME} is on air` : `DJ mode: let ${DJ_NAME} run a station for you`}
      onClick={(e) => {
        e.stopPropagation();
        if (on) useStation.setState({ open: true });
        else pickStation();
      }}
    >
      <TrashPanda busy={busy} />
    </button>
  );
}

/**
 * What's on air, the segments to jump to, and a box to tell the DJ what you want. On a desktop it floats above
 * the player bar; on a phone (`sheet`) it's a sheet over the bottom of the screen, above the full-screen player
 * too, and folds into a pill in the mini player's dock.
 */
export function DjStationPanel({ sheet = false }: { sheet?: boolean }) {
  const s = useStation();
  const [ask, setAsk] = useState('');
  const loud = useSettings((x) => x.djVoice.loudness ?? 1.6);
  const callMe = useSettings((x) => x.djVoice.name);
  const setVoice = useSettings((x) => x.setDjVoice);
  const [lists, setLists] = useState<MyPlaylist[]>([]);
  const shown = s.open && (s.on || s.picking);
  useEffect(() => {
    if (shown) void myPlaylists().then(setLists).catch(() => undefined);
  }, [shown]);
  if (!s.on && !s.picking && !s.error && !s.busy) return null;
  if (!s.open) {
    return (
      <button className={`dj-station-pill ${sheet ? 'inline' : ''}`} onClick={() => useStation.setState({ open: true })}>
        <TrashPanda busy={s.busy} /> <span>{s.title || 'DJ mode'}</span>
      </button>
    );
  }
  const send = () => {
    const t = ask.trim();
    if (!t) return;
    setAsk('');
    void startStation({ ask: t });
  };
  return (
    <div className={`dj-station ${sheet ? 'sheet' : 'floating'}`} role="region" aria-label="DJ mode">
      <div className="dj-station-head">
        <TrashPanda busy={s.busy} />
        <div className="dj-station-now">
          <small>{s.on ? `${DJ_NAME} · on air` : DJ_NAME}</small>
          <b>{s.busy && !s.title ? 'Picking songs…' : s.on ? s.title || 'DJ mode' : 'What should I play?'}</b>
        </div>
        <button className="tbtn small" title="Fold away" onClick={() => useStation.setState({ open: false })}>–</button>
        <button className="tbtn small" title={s.on ? 'Stop DJ mode' : 'Close'} onClick={stopStation}><IconX /></button>
      </div>
      {s.on && s.intro && <p className="dj-station-intro">“{s.intro}”</p>}
      {!s.on && <p className="muted small">Pick a segment or one of your playlists, tell me what you’re in the mood for, or let me mix it up. I’ll keep it going from there.</p>}
      {s.error && <p className="errors small">{s.error}</p>}
      {s.busy && !s.on && <p className="dj-station-busy small"><span className="spinner" /> Picking songs and writing the intro. This can take a little while…</p>}
      <div className="chips">
        {!s.on && <button className="chip dj-mix" disabled={s.busy} onClick={() => void startStation({ mix: true })}>🎲 Mix it up</button>}
        {(Object.keys(SEGMENT_LABELS) as Exclude<HubStationKind, 'ask' | 'playlist'>[]).map((k) => (
          <button key={k} className={`chip ${s.kind === k ? 'on' : ''}`} disabled={s.busy} onClick={() => void startStation({ kind: k })}>{SEGMENT_LABELS[k]}</button>
        ))}
      </div>
      {lists.length > 0 && (
        <select
          className="dj-station-playlist"
          value=""
          disabled={s.busy}
          aria-label="Build on one of your playlists"
          onChange={(e) => {
            const p = lists.find((x) => x.key === e.target.value);
            if (p) void startStation({ playlist: { key: p.key, name: p.name } });
          }}
        >
          <option value="">{s.kind === 'playlist' ? `🎵 ${s.title}` : 'Build on one of your playlists…'}</option>
          {lists.map((p) => (
            <option key={p.key} value={p.key}>{p.name}{p.songs !== undefined ? ` (${p.songs})` : ''}{p.where !== 'Wavelength' ? ` · ${p.where}` : ''}</option>
          ))}
        </select>
      )}
      {s.on && s.missing.length > 0 && <MissingSongs songs={s.missing} title={s.title} />}
      <form className="dj-station-ask" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input value={ask} maxLength={300} placeholder="Tell the DJ what you want: “90s house”, “chill for cooking”…" onChange={(e) => setAsk(e.target.value)} disabled={s.busy} />
        <button className="btn small" disabled={s.busy || !ask.trim()}>Go</button>
      </form>
      <label className="check small">
        <span className="switch"><input type="checkbox" checked={s.talk} onChange={(e) => useStation.setState({ talk: e.target.checked })} /><span /></span>
        <span>The DJ talks between songs</span>
      </label>
      {s.talk && (
        <label className="dj-station-name small">
          <span>The DJ calls you</span>
          <input value={callMe} maxLength={40} placeholder="(no name)" onChange={(e) => setVoice({ name: e.target.value })} />
        </label>
      )}
      {s.talk && (
        <label className="range-field small">
          <span>DJ loudness {Math.round(loud * 100)}%</span>
          <input type="range" min={0.5} max={2.5} step={0.1} value={loud} onChange={(e) => setVoice({ loudness: Number(e.target.value) })} style={{ ['--pct' as string]: `${((loud - 0.5) / 2) * 100}%` }} />
        </label>
      )}
    </div>
  );
}

const songKey = (x: HubMixSong) => `${x.artist}\u0000${x.title}`.toLowerCase();

/** The songs this segment's list has that your library doesn't: Get (or Request) them one by one or all at once. */
function MissingSongs({ songs, title }: { songs: HubMixSong[]; title: string }) {
  const ask = useMustRequest();
  const [state, setState] = useState<Record<string, string>>({});
  const [all, setAll] = useState(false);
  const get = async (x: HubMixSong) => {
    const k = songKey(x);
    setState((m) => ({ ...m, [k]: '…' }));
    try {
      const via = await getSong({ title: x.title, artist: x.artist, cover: x.coverUrl });
      setState((m) => ({ ...m, [k]: via === 'request' ? 'Requested' : 'Downloading' }));
    } catch (e) {
      setState((m) => ({ ...m, [k]: e instanceof NotOnDeezer ? 'Not on Deezer' : String((e as Error)?.message ?? e).slice(0, 60) }));
    }
  };
  const getAll = async () => {
    setAll(true);
    for (const x of songs) if (!state[songKey(x)]) await get(x);
  };
  const left = songs.filter((x) => !state[songKey(x)]).length;
  return (
    <details className="dj-station-missing">
      <summary>{songs.length} {songs.length === 1 ? 'song' : 'songs'} on {title || 'this list'} you don’t have</summary>
      <ul>
        {songs.map((x) => {
          const st = state[songKey(x)];
          return (
            <li key={songKey(x)}>
              <span><b>{x.title}</b> <small className="muted">{x.artist}</small></span>
              <button className="chip" disabled={!!st} title={st ?? `${ask ? 'Request' : 'Get'} ${x.title} by ${x.artist}`} onClick={() => void get(x)}>
                {st ?? <><IconDownload /> {ask ? 'Request' : 'Get'}</>}
              </button>
            </li>
          );
        })}
      </ul>
      {left > 1 && <button className="btn small" disabled={all} onClick={() => void getAll()}>{ask ? 'Request' : 'Get'} all {left}</button>}
    </details>
  );
}
