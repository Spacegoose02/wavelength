import { useEffect, useState } from 'react';
import { radioBrowser, stationToTrack } from '../sources/radio';
import { sourceFor } from '../sources/registry';
import type { Station } from '../sources/types';
import { useSettings } from '../store/settings';
import { usePlayer } from '../store/player';
import { Cover, Spinner } from '../components/common';
import { IconHeart, IconPlay } from '../components/Icons';
import { AddToPlaylist } from '../components/AddToPlaylist';

/** Key for a server station in `hiddenStations` / `stationOrder`. Ids are only unique per server. */
const keyOf = (s: Station) => `${s.sourceId}:${s.id}`;

/** Put `list` in the user's saved order; stations the order doesn't know yet go last, in server order. */
function arrange(list: Station[], order: string[]) {
  const pos = new Map(order.map((k, i) => [k, i]));
  return [...list].sort((a, b) => (pos.get(keyOf(a)) ?? Infinity) - (pos.get(keyOf(b)) ?? Infinity));
}

export function Radio() {
  const { sources, stations: saved, toggleStation, moveStation, hiddenStations, setStationHidden, stationOrder, setStationOrder } = useSettings();
  const [editing, setEditing] = useState(false);
  const [dragKey, setDragKey] = useState<string>();
  const [reload, setReload] = useState(0);
  const playTracks = usePlayer((s) => s.playTracks);
  const current = usePlayer((s) => s.queue[s.index]);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Station[]>([]);
  const [serverStations, setServerStations] = useState<Station[]>([]);
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState({ name: '', url: '' });

  // SubWave + Navidrome internet radio
  useEffect(() => {
    Promise.all(
      sources.filter((s) => s.enabled && (s.kind === 'subwave' || s.kind === 'navidrome')).map((cfg) => sourceFor(cfg).getStations?.().catch(() => []) ?? []),
    ).then((l) => setServerStations(l.flat()));
  }, [sources, reload]);

  const ordered = arrange(serverStations, stationOrder);
  const visible = ordered.filter((s) => !hiddenStations.includes(keyOf(s)));
  const hidden = ordered.filter((s) => hiddenStations.includes(keyOf(s)));

  /** Move station `key` to where `target` is (drag and drop) or one step left/right (buttons). */
  const reorder = (key: string, to: string | -1 | 1) => {
    const keys = ordered.map(keyOf);
    const from = keys.indexOf(key);
    if (from < 0) return;
    let at: number;
    if (typeof to === 'string') at = keys.indexOf(to);
    else {
      // step over hidden stations so one press always moves it one visible place
      const vis = visible.map(keyOf);
      const neighbour = vis[vis.indexOf(key) + to];
      if (!neighbour) return;
      at = keys.indexOf(neighbour);
    }
    if (at < 0 || at === from) return;
    keys.splice(from, 1);
    keys.splice(at, 0, key);
    setStationOrder(keys);
  };

  const removeFromServer = async (s: Station) => {
    const cfg = sources.find((c) => c.id === s.sourceId);
    if (!cfg || !confirm(`Delete "${s.name}" from ${cfg.name} for everyone? This can't be undone.`)) return;
    try {
      await sourceFor(cfg).deleteStation!(s.id);
      setStationHidden(keyOf(s), false);
      setReload((n) => n + 1);
    } catch (e) {
      alert(`Couldn't delete it: ${(e as Error).message ?? e}. Navidrome only lets admin accounts delete stations; you can still hide it on this device.`);
    }
  };
  const canDelete = (s: Station) => {
    const cfg = sources.find((c) => c.id === s.sourceId);
    return !!cfg && !!sourceFor(cfg).deleteStation;
  };

  useEffect(() => {
    let alive = true;
    const h = window.setTimeout(async () => {
      setBusy(true);
      try {
        const r = q.trim() ? await radioBrowser.search(q.trim()) : await radioBrowser.top();
        if (alive) setResults(r);
      } catch {
        if (alive) setResults([]);
      }
      if (alive) setBusy(false);
    }, 350);
    return () => {
      alive = false;
      window.clearTimeout(h);
    };
  }, [q]);

  const play = (s: Station) => playTracks([stationToTrack(s)]);
  const isOn = (s: Station) => current?.id === `radio:${s.id}`;
  const isSaved = (s: Station) => saved.some((x) => x.id === s.id);

  const Row = ({ s }: { s: Station }) => (
    <div className={`station-row ${isOn(s) ? 'active' : ''}`} onDoubleClick={() => play(s)}>
      <button className="track-num" onClick={() => play(s)}><Cover src={s.favicon} alt={s.name} className="tiny" /><IconPlay className="hover-play" /></button>
      <div className="track-main">
        <div className="track-title">{s.name}</div>
        <div className="track-sub">{[s.country, s.codec && `${s.codec}${s.bitrate ? ` ${s.bitrate}k` : ''}`, s.tags?.split(',').slice(0, 3).join(', ')].filter(Boolean).join(' · ')}</div>
      </div>
      <div className="track-actions"><AddToPlaylist tracks={() => [stationToTrack(s)]} /></div>
      {s.sourceId === 'radio' && (
        <button className={`icon-btn ${isSaved(s) ? 'on' : ''}`} title={isSaved(s) ? 'Remove from favorites' : 'Save'} onClick={() => toggleStation(s)}><IconHeart /></button>
      )}
    </div>
  );

  return (
    <div className="page">
      <header className="page-head"><h1>Radio</h1></header>

      {serverStations.length > 0 && (
        <section>
          <h2>
            Your stations
            <button className="link small" onClick={() => setEditing(!editing)}>{editing ? 'Done' : 'Edit'}</button>
          </h2>
          {editing && <p className="muted small">Use the arrows (or drag on desktop) to reorder. <b>Hide</b> only affects this device. <b>Delete</b> removes a Navidrome station from the server for everyone, and needs a Navidrome admin account.</p>}
          <div className="shelf">
            {visible.map((s, i) => {
              const k = keyOf(s);
              return editing ? (
                <div
                  key={k}
                  className={`station-hero editing ${dragKey === k ? 'dragging' : ''}`}
                  draggable
                  onDragStart={() => setDragKey(k)}
                  onDragEnd={() => setDragKey(undefined)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragKey) reorder(dragKey, k);
                    setDragKey(undefined);
                  }}
                >
                  <b>{s.name}</b><small>{s.tags ?? 'Internet radio'}</small>
                  <span className="station-edit">
                    <button className="icon-btn" title="Move left" disabled={i === 0} onClick={() => reorder(k, -1)}>◀</button>
                    <button className="icon-btn" title="Move right" disabled={i === visible.length - 1} onClick={() => reorder(k, 1)}>▶</button>
                    <button className="btn small ghost" onClick={() => setStationHidden(k, true)}>Hide</button>
                    {canDelete(s) && <button className="btn small ghost danger" onClick={() => removeFromServer(s)}>Delete</button>}
                  </span>
                </div>
              ) : (
                <button key={k} className={`station-hero ${isOn(s) ? 'on' : ''}`} onClick={() => play(s)}>
                  <span className="live-dot" /> <b>{s.name}</b><small>{s.tags ?? 'Internet radio'}</small>
                </button>
              );
            })}
            {!visible.length && <p className="muted">All your stations are hidden. {editing ? 'Show one below.' : 'Tap Edit to show them again.'}</p>}
          </div>
          {editing && hidden.length > 0 && (
            <div className="hidden-stations">
              <div className="kicker">Hidden on this device</div>
              {hidden.map((s) => (
                <div key={keyOf(s)} className="row gap">
                  <span>{s.name}</span>
                  <button className="btn small" onClick={() => setStationHidden(keyOf(s), false)}>Show</button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <section>
        <h2>Favorites</h2>
        {saved.length ? saved.map((s, i) => (
          <div key={s.id} className="station-fav">
            <Row s={s} />
            {saved.length > 1 && (
              <span className="station-move">
                <button className="icon-btn" title="Move up" disabled={i === 0} onClick={() => moveStation(s.id, -1)}>▲</button>
                <button className="icon-btn" title="Move down" disabled={i === saved.length - 1} onClick={() => moveStation(s.id, 1)}>▼</button>
              </span>
            )}
          </div>
        )) : <p className="muted">Heart a station below to keep it here.</p>}
        <form className="inline-form" onSubmit={(e) => {
          e.preventDefault();
          if (!custom.url) return;
          toggleStation({ id: `custom-${Date.now()}`, sourceId: 'radio', name: custom.name || custom.url, streamUrl: custom.url });
          setCustom({ name: '', url: '' });
        }}>
          <input placeholder="Station name" value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} />
          <input placeholder="Stream URL (http://…)" value={custom.url} onChange={(e) => setCustom({ ...custom, url: e.target.value })} />
          <button className="btn">Add stream</button>
        </form>
      </section>

      <section>
        <h2>Directory {busy && <Spinner />}</h2>
        <input className="filter wide" placeholder="Search 50,000+ stations by name…" value={q} onChange={(e) => setQ(e.target.value)} />
        {results.map((s) => <Row key={s.id} s={s} />)}
      </section>
    </div>
  );
}
