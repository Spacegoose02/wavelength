import { useEffect, useState } from 'react';
import { sourceFor } from '../sources/registry';
import type { Album, HistoryEntry } from '../sources/types';
import { useLibrary } from '../store/library';
import { useSettings } from '../store/settings';
import { useHub } from '../store/hub';
import { useUi } from '../store/ui';
import { AlbumCard, Empty, Spinner, TrackList, timeAgo } from '../components/common';
import { IconRefresh } from '../components/Icons';

export function History() {
  const sources = useSettings((s) => s.sources);
  const navidromes = sources.filter((s) => s.enabled && s.kind === 'navidrome');
  const local = useLibrary((s) => s.history);
  const [tab, setTab] = useState<string>(navidromes[0]?.id ?? 'local');
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [error, setError] = useState<string>();
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const cfg = navidromes.find((s) => s.id === tab);
    if (!cfg) return;
    let alive = true;
    setEntries(null);
    setError(undefined);
    const src = sourceFor(cfg);
    src.getRecentlyPlayedAlbums?.().then((a) => alive && setAlbums(a)).catch(() => {});
    src.getHistory!()
      .then((h) => alive && setEntries(h))
      .catch((e) => {
        if (!alive) return;
        setEntries([]);
        setError(`Couldn't load track history (${e.message ?? e}). Recently played albums still work.`);
      });
    return () => {
      alive = false;
    };
  }, [tab, nonce]);

  const isLocal = tab === 'local';
  const list = isLocal ? local : entries;

  return (
    <div className="page">
      <header className="page-head">
        <h1>History</h1>
        {useHub.getState().token && <button className="btn small" onClick={() => useUi.getState().go({ view: 'rewind' })}>Rewind</button>}
        {!isLocal && <button className="btn small" onClick={() => setNonce(nonce + 1)}><IconRefresh /> Refresh</button>}
      </header>
      <div className="tabs">
        {navidromes.map((s) => (
          <button key={s.id} className={tab === s.id ? 'on' : ''} onClick={() => setTab(s.id)}>{s.name} <small>server</small></button>
        ))}
        <button className={isLocal ? 'on' : ''} onClick={() => setTab('local')}>This device <small>all sources</small></button>
      </div>

      {!isLocal && albums.length > 0 && (
        <section>
          <h2>Recently played albums</h2>
          <div className="row-scroll">
            {albums.map((a) => <AlbumCard key={a.id} album={a} onOpen={(album) => useUi.getState().go({ view: 'album', album })} />)}
          </div>
        </section>
      )}

      <section>
        <h2>Recently played tracks</h2>
        {error && <div className="errors">{error}</div>}
        {!list ? <Spinner /> : !list.length ? (
          <Empty title="Nothing played yet">{isLocal ? 'Tracks you play in Wavelength from any source show up here.' : ''}</Empty>
        ) : (
          <TrackList tracks={list.map((e) => e.track)} showAlbum showCover
            meta={(_, i) => (
              <span title={new Date(list[i].playedAt).toLocaleString()}>
                {timeAgo(list[i].playedAt)}
                {'playCount' in list[i] && (list[i] as HistoryEntry).playCount ? <small> · {(list[i] as HistoryEntry).playCount}×</small> : null}
              </span>
            )} />
        )}
      </section>
    </div>
  );
}
