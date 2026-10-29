/**
 * Browse the Deezer catalog inside Downloads → Deezer: artist pages (top songs, discography,
 * related artists, playlists), album pages and playlist pages (full tracklists), each with Get
 * buttons that go to deemix.
 * Navigation is a small stack owned by the Deezer tab, so Back walks back through what you opened.
 */
import { useEffect, useState } from 'react';
import { mustRequest, useMustRequest } from '../lib/inbox';
import { getDeezerAlbum, getDeezerArtist, getDeezerPlaylist, type DeezerAlbumPage, type DeezerArtistPage, type DeezerPlaylistPage, type DeezerResult } from '../sources/deemix';
import type { Track } from '../sources/types';
import { usePlayer } from '../store/player';
import { Cover, Rating, Spinner, fmtTime } from '../components/common';
import { useHidden } from '../lib/kids';
import { IconBack, IconDownload, IconPause, IconPlay } from '../components/Icons';

export type Browse = { type: 'artist' | 'album' | 'playlist'; id: number; title: string };
export type SendStatus = { s: 'queued' | 'error' | 'sending'; msg?: string };

export interface BrowseProps {
  /** Open another artist, album or playlist page on top of the stack. */
  open(b: Browse): void;
  /** Send a Deezer link (song, album, playlist or artist) to deemix. */
  send(r: DeezerResult): void;
  status: Record<string, SendStatus>;
}

export const statusKey = (r: DeezerResult) => `${r.type}:${r.id}`;

/** A 30s Deezer clip as a playable (unsaveable) track — same shape Discover uses. */
function previewTrack(r: DeezerResult): Track {
  return { id: `preview:${r.preview}`, sourceId: 'preview', kind: 'track', title: r.title, artist: r.artist, album: '30-second preview', coverUrl: r.cover, streamUrl: r.preview!, duration: 30, explicit: r.explicit ? 'explicit' : undefined };
}

function PreviewButton({ r }: { r: DeezerResult }) {
  const nowId = usePlayer((s) => s.queue[s.index]?.id);
  const playing = usePlayer((s) => s.playing);
  if (!r.preview) return null;
  const on = nowId === `preview:${r.preview}`;
  return (
    <button className={`icon-btn preview-btn ${on ? 'on' : ''}`} title="Play a 30-second preview"
      onClick={(e) => {
        e.stopPropagation();
        if (on) usePlayer.getState().toggle();
        else usePlayer.getState().playTracks([previewTrack(r)]);
      }}>
      {on && playing ? <IconPause /> : <IconPlay />}
    </button>
  );
}

export function GetButton({ r, send, status, label = 'Get' }: { r: DeezerResult; send(r: DeezerResult): void; status: Record<string, SendStatus>; label?: string }) {
  const st = status[statusKey(r)];
  // no Autodownload: ask the Hub admin instead
  const ask = useMustRequest();
  return (
    <button className="btn small" disabled={st?.s === 'sending' || st?.s === 'queued'} title={st?.s === 'error' ? st.msg : undefined} onClick={(e) => { e.stopPropagation(); send(r); }}>
      <IconDownload /> {st?.s === 'queued' ? (ask ? 'Requested' : 'Queued') : st?.s === 'sending' ? '…' : ask ? label.replace(/^Get/, 'Request') : label}
    </button>
  );
}

