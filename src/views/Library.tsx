import { useEffect, useMemo, useState } from 'react';
import { useCatalog } from '../store/catalog';
import { useSettings } from '../store/settings';
import { useUi } from '../store/ui';
import { usePlayer } from '../store/player';
import { sourceFor, mergeAlbums } from '../sources/registry';
import { stationToTrack } from '../sources/radio';
import type { Album, Artist, Track } from '../sources/types';
import { SOURCE_COLORS } from '../sources/types';
import { AlbumCard, ArtistCard, Cover, Rating, Empty, Grid, SourceDots, Spinner, TrackList, fmtTime } from '../components/common';
import { IconPlay, IconShuffle } from '../components/Icons';
import { AddToPlaylist } from '../components/AddToPlaylist';
import { ShareButton } from '../components/ShareButton';
import { shareOfArtist, shareOfTracks } from '../lib/inbox';
import { explicitOfAlbum, explicitOfTrack, useHidden, useIsKid, useRatings } from '../lib/kids';
import { hasBoth, preferredRef, useVersionPref, versionOf, versionsOf } from '../lib/versions';
import { CleanVersionButton, KidFlagButton } from '../components/KidFlag';
import { QueueAllOnSubwave } from '../components/TrackButtons';
import { DownloadButton } from '../components/DownloadButton';
import { ArtworkButton } from '../components/ArtworkButton';
import { albumArt, artistArt, useArtworkList } from '../lib/artwork';

const openAlbum = (album: Album) => useUi.getState().go({ view: 'album', album });

export function Home() {
  const { recent, albums, loading, loaded, errors } = useCatalog();
  const sources = useSettings((s) => s.sources);
  const stations = useSettings((s) => s.stations);
  const go = useUi((s) => s.go);
  const playTracks = usePlayer((s) => s.playTracks);
  const subwave = sources.filter((s) => s.kind === 'subwave' && s.enabled);
  // stable pick: the same 12 all day (no reshuffling on every render/visit), new set tomorrow
  const [shuffleSeed, setShuffleSeed] = useState(rediscoverSeed);
  const rediscover = useMemo(() => pickDaily(albums, 12, shuffleSeed), [albums.length, shuffleSeed]);

  if (!sources.length) {
    return (
      <Empty title="Welcome to Wavelength">
        <p>Add your Navidrome, Plex, Audiobookshelf and SubWave servers to build one catalog.</p>
        <button className="btn primary" onClick={() => go({ view: 'settings' })}>Add a source</button>
      </Empty>
    );
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>Good {greeting()}</h1>
        {loading && <Spinner />}
      </header>
      <ErrorList errors={errors} />

      {(subwave.length > 0 || stations.length > 0) && (
        <section>
          <h2>On air</h2>
          <div className="shelf">
            {subwave.map((cfg) => (
              <button key={cfg.id} className="station-hero" onClick={async () => {
                const [st] = await sourceFor(cfg).getStations!();
                playTracks([stationToTrack(st)]);
              }}>
                <span className="live-dot" /> <b>{cfg.name}</b><small>Agentic radio</small>
              </button>
            ))}
            {stations.slice(0, 8).map((st) => (
              <button key={st.id} className="station-pill" onClick={() => playTracks([stationToTrack(st)])}>
                <Cover src={st.favicon} alt={st.name} className="tiny" /> {st.name}
              </button>
            ))}
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section>
          <h2>Recently added <button className="link small" onClick={() => go({ view: 'recent' })}>See all →</button></h2>
          <div className="row-scroll">{recent.map((a) => <AlbumCard key={`${a.sourceId}:${a.id}`} album={a} onOpen={openAlbum} />)}</div>
        </section>
      )}
      {rediscover.length > 0 && (
        <section>
          <h2>Rediscover <button className="link small" onClick={() => setShuffleSeed((rediscoverSeed += 1))}>Shuffle ↻</button></h2>
          <div className="row-scroll">{rediscover.map((a) => <AlbumCard key={`${a.sourceId}:${a.id}`} album={a} onOpen={openAlbum} />)}</div>
        </section>
      )}
      {loaded && !albums.length && !loading && <Empty title="No albums yet">Check your sources in Settings.</Empty>}
    </div>
  );
}

let rediscoverSeed = 0;

/** Deterministic shuffle keyed on today's date (+ a reshuffle counter). */
function pickDaily<T extends { id: string; sourceId: string }>(items: T[], n: number, extra: number): T[] {
  const day = new Date().toISOString().slice(0, 10);
  const hash = (s: string) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  };
  return [...items]
    .map((a) => ({ a, k: hash(`${day}:${extra}:${a.sourceId}:${a.id}`) }))
    .sort((x, y) => x.k - y.k)
    .slice(0, n)
    .map((x) => x.a);
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
}

