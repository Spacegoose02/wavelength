import { useEffect, useState } from 'react';
import type { NavidromeSource } from '../sources/navidrome';
import { sourceFor } from '../sources/registry';
import type { SubWaveSource, SwTrack } from '../sources/subwave';
import type { Album, Favorites as Favs, Track } from '../sources/types';
import { SOURCE_COLORS } from '../sources/types';
import { useSettings } from '../store/settings';
import { usePlayer } from '../store/player';
import { useUi } from '../store/ui';
import { AlbumCard, Empty, Spinner, TrackList, timeAgo } from '../components/common';
import { IconPlay, IconShuffle } from '../components/Icons';
import { QueueAllOnSubwave } from '../components/TrackButtons';

const openAlbum = (album: Album) => useUi.getState().go({ view: 'album', album });

export function Favorites() {
  const sources = useSettings((s) => s.sources.filter((x) => x.enabled && (x.kind === 'navidrome' || (x.kind === 'subwave' && x.username))));
  const [tab, setTab] = useState(sources[0]?.id);
  const cfg = sources.find((s) => s.id === tab) ?? sources[0];

  if (!cfg) return <Empty title="No favorites source">Connect Navidrome (and SUB/WAVE with admin login) to see favorites.</Empty>;
  return (
    <div className="page">
      <header className="page-head"><h1>Favorites</h1></header>
      <div className="tabs">
        {sources.map((s) => (
          <button key={s.id} className={cfg.id === s.id ? 'on' : ''} onClick={() => setTab(s.id)}>
            <i className="dot" style={{ background: SOURCE_COLORS[s.kind] }} /> {s.name} <small>{s.kind === 'subwave' ? 'listener likes' : 'starred'}</small>
          </button>
        ))}
      </div>
      {cfg.kind === 'navidrome' ? <NavidromeFavs key={cfg.id} sourceId={cfg.id} /> : <SubwaveLikes key={cfg.id} sourceId={cfg.id} />}
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

/** SubWave likes are Navidrome song ids — turn them into playable Navidrome tracks. */
function SubwaveLikes({ sourceId }: { sourceId: string }) {
  const sources = useSettings((s) => s.sources);
  const cfg = sources.find((x) => x.id === sourceId)!;
  const nav = sources.find((x) => x.kind === 'navidrome' && x.enabled);
  const [likes, setLikes] = useState<(SwTrack & { count?: number; likedAt?: number })[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    (sourceFor(cfg) as SubWaveSource).likes().then(setLikes).catch((e) => setError(String(e.message ?? e)));
  }, [sourceId]);

  if (error) return <div className="errors">{error}</div>;
  if (!likes) return <Spinner />;
  if (!nav) return <div className="errors">Connect the Navidrome server SUB/WAVE plays from to play liked songs.</div>;
  const shown = likes.filter((t) => t.id);
  const tracks = shown.map((t) => (sourceFor(nav) as NavidromeSource).trackFromId(t.id!, { title: t.title, artist: t.artist, album: t.album, duration: t.duration }));
  if (!tracks.length) return <Empty title="No likes yet">Listeners' ♥ on SUB/WAVE show up here.</Empty>;
  return (
    <section>
      <h2>Liked on {cfg.name} <small className="muted">{tracks.length}</small></h2>
      <PlayBar tracks={tracks} />
      <TrackList tracks={tracks} showAlbum showCover
        meta={(_, i) => [shown[i].likedAt ? timeAgo(shown[i].likedAt!) : '', shown[i].count && shown[i].count! > 1 ? `♥ ${shown[i].count}` : ''].filter(Boolean).join(' · ')} />
    </section>
  );
}