/** One row in search results or a page: artist, album, playlist or song. Titles open their page. */
export function DzRow({ r, open, send, status, numbered }: BrowseProps & { r: DeezerResult; numbered?: boolean }) {
  const st = status[statusKey(r)];
  const target: Browse | undefined =
    r.type === 'artist' ? { type: 'artist', id: r.id, title: r.title }
    : r.type === 'album' || r.type === 'playlist' ? { type: r.type, id: r.id, title: r.title }
    : undefined;
  const year = r.releaseDate?.slice(0, 4);
  const hidden = useHidden();
  if (hidden.deezer(r)) return null;
  return (
    <div className={`station-row dz-row ${target ? 'openable' : ''}`} onClick={target ? () => open(target) : undefined}>
      {numbered ? <div className="track-num">{r.trackNumber}</div> : <Cover src={r.cover} alt={r.title} round={r.type === 'artist'} className="tiny" />}
      <div className="track-main">
        <div className="track-title">
          {target ? <button className="dz-open" onClick={(e) => { e.stopPropagation(); open(target); }}>{r.title}</button> : r.title}
          <Rating explicit={r.explicit} />
          {!numbered && <span className="tag">{r.type === 'album' && r.recordType && r.recordType !== 'album' ? r.recordType : r.type === 'track' ? 'song' : r.type}</span>}
        </div>
        <div className="track-sub">
          {r.type === 'artist'
            ? <>{r.fans ? `${r.fans.toLocaleString()} fans` : 'Artist'}</>
            : r.type === 'playlist'
            ? <>By {r.artist}{r.trackCount ? ` · ${r.trackCount} tracks` : ''}</>
            : <>
                {r.artistId
                  ? <button className="dz-link" onClick={(e) => { e.stopPropagation(); open({ type: 'artist', id: r.artistId!, title: r.artist }); }}>{r.artist}</button>
                  : r.artist}
                {r.album && !numbered && <> — {r.albumId
                  ? <button className="dz-link" onClick={(e) => { e.stopPropagation(); open({ type: 'album', id: r.albumId!, title: r.album! }); }}>{r.album}</button>
                  : r.album}</>}
                {year ? ` · ${year}` : ''}
                {r.trackCount ? ` · ${r.trackCount} tracks` : ''}
                {r.duration ? ` · ${fmtTime(r.duration)}` : ''}
              </>}
        </div>
        {st?.s === 'error' && <div className="card-err">{st.msg}</div>}
      </div>
      <PreviewButton r={r} />
      {r.type === 'artist'
        ? <button className="btn small ghost" onClick={(e) => { e.stopPropagation(); open(target!); }}>Browse</button>
        : <GetButton r={r} send={send} status={status} />}
    </div>
  );
}

/** Loads a page and re-loads when the id changes; stale answers are dropped. */
function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let alive = true;
    setData(undefined);
    setError(undefined);
    load().then((d) => alive && setData(d), (e) => alive && setError(String((e as Error).message ?? e)));
    return () => {
      alive = false;
    };
  }, deps);
  return { data, error };
}

const SECTIONS: { id: string; label: string; match(t?: string): boolean }[] = [
  { id: 'album', label: 'Albums', match: (t) => t === 'album' || !t },
  { id: 'ep', label: 'EPs', match: (t) => t === 'ep' },
  { id: 'single', label: 'Singles', match: (t) => t === 'single' },
  { id: 'compile', label: 'Compilations', match: (t) => t === 'compile' },
];