export function ErrorList({ errors }: { errors: Record<string, string> }) {
  const entries = Object.entries(errors);
  if (!entries.length) return null;
  return (
    <div className="errors">
      {entries.map(([name, msg]) => <div key={name}><b>{name}:</b> {msg}</div>)}
    </div>
  );
}

export function Albums() {
  const { albums, loading } = useCatalog();
  const sources = useSettings((s) => s.sources);
  const [filter, setFilter] = useState('');
  const [only, setOnly] = useState<string | null>(null);
  const hidden = useHidden();
  const shown = useMemo(() => {
    const f = filter.toLowerCase();
    return albums.filter(
      (a) => (!f || a.title.toLowerCase().includes(f) || a.artist.toLowerCase().includes(f)) &&
        (!only || (a.refs ?? [a]).some((r) => r.sourceId === only)) && !hidden.album(a),
    );
  }, [albums, filter, only, hidden]);
  const musicSources = sources.filter((s) => s.enabled && (s.kind === 'navidrome' || s.kind === 'plex'));

  return (
    <div className="page">
      <header className="page-head">
        <h1>Albums <small>{shown.length}</small></h1>
        {loading && <Spinner />}
        <input className="filter" placeholder="Filter albums…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </header>
      {musicSources.length > 1 && (
        <div className="chips">
          <button className={`chip ${!only ? 'on' : ''}`} onClick={() => setOnly(null)}>All sources</button>
          {musicSources.map((s) => (
            <button key={s.id} className={`chip ${only === s.id ? 'on' : ''}`} onClick={() => setOnly(s.id)}>
              <i className="dot" style={{ background: SOURCE_COLORS[s.kind] }} /> {s.name}
            </button>
          ))}
        </div>
      )}
      <Grid>{shown.slice(0, 600).map((a) => <AlbumCard key={`${a.sourceId}:${a.id}`} album={a} onOpen={openAlbum} />)}</Grid>
      {shown.length > 600 && <p className="muted center">Showing 600 of {shown.length} — filter to narrow down.</p>}
    </div>
  );
}

export function Artists() {
  const { artists } = useCatalog();
  const go = useUi((s) => s.go);
  const [filter, setFilter] = useState('');
  const hidden = useHidden();
  const shown = artists.filter((a) => a.name.toLowerCase().includes(filter.toLowerCase()) && !hidden.artist(a));
  return (
    <div className="page">
      <header className="page-head">
        <h1>Artists <small>{shown.length}</small></h1>
        <input className="filter" placeholder="Filter artists…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </header>
      <Grid>
        {shown.slice(0, 600).map((a) => <ArtistCard key={`${a.sourceId}:${a.id}`} artist={a} onOpen={(artist) => go({ view: 'artist', artist })} />)}
      </Grid>
    </div>
  );
}

function useSourceCfg() {
  const sources = useSettings((s) => s.sources);
  return (id: string) => sources.find((s) => s.id === id);
}

export function ArtistView({ artist }: { artist: Artist }) {
  const cfgOf = useSourceCfg();
  const [albums, setAlbums] = useState<Album[] | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all(
      (artist.refs ?? [artist]).map(async (ref) => {
        const cfg = cfgOf(ref.sourceId);
        try {
          return cfg ? (await sourceFor(cfg).getArtistAlbums?.(ref.id)) ?? [] : [];
        } catch {
          return [];
        }
      }),
    ).then((lists) => alive && setAlbums(mergeAlbums(lists).sort((a, b) => (b.year ?? 0) - (a.year ?? 0))));
    return () => {
      alive = false;
    };
  }, [artist]);
  const hidden = useHidden();
  useArtworkList();
  if (hidden.artist(artist)) return <div className="page"><Empty title="Not available">Ask a grown-up about this one.</Empty></div>;

  return (
    <div className="page">
      <header className="hero">
        <Cover src={artistArt(artist)} alt={artist.name} round className="hero-art" />
        <div>
          <div className="kicker">Artist</div>
          <h1>{artist.name}</h1>
          <SourceDots sourceIds={(artist.refs ?? [artist]).map((r) => r.sourceId)} />
          <div className="hero-actions">
            <ShareButton what={() => shareOfArtist(artist.name, artistArt(artist))} />
            <KidFlagButton kind="artist" artist={artist.name} />
            <ArtworkButton kind="artist" artist={artist.name} current={artistArt(artist)} />
          </div>
        </div>
      </header>
      {!albums ? <Spinner /> : <Grid>{albums.map((a) => <AlbumCard key={`${a.sourceId}:${a.id}`} album={a} onOpen={openAlbum} />)}</Grid>}
    </div>
  );
}

