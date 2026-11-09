import { useEffect, useState, type ReactElement } from 'react';
import { radioBrowser, stationToTrack } from '../sources/radio';
import { sourceFor } from '../sources/registry';
import type { Station } from '../sources/types';
import { useSettings } from '../store/settings';
import { usePlayer } from '../store/player';
import { Cover, Spinner } from '../components/common';
import { IconHeart, IconPlay } from '../components/Icons';
import { AddToPlaylist } from '../components/AddToPlaylist';
import { ShareButton } from '../components/ShareButton';
import { shareOfStation } from '../lib/inbox';
import { stationsForYou } from '../lib/radioPicks';
import { FAMILY_NAMES, groupByFamily, stationLabel } from '../lib/stationLabel';

/** Key for a server station in `hiddenStations` / `stationOrder`. Ids are only unique per server. */
const keyOf = (s: Station) => `${s.sourceId}:${s.id}`;

/** Put `list` in the user's saved order; stations the order doesn't know yet go last, in server order. */
function arrange(list: Station[], order: string[]) {
  const pos = new Map(order.map((k, i) => [k, i]));
  return [...list].sort((a, b) => (pos.get(keyOf(a)) ?? Infinity) - (pos.get(keyOf(b)) ?? Infinity));
}

export function Radio() {
  const { sources, stations: saved, toggleStation, moveStation, hiddenStations, setStationHidden, stationOrder, setStationOrder, stationGroups, setStationGroups } = useSettings();
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
      alert(`Couldn't delete it: ${(e as Error).message ?? e}. Only admins can delete stations; you can still hide it on this device.`);
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

  const row = (s: Station) => (
    <div key={s.id} className={`station-row ${isOn(s) ? 'active' : ''}`} onDoubleClick={() => play(s)}>
      <button className="track-num" onClick={() => play(s)}><Cover src={s.favicon} alt={s.name} className="tiny" /><IconPlay className="hover-play" /></button>
      <div className="track-main">
        <div className="track-title">{s.name}</div>
        <div className="track-sub">{[s.country, s.codec && `${s.codec}${s.bitrate ? ` ${s.bitrate}k` : ''}`, s.tags?.split(',').slice(0, 3).join(', ')].filter(Boolean).join(' · ')}</div>
      </div>
      <div className="track-actions"><AddToPlaylist tracks={() => [stationToTrack(s)]} /><ShareButton what={() => shareOfStation(s)} className="chip" /></div>
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
            {!editing && visible.length > 1 && (
              <span className="chips station-view">
                <button className={`chip ${stationGroups ? 'on' : ''}`} onClick={() => setStationGroups(true)}>By genre</button>
                <button className={`chip ${stationGroups ? '' : 'on'}`} onClick={() => setStationGroups(false)}>My order</button>
              </span>
            )}
          </h2>
          {editing && <p className="muted small">Use the arrows (or drag on desktop) to reorder. <b>Hide</b> only affects this device. <b>Delete</b> removes a Navidrome station from the server for everyone, and needs a Navidrome admin account.</p>}
          {editing ? (
            <div className="station-grid">
              {visible.map((s, i) => {
                const k = keyOf(s);
                return (
                  <div
                    key={k}
                    className={`station-card editing fam-${stationLabel(s).family} ${dragKey === k ? 'dragging' : ''}`}
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
                    <StationFace s={s} />
                    <span className="station-edit">
                      <button className="icon-btn" title="Move left" disabled={i === 0} onClick={() => reorder(k, -1)}>◀</button>
                      <button className="icon-btn" title="Move right" disabled={i === visible.length - 1} onClick={() => reorder(k, 1)}>▶</button>
                      <button className="btn small ghost" onClick={() => setStationHidden(k, true)}>Hide</button>
                      {canDelete(s) && <button className="btn small ghost danger" onClick={() => removeFromServer(s)}>Delete</button>}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            (stationGroups ? groupByFamily(visible) : [{ family: undefined, stations: visible }]).map((g) => (
              <div key={g.family ?? 'all'} className="station-group">
                {g.family && <h3 className="kicker">{FAMILY_NAMES[g.family]} <span>{g.stations.length}</span></h3>}
                <div className="station-grid">
                  {g.stations.map((s) => (
                    <button key={keyOf(s)} className={`station-card fam-${stationLabel(s).family} ${isOn(s) ? 'on' : ''}`} title={s.name} aria-pressed={isOn(s)} onClick={() => play(s)}>
                      <StationFace s={s} on={isOn(s)} />
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
          {!visible.length && <p className="muted">All your stations are hidden. {editing ? 'Show one below.' : 'Tap Edit to show them again.'}</p>}
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
            {row(s)}
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

      {!q.trim() && <StationsForYou row={row} />}

      <section>
        <h2>Directory {busy && <Spinner />}</h2>
        <input className="filter wide" placeholder="Search 50,000+ stations by name…" value={q} onChange={(e) => setQ(e.target.value)} />
        {results.map(row)}
      </section>
    </div>
  );
}

/** A station card's inside: logo (or a generated tile in its genre colour), clean name, genres. */
function StationFace({ s, on }: { s: Station; on?: boolean }) {
  const l = stationLabel(s);
  const [logoFailed, setLogoFailed] = useState(false);
  const sub = [...l.genres.slice(0, 3), l.place].filter(Boolean).join(' · ') || l.network || 'Internet radio';
  return (
    <>
      <span className="station-art" aria-hidden>
        {s.favicon && !logoFailed ? <img src={s.favicon} alt="" loading="lazy" onError={() => setLogoFailed(true)} /> : <span className="station-mark">{l.mark}</span>}
        {on ? <span className="eq-bars"><i /><i /><i /></span> : <IconPlay className="hover-play" />}
      </span>
      <span className="station-text">
        <b>{l.title}</b>
        <small>{on ? <span className="station-live">Playing</span> : null}{sub}</small>
      </span>
    </>
  );
}

/** Stations in the genres you have the most music in (lib/radioPicks.ts). Hidden without a Navidrome server. */
function StationsForYou({ row }: { row: (s: Station) => ReactElement }) {
  const [picks, setPicks] = useState<{ genre: string; stations: Station[] }[]>();
  useEffect(() => {
    let alive = true;
    stationsForYou().then((p) => alive && setPicks(p), () => alive && setPicks([]));
    return () => {
      alive = false;
    };
  }, []);
  if (!picks?.length) return null;
  return (
    <section>
      <h2>Stations for you <small className="muted">in the genres you have the most music in</small></h2>
      {picks.map((g) => (
        <div key={g.genre}>
          <h3 className="dz-section">{g.genre}</h3>
          {g.stations.map(row)}
        </div>
      ))}
    </section>
  );
}
