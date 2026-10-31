/**
 * Browse the Deezer catalog inside Downloads → Deezer: artist pages (top songs, discography,
 * related artists, playlists), album pages and playlist pages (full tracklists), each with Get
 * buttons that go to deemix.
 * Navigation is a small stack owned by the Deezer tab, so Back walks back through what you opened.
 * Songs and albums carry an E (explicit) or C (clean) badge, and Clean only hides explicit ones
 * (lib/deezerVersions.ts says which is which). Releases you already have say **In library** instead of Get
 * (lib/artistReleases.ts). The library artist page's **Browse releases** (views/ArtistReleases.tsx) opens the
 * same pages.
 */
import { useEffect, useState } from 'react';
import { mustRequest, requestMusic, useMustRequest } from '../lib/inbox';
import { deemixClient } from '../lib/hubServices';
import { refreshDeemix } from '../lib/deemixQueue';
import { useOwnedRelease } from '../lib/artistReleases';
import { useVersionPref } from '../lib/versions';
import { useSettings } from '../store/settings';
import { useUi } from '../store/ui';
import { getDeezerAlbum, getDeezerArtist, getDeezerPlaylist, type DeezerAlbumPage, type DeezerArtistPage, type DeezerPlaylistPage, type DeezerResult } from '../sources/deemix';
import type { Track } from '../sources/types';
import { usePlayer } from '../store/player';
import { Cover, Rating, Spinner, fmtTime } from '../components/common';
import { useHidden } from '../lib/kids';
import { IconBack, IconDownload, IconPause, IconPlay } from '../components/Icons';
import { FollowButton } from '../components/FollowButton';
import { cleanOnly, ownVersion, withVersions } from '../lib/deezerVersions';

export type Browse = { type: 'artist' | 'album' | 'playlist'; id: number; title: string };
export type SendStatus = { s: 'queued' | 'error' | 'sending'; msg?: string };

export interface BrowseProps {
  /** Open another artist, album or playlist page on top of the stack. */
  open(b: Browse): void;
  /** Send a Deezer link (song, album, playlist or artist) to deemix. */
  send(r: DeezerResult): void;
  status: Record<string, SendStatus>;
  /** Clean only: leave explicit songs and albums out of results and pages. */
  clean?: boolean;
  setClean?(on: boolean): void;
}

/**
 * The state behind a browse stack: the pages opened, what's been sent, and Clean only. `send` gets with deemix,
 * or asks the Hub admin (`request`, for people without Autodownload).
 */
export function useDeezerBrowse({ request, initial = [] }: { request?: boolean; initial?: Browse[] } = {}) {
  const deemix = useSettings((s) => s.deemix);
  const [status, setStatus] = useState<Record<string, SendStatus>>({});
  // Clean only starts on for people who prefer clean versions (Settings → Playback; kid profiles always do)
  const pref = useVersionPref();
  const [clean, setClean] = useState(pref === 'clean');
  const [stack, setStack] = useState<Browse[]>(initial);
  const open = (b: Browse) => setStack((st) => [...st, b]);

  const send = async (r: DeezerResult) => {
    const key = statusKey(r);
    setStatus((s) => ({ ...s, [key]: { s: 'sending' } }));
    try {
      if (request) {
        await requestMusic({ link: r.link, kind: r.type, title: r.title, artist: r.artist, cover: r.cover });
        setStatus((s) => ({ ...s, [key]: { s: 'queued' } }));
        return;
      }
      await deemixClient().addToQueue(r.link, deemix.bitrate);
      setStatus((s) => ({ ...s, [key]: { s: 'queued' } }));
      void refreshDeemix();
    } catch (e) {
      setStatus((s) => ({ ...s, [key]: { s: 'error', msg: String((e as Error).message ?? e) } }));
    }
  };

  const browse: BrowseProps = { open, send, status, clean, setClean };
  return { stack, setStack, browse };
}

/** All / Clean only switch, with how many explicit results it's hiding. */
export function CleanChips({ clean, setClean, hidden }: Pick<BrowseProps, 'clean' | 'setClean'> & { hidden?: number }) {
  if (!setClean) return null;
  return (
    <div className="chips dz-clean" role="group" aria-label="Explicit or clean">
      <button className={`chip ${!clean ? 'on' : ''}`} onClick={() => setClean(false)}>All</button>
      <button className={`chip ${clean ? 'on' : ''}`} title="Hide explicit songs and albums, so the clean versions are easy to find" onClick={() => setClean(true)}>
        Clean only
      </button>
      {clean && hidden ? <span className="muted small">{hidden} explicit hidden</span> : null}
    </div>
  );
}

/** "Explicit" / "Clean" under an album card, so two releases with the same name and cover can be told apart. */
const versionLabel = (r: DeezerResult) => (r.version === 'explicit' ? 'Explicit' : r.version === 'clean' ? 'Clean' : undefined);