export function AlbumView({ album }: { album: Album }) {
  const cfgOf = useSourceCfg();
  const refs = album.refs ?? [album];
  const [refIdx, setRefIdx] = useState(0);
  const pref = useVersionPref();
  // a version picked on the Explicit / Clean switch (or the preferred one), which can be another album's copy
  const [pick, setPick] = useState<Album | undefined>(() => preferredRef(album, pref));
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [error, setError] = useState<string>();
  const playTracks = usePlayer((s) => s.playTracks);
  const ref = pick ?? refs[refIdx];
  const hidden = useHidden();
  useRatings((s) => s.ratings);
  useArtworkList();
  const art = albumArt(album, ref.coverUrl ?? album.coverUrl);
  useCatalog((s) => s.albums);
  const versions = versionsOf(album);
  const both = hasBoth(versions);
  const shown = versionOf(ref);
  const kid = useIsKid();

  useEffect(() => {
    let alive = true;
    setTracks(null);
    setError(undefined);
    const cfg = cfgOf(ref.sourceId);
    if (!cfg) return;
    sourceFor(cfg).getAlbumTracks!(ref.id)
      .then((t) => alive && setTracks(t))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => {
      alive = false;
    };
  }, [ref]);

  const total = tracks?.reduce((s, t) => s + (t.duration ?? 0), 0) ?? 0;
  if (hidden.album(both ? { ...album, explicit: shown } : album)) return <div className="page"><Empty title="Not available">Ask a grown-up about this one.</Empty></div>;
  return (
    <div className="page">
      <header className="hero">
        <Cover src={art} alt={album.title} className="hero-art" />
        <div>
          <div className="kicker">Album{album.year ? ` · ${album.year}` : ''}</div>
          <h1>{both ? ref.title : album.title} <Rating explicit={both ? shown : explicitOfAlbum(album)} /></h1>
          <button className="link" onClick={() => {
            const artist = useCatalog.getState().artists.find((a) => (a.refs ?? [a]).some((r) => r.id === ref.artistId && r.sourceId === ref.sourceId));
            if (artist) useUi.getState().go({ view: 'artist', artist });
          }}>{album.artist}</button>
          <div className="muted">{tracks ? `${tracks.length} tracks · ${fmtTime(total)}` : ''}</div>
          <div className="hero-actions">
            <button className="btn primary" disabled={!tracks?.length} onClick={() => tracks && playTracks(tracks)}><IconPlay /> Play</button>
            <button className="btn" disabled={!tracks?.length} onClick={() => {
              if (!tracks) return;
              if (!usePlayer.getState().shuffle) usePlayer.getState().toggleShuffle();
              playTracks(tracks, Math.floor(Math.random() * tracks.length));
            }}><IconShuffle /> Shuffle</button>
            {tracks?.length ? <AddToPlaylist tracks={tracks} label="Add to playlist" className="btn" /> : null}
            {tracks?.length ? <QueueAllOnSubwave tracks={tracks} albumBlock /> : null}
            {tracks?.length ? <ShareButton what={() => shareOfTracks('album', album.title, tracks, album.artist, art)} /> : null}
            <KidFlagButton kind="album" artist={album.artist} title={album.title} explicit={explicitOfAlbum(album) === 'explicit' || tracks?.some((t) => explicitOfTrack(t) === 'explicit')} />
            {!both && <CleanVersionButton artist={album.artist} album={album.title} />}
            {both && !kid && (
              <div className="chips inline" role="group" aria-label="Version">
                {(['explicit', 'clean'] as const).map((v) => (
                  <button key={v} className={`chip ${shown === v ? 'on' : ''}`} onClick={() => setPick(versions.find((x) => x.version === v)?.ref)}>
                    {v === 'explicit' ? 'Explicit' : 'Clean'}
                  </button>
                ))}
              </div>
            )}
            <ArtworkButton kind="album" artist={album.artist} album={album.title} current={art} />
            {tracks?.length ? (
              <DownloadButton id={`album:${ref.sourceId}:${ref.id}`} kind="album" name={album.title} subtitle={album.artist}
                cover={art} tracks={tracks} />
            ) : null}
            {refs.length > 1 && (
              <div className="chips inline">
                {refs.map((r, i) => (
                  <button key={`${r.sourceId}:${r.id}`} className={`chip ${!pick && i === refIdx ? 'on' : ''}`} onClick={() => { setPick(undefined); setRefIdx(i); }}>
                    <i className="dot" style={{ background: SOURCE_COLORS[cfgOf(r.sourceId)?.kind ?? 'radio'] }} />
                    {cfgOf(r.sourceId)?.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>
      {error && <div className="errors">{error}</div>}
      {!tracks && !error ? <Spinner /> : tracks && <TrackList tracks={tracks} />}
    </div>
  );
}
