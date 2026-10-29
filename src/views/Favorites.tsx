import { useEffect, useState } from 'react';
import { sourceFor } from '../sources/registry';
import type { Album, Favorites as Favs, Track } from '../sources/types';
import { SOURCE_COLORS } from '../sources/types';
import { useSettings } from '../store/settings';
import { usePlayer } from '../store/player';
import { useUi } from '../store/ui';
import { AlbumCard, Empty, Spinner, TrackList } from '../components/common';
import { IconPlay, IconShuffle } from '../components/Icons';
import { QueueAllOnSubwave } from '../components/TrackButtons';

const openAlbum = (album: Album) => useUi.getState().go({ view: 'album', album });

export function Favorites() {
  const sources = useSettings((s) => s.sources.filter((x) => x.enabled && (x.kind === 'navidrome' || (x.kind === 'subwave' && (x.username || x.hubAdmin)))));
  const [tab, setTab] = useState(sources[0]?.id);
  const cfg = sources.find((s) => s.id === tab) ?? sources[0];

  if (!cfg) return <Empty title="No favorites source">Connect Navidrome to see favorites.</Empty>;
  return (
    <div className="page">
      <header className="page-head"><h1>Favorites</h1></header>
      {sources.length > 1 && (
        <div className="tabs">
          {sources.map((s) => (
            <button key={s.id} className={cfg.id === s.id ? 'on' : ''} onClick={() => setTab(s.id)}>
              <i className="dot" style={{ background: SOURCE_COLORS[s.kind] }} /> {s.name}
            </button>
          ))}
        </div>
      )}
      <NavidromeFavs key={cfg.id} sourceId={cfg.id} />
    </div>
  );
}

function PlayBar({ tracks }: { tracks: Track[] }) {
  const playTracks = usePlayer((s) => s.playTracks);
  if (!tracks.length) return null;
  return (
    <div className="row gap" style={{ marginBottom: 16 }}>
      <button className="btn primary" onClick={() => playTracks(tracks)}><IconPlay /> Play all</button>
      <button className="btn" onClick={() => {
        if (!usePlayer.getState().shuffle) usePlayer.getState().toggleShuffle();
        playTracks(tracks, Math.floor(Math.random() * tracks.length));
      }}><IconShuffle /> Shuffle</button>
      <QueueAllOnSubwave tracks={tracks} />
    </div>
  );
}

function NavidromeFavs({ sourceId }: { sourceId: string }) {
  const cfg = useSettings((s) => s.sources.find((x) => x.id === sourceId))!;
  const [favs, setFavs] = useState<Favs>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    sourceFor(cfg).getFavorites!().then(setFavs).catch((e) => setError(String(e.message ?? e)));
  }, [sourceId]);
  if (error) return <div className="errors">{error}</div>;
  if (!favs) return <Spinner />;
  if (!favs.tracks.length && !favs.albums.length) return <Empty title="Nothing starred yet">Tap the ♥ on any Navidrome track.</Empty>;
  return (
    <>
      {favs.albums.length > 0 && (
        <section>
          <h2>Albums</h2>
          <div className="row-scroll">{favs.albums.map((a) => <AlbumCard key={a.id} album={a} onOpen={openAlbum} />)}</div>
        </section>
      )}
      <section>
        <h2>Tracks <small className="muted">{favs.tracks.length}</small></h2>
        <PlayBar tracks={favs.tracks} />
        <TrackList tracks={favs.tracks} showAlbum showCover />
      </section>
    </>
  );
}