export const statusKey = (r: DeezerResult) => `${r.type}:${r.id}`;

/** "Out Mar 14" for a release Deezer lists ahead of its date. */
export function upcomingLabel(r: DeezerResult, today = new Date().toISOString().slice(0, 10)) {
  if (!r.releaseDate || r.releaseDate <= today) return undefined;
  return `Out ${new Date(r.releaseDate + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric', year: r.releaseDate.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric' })}`;
}

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
          <Rating explicit={r.version ?? r.explicit} />
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
  const owned = useOwnedRelease();
  const kidHidden = useHidden();
  // Not in library: only what you could still get
  const [missing, setMissing] = useState(false);
  if (error) return <div className="errors">{error}</div>;
  if (!data) return <Spinner />;
  const { artist, playlists } = data;
  const related = data.related.filter((a) => !kidHidden.deezer(a));
  const allTop = withVersions(data.top);
  // a kid profile doesn't see what it mustn't, whichever chip is on
  const allAlbums = withVersions(data.albums).filter((a) => !kidHidden.deezer(a));
  const top = p.clean ? cleanOnly(allTop) : allTop;
  const versioned = p.clean ? cleanOnly(allAlbums) : allAlbums;
  const hidden = allTop.length - top.length + allAlbums.length - versioned.length;
  const have = allAlbums.filter((a) => owned(a)).length;
  const albums = missing ? versioned.filter((a) => !owned(a)) : versioned;
  return (
    <div className="dz-page">
      <div className="dz-head">
        <Cover src={artist.cover} alt={artist.title} round className="dz-art" />
        <div>
          <div className="kicker">Artist on Deezer</div>
          <h2>{artist.title}</h2>
          <div className="muted small">{artist.fans ? `${artist.fans.toLocaleString()} fans · ` : ''}{allAlbums.length} releases{have ? ` · ${have} in your library` : ''}</div>
          <div className="hero-actions">
            <FollowButton id={artist.id} name={artist.title} picture={artist.cover} className="btn small" />
            <GetButton r={artist} send={(r) => confirm(`Send ${artist.title}'s whole discography (${allAlbums.length} releases) to ${mustRequest() ? 'your Hub admin' : 'deemix'}?`) && p.send(r)} status={p.status} label="Get discography" />
          </div>
          {p.status[statusKey(artist)]?.s === 'error' && <div className="card-err">{p.status[statusKey(artist)].msg}</div>}
        </div>
      </div>
      <div className="row gap dz-filters">
        <CleanChips clean={p.clean} setClean={p.setClean} hidden={hidden} />
        {have > 0 && (
          <div className="chips" role="group" aria-label="In your library or not">
            <button className={`chip ${!missing ? 'on' : ''}`} onClick={() => setMissing(false)}>Everything</button>
            <button className={`chip ${missing ? 'on' : ''}`} title="Hide the releases you already have" onClick={() => setMissing(true)}>Not in library</button>
          </div>
        )}
      </div>

      {top.length > 0 && !missing && <>
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
              {list.map((a) => {
                const mine = owned(a);
                return (
                  <div key={a.id} className={`dz-card ${mine ? 'owned' : ''}`}>
                    <button className="card" onClick={() => p.open({ type: 'album', id: a.id, title: a.title })}>
                      <Cover src={a.cover} alt={a.title} />
                      <div className="card-title dz-title" title={a.title}><Rating explicit={a.version ?? a.explicit} />{a.title}</div>
                      <div className="card-sub"><span>{[upcomingLabel(a) ?? a.releaseDate?.slice(0, 4), versionLabel(a)].filter(Boolean).join(' · ')}</span></div>
                    </button>
                    {mine
                      ? <button className="btn small ghost" title="You have this one. Open it in your library" onClick={() => useUi.getState().go({ view: 'album', album: mine })}>✓ In library</button>
                      : upcomingLabel(a) ? null
                      : <GetButton r={a} send={p.send} status={p.status} />}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {missing && !albums.length && <p className="muted">You have everything {artist.title} has put out{p.clean ? ' in clean versions' : ''}.</p>}

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
  const { label } = data;
  const album = { ...data.album, version: ownVersion(data.album) };
  // on a clean album, songs Deezer marks not explicit are the clean versions of their songs
  const tracks = withVersions(data.tracks).map((t) => (album.version === 'clean' && !t.version && t.explicit === false ? { ...t, version: 'clean' as const } : t));
  const length = tracks.reduce((n, t) => n + (t.duration ?? 0), 0);
  return (
    <div className="dz-page">
      <div className="dz-head">
        <Cover src={album.cover} alt={album.title} className="dz-art" />
        <div>
          <div className="kicker">{album.recordType && album.recordType !== 'album' ? album.recordType : 'Album'} on Deezer</div>
          <h2><Rating explicit={album.version ?? album.explicit} />{album.title}</h2>
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
