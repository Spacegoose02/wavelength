import { useEffect, useState } from 'react';
import { matchAll } from '../lib/match';
import { sourceFor } from '../sources/registry';
import { SOURCE_COLORS, type ServerPlaylist, type Track } from '../sources/types';
import { useLibrary, type Playlist } from '../store/library';
import { usePlayer } from '../store/player';
import { useServerPlaylists } from '../store/serverPlaylists';
import { useSettings } from '../store/settings';
import { useUi } from '../store/ui';
import { Cover, Empty, Grid, SourceDots, Spinner, TrackList, fmtTime } from '../components/common';
import { IconPlay, IconRefresh, IconShuffle } from '../components/Icons';
import { ErrorList } from './Library';
import { QueueAllOnSubwave } from '../components/TrackButtons';
import { DownloadButton } from '../components/DownloadButton';

export function PlaylistCover({ p }: { p: Playlist }) {
  const covers = [...new Set(p.tracks.map((t) => t.coverUrl).filter(Boolean))].slice(0, 4) as string[];
  if (covers.length < 4) return <Cover src={covers[0]} alt={p.name} />;
  return (
    <div className="cover mosaic">
      {covers.map((c) => <img key={c} src={c} alt="" loading="lazy" />)}
    </div>
  );
}

function shuffleAndPlay(tracks: Track[]) {
  if (!usePlayer.getState().shuffle) usePlayer.getState().toggleShuffle();
  usePlayer.getState().playTracks(tracks, Math.floor(Math.random() * tracks.length));
}

export function Playlists() {
  const { playlists, createPlaylist } = useLibrary();
  const server = useServerPlaylists();
  const sources = useSettings((s) => s.sources);
  const go = useUi((s) => s.go);
  const [name, setName] = useState('');

  useEffect(() => {
    server.load();
  }, []);

  const serverSections = sources.filter((s) => s.enabled && server.bySource[s.id]);

  return (
    <div className="page">
      <header className="page-head">
        <h1>Playlists</h1>
        {server.loading && <Spinner />}
        <button className="btn small" onClick={() => server.load()}><IconRefresh /> Sync</button>
        <form className="inline-form push" onSubmit={(e) => {
          e.preventDefault();
          const id = createPlaylist(name || 'New playlist');
          setName('');
          go({ view: 'playlist', id });
        }}>
          <input placeholder="New Wavelength playlist…" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn primary">Create</button>
        </form>
      </header>
      <ErrorList errors={server.errors} />

      <section>
        <h2>Wavelength <small className="muted">mix any source · stored on this device</small></h2>
        {!playlists.length ? (
          <p className="muted">Use <b>+ Playlist</b> on any track, album, episode or station.</p>
        ) : (
          <Grid>
            {playlists.map((p) => (
              <button key={p.id} className="card" onClick={() => go({ view: 'playlist', id: p.id })}>
                <PlaylistCover p={p} />
                <div className="card-title">{p.name}</div>
                <div className="card-sub"><SourceDots sourceIds={p.tracks.map((t) => t.sourceId)} /><span>{p.tracks.length} items</span></div>
              </button>
            ))}
          </Grid>
        )}
      </section>

      {serverSections.map((cfg) => (
        <section key={cfg.id}>
          <h2><i className="dot big" style={{ background: SOURCE_COLORS[cfg.kind] }} /> {cfg.name} <small className="muted">{cfg.kind === 'plex' ? 'synced with Plexamp' : 'synced with Navidrome'}</small></h2>
          {!server.bySource[cfg.id].length ? <p className="muted">No playlists on this server.</p> : (
            <Grid>
              {server.bySource[cfg.id].map((p) => (
                <button key={p.id} className="card" onClick={() => go({ view: 'serverPlaylist', playlist: p })}>
                  <Cover src={p.coverUrl} alt={p.name} />
                  <div className="card-title">{p.name}</div>
                  <div className="card-sub"><SourceDots sourceIds={[p.sourceId]} /><span>{p.trackCount ?? 0} tracks{p.readOnly ? ' · read-only' : ''}</span></div>
                </button>
              ))}
            </Grid>
          )}
        </section>
      ))}
    </div>
  );
}

