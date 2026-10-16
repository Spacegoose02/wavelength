import { useEffect, useState } from 'react';
import { radioBrowser, stationToTrack } from '../sources/radio';
import { sourceFor } from '../sources/registry';
import type { Station } from '../sources/types';
import { useSettings } from '../store/settings';
import { usePlayer } from '../store/player';
import { Cover, Spinner } from '../components/common';
import { IconHeart, IconPlay } from '../components/Icons';
import { AddToPlaylist } from '../components/AddToPlaylist';

export function Radio() {
  const { sources, stations: saved, toggleStation } = useSettings();
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
  }, [sources]);

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
          <h2>Your stations</h2>
          <div className="shelf">
            {serverStations.map((s) => (
              <button key={`${s.sourceId}:${s.id}`} className={`station-hero ${isOn(s) ? 'on' : ''}`} onClick={() => play(s)}>
                <span className="live-dot" /> <b>{s.name}</b><small>{s.tags ?? 'Internet radio'}</small>
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2>Favorites</h2>
        {saved.length ? saved.map((s) => <Row key={s.id} s={s} />) : <p className="muted">Heart a station below to keep it here.</p>}
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
