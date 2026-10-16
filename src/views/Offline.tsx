import { collectionTracks, offlineCover, useOffline } from '../store/offline';
import { usePlayer } from '../store/player';
import { useUi } from '../store/ui';
import { Cover, Empty, Grid, TrackList } from '../components/common';
import { IconPlay, IconShuffle } from '../components/Icons';

const mb = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`);

/** Everything saved on this device — works with no connection at all. */
export function Offline() {
  const { collections, tracks } = useOffline();
  const go = useUi((s) => s.go);
  const total = Object.values(tracks).reduce((s, t) => s + t.size, 0);
  return (
    <div className="page">
      <header className="page-head">
        <h1>Downloaded <small>{Object.keys(tracks).length} songs · {mb(total)}</small></h1>
      </header>
      {!collections.length ? (
        <Empty title="Nothing downloaded yet">
          <p>Open any album or playlist and tap <b>Download</b> to keep it on this device for offline listening.</p>
        </Empty>
      ) : (
        <Grid>
          {collections.map((c) => {
            const saved = c.keys.filter((k) => tracks[k]).length;
            return (
              <button key={c.id} className="card" onClick={() => go({ view: 'offlineCollection', id: c.id })}>
                <Cover src={offlineCover(c.cover)} alt={c.name} />
                <div className="card-title">{c.name}</div>
                <div className="card-sub"><span>{c.kind === 'album' ? 'Album' : 'Playlist'} · {saved === c.keys.length ? `${saved} songs` : `${saved}/${c.keys.length} saved`}</span></div>
              </button>
            );
          })}
        </Grid>
      )}
    </div>
  );
}

export function OfflineCollectionView({ id }: { id: string }) {
  const c = useOffline((s) => s.collections.find((x) => x.id === id));
  useOffline((s) => s.tracks); // re-render as downloads land
  const playTracks = usePlayer((s) => s.playTracks);
  if (!c) return <Empty title="Not downloaded" />;
  const list = collectionTracks(c);
  return (
    <div className="page">
      <header className="hero">
        <Cover src={offlineCover(c.cover)} alt={c.name} className="hero-art" />
        <div>
          <div className="kicker">Downloaded {c.kind}</div>
          <h1>{c.name}</h1>
          {c.subtitle && <div className="muted">{c.subtitle}</div>}
          <div className="hero-actions">
            <button className="btn primary" disabled={!list.length} onClick={() => playTracks(list)}><IconPlay /> Play</button>
            <button className="btn" disabled={!list.length} onClick={() => {
              if (!usePlayer.getState().shuffle) usePlayer.getState().toggleShuffle();
              playTracks(list, Math.floor(Math.random() * list.length));
            }}><IconShuffle /> Shuffle</button>
            <button className="btn ghost" onClick={() => {
              if (confirm(`Remove "${c.name}" from this device?`)) {
                useOffline.getState().remove(c.id);
                useUi.getState().go({ view: 'offline' });
              }
            }}>Remove download</button>
          </div>
        </div>
      </header>
      <TrackList tracks={list} showAlbum={c.kind === 'playlist'} showCover={c.kind === 'playlist'} />
    </div>
  );
}