export function DeezerArtist({ id, ...p }: BrowseProps & { id: number }) {
  const { data, error } = useLoad<DeezerArtistPage>(() => getDeezerArtist(id), [id]);
  if (error) return <div className="errors">{error}</div>;
  if (!data) return <Spinner />;
  const { artist, top, albums, related, playlists } = data;
  return (
    <div className="dz-page">
      <div className="dz-head">
        <Cover src={artist.cover} alt={artist.title} round className="dz-art" />
        <div>
          <div className="kicker">Artist on Deezer</div>
          <h2>{artist.title}</h2>
          <div className="muted small">{artist.fans ? `${artist.fans.toLocaleString()} fans · ` : ''}{albums.length} releases</div>
          <div className="hero-actions">
            <GetButton r={artist} send={(r) => confirm(`Send ${artist.title}'s whole discography (${albums.length} releases) to ${mustRequest() ? 'your Hub admin' : 'deemix'}?`) && p.send(r)} status={p.status} label="Get discography" />
          </div>
          {p.status[statusKey(artist)]?.s === 'error' && <div className="card-err">{p.status[statusKey(artist)].msg}</div>}
        </div>
      </div>

      {top.length > 0 && <>
        <h3 className="dz-section">Top songs</h3>
        {top.map((t) => <DzRow key={statusKey(t)} r={t} {...p} />)}
      </>}

      {SECTIONS.map((s) => {
        const list = albums.filter((a) => s.match(a.recordType));
        if (!list.length) return null;
        return (
          <div key={s.id}>
            <h3 className="dz-section">{s.label} <small className="muted">{list.length}</small></h3>
            <div className="grid dz-grid">
              {list.map((a) => (
                <div key={a.id} className="dz-card">
                  <button className="card" onClick={() => p.open({ type: 'album', id: a.id, title: a.title })}>
                    <Cover src={a.cover} alt={a.title} />
                    <div className="card-title" title={a.title}>{a.title}</div>
                    <div className="card-sub"><span>{a.releaseDate?.slice(0, 4)}</span></div>
                  </button>
                  <GetButton r={a} send={p.send} status={p.status} />
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {playlists.length > 0 && <>
        <h3 className="dz-section">Playlists with {artist.title}</h3>
        <div className="grid dz-grid">
          {playlists.map((pl) => (
            <div key={pl.id} className="dz-card">
              <button className="card" onClick={() => p.open({ type: 'playlist', id: pl.id, title: pl.title })}>
                <Cover src={pl.cover} alt={pl.title} />
                <div className="card-title" title={pl.title}>{pl.title}</div>
                <div className="card-sub"><span>By {pl.artist}</span></div>
              </button>
            </div>
          ))}
        </div>
      </>}

      {related.length > 0 && <>
        <h3 className="dz-section">Fans also like</h3>
        <div className="grid dz-grid">
          {related.map((a) => (
            <button key={a.id} className="card" onClick={() => p.open({ type: 'artist', id: a.id, title: a.title })}>
              <Cover src={a.cover} alt={a.title} round />
              <div className="card-title" title={a.title}>{a.title}</div>
            </button>
          ))}
        </div>
      </>}
    </div>
  );
}

export function DeezerAlbum({ id, ...p }: BrowseProps & { id: number }) {
  const { data, error } = useLoad<DeezerAlbumPage>(() => getDeezerAlbum(id), [id]);
  if (error) return <div className="errors">{error}</div>;
  if (!data) return <Spinner />;
  const { album, tracks, label } = data;
  const length = tracks.reduce((n, t) => n + (t.duration ?? 0), 0);
  return (
    <div className="dz-page">
      <div className="dz-head">
        <Cover src={album.cover} alt={album.title} className="dz-art" />
        <div>
          <div className="kicker">{album.recordType && album.recordType !== 'album' ? album.recordType : 'Album'} on Deezer</div>
          <h2>{album.title}</h2>
          <div className="muted small">
            {album.artistId
              ? <button className="dz-link" onClick={() => p.open({ type: 'artist', id: album.artistId!, title: album.artist })}>{album.artist}</button>
              : album.artist}
            {album.releaseDate ? ` · ${album.releaseDate.slice(0, 4)}` : ''} · {tracks.length} tracks · {fmtTime(length)}{label ? ` · ${label}` : ''}
          </div>
          <div className="hero-actions">
            <GetButton r={album} send={p.send} status={p.status} label="Get album" />
          </div>
          {p.status[statusKey(album)]?.s === 'error' && <div className="card-err">{p.status[statusKey(album)].msg}</div>}
        </div>
      </div>
      {tracks.map((t) => <DzRow key={statusKey(t)} r={t} numbered {...p} />)}
    </div>
  );
}

export function DeezerPlaylist({ id, ...p }: BrowseProps & { id: number }) {
  const { data, error } = useLoad<DeezerPlaylistPage>(() => getDeezerPlaylist(id), [id]);
  if (error) return <div className="errors">{error}</div>;
  if (!data) return <Spinner />;
  const { playlist, tracks, description } = data;
  const length = tracks.reduce((n, t) => n + (t.duration ?? 0), 0);
  return (
    <div className="dz-page">
      <div className="dz-head">
        <Cover src={playlist.cover} alt={playlist.title} className="dz-art" />
        <div>
          <div className="kicker">Playlist on Deezer</div>
          <h2>{playlist.title}</h2>
          <div className="muted small">
            By {playlist.artist} · {tracks.length} tracks · {fmtTime(length)}{playlist.fans ? ` · ${playlist.fans.toLocaleString()} fans` : ''}
          </div>
          {description && <p className="muted small dz-desc">{description}</p>}
          <div className="hero-actions">
            <GetButton r={playlist} send={(r) => (tracks.length <= 50 || confirm(`Send all ${tracks.length} songs in "${playlist.title}" to ${mustRequest() ? 'your Hub admin' : 'deemix'}?`)) && p.send(r)} status={p.status} label="Get playlist" />
          </div>
          {p.status[statusKey(playlist)]?.s === 'error' && <div className="card-err">{p.status[statusKey(playlist)].msg}</div>}
        </div>
      </div>
      {tracks.map((t, i) => <DzRow key={`${i}:${t.id}`} r={t} {...p} />)}
    </div>
  );
}

/** Back button + breadcrumb above a browse page. */
export function BrowseBar({ stack, back, home }: { stack: Browse[]; back(): void; home(): void }) {
  return (
    <div className="dz-crumbs">
      <button className="btn small ghost" onClick={back}><IconBack /> Back</button>
      <button className="dz-link" onClick={home}>Results</button>
      {stack.map((b, i) => (
        <span key={`${b.type}:${b.id}:${i}`}> / {i === stack.length - 1 ? <b>{b.title}</b> : <span className="muted">{b.title}</span>}</span>
      ))}
    </div>
  );
}