/** Push a Wavelength playlist to Navidrome or Plex, matching each track onto that server. */
function ExportMenu({ p }: { p: Playlist }) {
  const sources = useSettings((s) => s.sources).filter((s) => s.enabled && (s.kind === 'navidrome' || s.kind === 'plex'));
  const [status, setStatus] = useState<string>();
  const [busy, setBusy] = useState(false);
  if (!sources.length) return null;
  return (
    <div className="export">
      {sources.map((cfg) => (
        <button key={cfg.id} className="btn small" disabled={busy || !p.tracks.length} onClick={async () => {
          setBusy(true);
          try {
            const src = sourceFor(cfg);
            const songs = p.tracks.filter((t) => t.kind === 'track');
            const { ids, missing } = await matchAll(src, songs, (n) => setStatus(`Matching ${n}/${songs.length} on ${cfg.name}…`));
            if (!ids.length) throw new Error(`none of these tracks were found on ${cfg.name}`);
            const existing = useServerPlaylists.getState().bySource[cfg.id]?.find((x) => x.name === p.name && !x.readOnly);
            if (existing) {
              if (!confirm(`"${p.name}" already exists on ${cfg.name}. Replace its contents with this playlist?`)) {
                setStatus(undefined);
                return;
              }
              // replace contents: delete + recreate with the same name
              await src.deletePlaylist!(existing.id);
            }
            await src.createPlaylist!(p.name, ids);
            setStatus(`Saved "${p.name}" to ${cfg.name}: ${ids.length} tracks${missing.length ? `, ${missing.length} not in that library` : ''}.`);
            useServerPlaylists.getState().load();
          } catch (e) {
            setStatus(`Export failed: ${(e as Error).message ?? e}`);
          } finally {
            setBusy(false);
          }
        }}>
          <i className="dot" style={{ background: SOURCE_COLORS[cfg.kind] }} /> Save to {cfg.name}
        </button>
      ))}
      {status && <span className="muted small">{status}</span>}
    </div>
  );
}

export function PlaylistView({ id }: { id: string }) {
  const p = useLibrary((s) => s.playlists.find((x) => x.id === id));
  const { removeFromPlaylist, moveInPlaylist, renamePlaylist, deletePlaylist } = useLibrary();
  const playTracks = usePlayer((s) => s.playTracks);
  const [editing, setEditing] = useState(false);
  if (!p) return <Empty title="Playlist not found" />;
  const total = p.tracks.reduce((s, t) => s + (t.duration ?? 0), 0);

  return (
    <div className="page">
      <header className="hero">
        <div className="hero-art"><PlaylistCover p={p} /></div>
        <div>
          <div className="kicker">Wavelength playlist</div>
          {editing ? (
            <form onSubmit={(e) => { e.preventDefault(); setEditing(false); }}>
              <input autoFocus className="title-input" value={p.name} onChange={(e) => renamePlaylist(p.id, e.target.value)} onBlur={() => setEditing(false)} />
            </form>
          ) : (
            <h1 onClick={() => setEditing(true)} title="Click to rename" className="editable">{p.name}</h1>
          )}
          <div className="muted row gap">
            <SourceDots sourceIds={p.tracks.map((t) => t.sourceId)} />
            {p.tracks.length} items{total ? ` · ${fmtTime(total)}` : ''}
          </div>
          <div className="hero-actions">
            <button className="btn primary" disabled={!p.tracks.length} onClick={() => playTracks(p.tracks)}><IconPlay /> Play</button>
            <button className="btn" disabled={!p.tracks.length} onClick={() => shuffleAndPlay(p.tracks)}><IconShuffle /> Shuffle</button>
            {p.tracks.length > 0 && <QueueAllOnSubwave tracks={p.tracks} />}
            <DownloadButton id={`playlist:local:${p.id}`} kind="playlist" name={p.name} cover={p.tracks.find((t) => t.coverUrl)?.coverUrl} tracks={p.tracks} />
            <button className="btn ghost" onClick={() => {
              if (confirm(`Delete "${p.name}"?`)) {
                deletePlaylist(p.id);
                useUi.getState().go({ view: 'playlists' });
              }
            }}>Delete</button>
          </div>
          <ExportMenu p={p} />
        </div>
      </header>
      {p.tracks.length ? (
        <TrackList tracks={p.tracks} showAlbum showCover
          onRemove={(i) => removeFromPlaylist(p.id, i)} onMove={(i, to) => moveInPlaylist(p.id, i, to)} />
      ) : (
        <Empty title="Empty playlist">Add tracks from albums, search, podcasts or radio with <b>+ Playlist</b>.</Empty>
      )}
    </div>
  );
}

/** A playlist living on Navidrome/Plex — every edit is written straight back to the server. */
export function ServerPlaylistView({ playlist }: { playlist: ServerPlaylist }) {
  const cfg = useSettings((s) => s.sources.find((x) => x.id === playlist.sourceId));
  const playTracks = usePlayer((s) => s.playTracks);
  const createLocal = useLibrary((s) => s.createPlaylist);
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [name, setName] = useState(playlist.name);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();
  const src = cfg ? sourceFor(cfg) : undefined;

  const reload = () =>
    src?.getPlaylistTracks!(playlist.id).then(setTracks).catch((e) => setError(String(e.message ?? e)));
  useEffect(() => {
    reload();
  }, [playlist.id]);

  const guard = async (fn: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  };

  if (!cfg || !src) return <Empty title="Source not configured" />;
  const total = tracks?.reduce((s, t) => s + (t.duration ?? 0), 0) ?? 0;
  const editable = !playlist.readOnly;

  return (
    <div className="page">
      <header className="hero">
        <Cover src={playlist.coverUrl} alt={playlist.name} className="hero-art" />
        <div>
          <div className="kicker"><i className="dot" style={{ background: SOURCE_COLORS[cfg.kind] }} /> {cfg.name} playlist{playlist.readOnly ? ' · read-only' : ''}</div>
          {editing && editable ? (
            <form onSubmit={async (e) => {
              e.preventDefault();
              setEditing(false);
              await guard(() => src.renamePlaylist!(playlist.id, name));
              useServerPlaylists.getState().load();
            }}>
              <input autoFocus className="title-input" value={name} onChange={(e) => setName(e.target.value)} />
            </form>
          ) : (
            <h1 className={editable ? 'editable' : ''} onClick={() => editable && setEditing(true)} title={editable ? 'Click to rename' : undefined}>{name}</h1>
          )}
          <div className="muted">{tracks ? `${tracks.length} tracks · ${fmtTime(total)}` : ''}</div>
          <div className="hero-actions">
            <button className="btn primary" disabled={!tracks?.length} onClick={() => tracks && playTracks(tracks)}><IconPlay /> Play</button>
            <button className="btn" disabled={!tracks?.length} onClick={() => tracks && shuffleAndPlay(tracks)}><IconShuffle /> Shuffle</button>
            {tracks?.length ? <QueueAllOnSubwave tracks={tracks} /> : null}
            {tracks?.length ? (
              <DownloadButton id={`playlist:${playlist.sourceId}:${playlist.id}`} kind="playlist" name={name} subtitle={cfg.name}
                cover={playlist.coverUrl ?? tracks.find((t) => t.coverUrl)?.coverUrl} tracks={tracks} />
            ) : null}
            <button className="btn" disabled={!tracks?.length} onClick={() => {
              if (!tracks) return;
              const id = createLocal(name, tracks);
              setNote('Copied — you can now mix in other sources.');
              window.setTimeout(() => useUi.getState().go({ view: 'playlist', id }), 700);
            }}>Copy to Wavelength</button>
            {editable && (
              <button className="btn ghost" onClick={() => guard(async () => {
                if (!confirm(`Delete "${name}" from ${cfg.name}? This removes it for every app using that server.`)) return;
                await src.deletePlaylist!(playlist.id);
                useServerPlaylists.getState().load();
                useUi.getState().go({ view: 'playlists' });
              })}>Delete</button>
            )}
          </div>
          {note && <div className="ok small">{note}</div>}
        </div>
      </header>
      {error && <div className="errors">{error}</div>}
      {!tracks ? <Spinner /> : !tracks.length ? <Empty title="Empty playlist" /> : (
        <TrackList tracks={tracks} showAlbum showCover
          onRemove={editable ? (i) => guard(async () => {
            await src.removeFromPlaylist!(playlist.id, i, tracks);
            await reload();
            useServerPlaylists.getState().load();
          }) : undefined} />
      )}
    </div>
  );
}
