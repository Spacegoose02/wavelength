import { useRef, useState } from 'react';
import { getSong, NotOnDeezer } from '../lib/getSong';
import { useMustRequest } from '../lib/inbox';
import { useHidden } from '../lib/kids';
import { findInLibrary, pool } from '../lib/match';
import { fromLink, parseFile, type Imported, type ImportedSong } from '../lib/playlistImport';
import type { Track } from '../sources/types';
import { useHub } from '../store/hub';
import { useLibrary } from '../store/library';
import { useUi } from '../store/ui';
import { Cover, Spinner } from '../components/common';
import { IconDownload } from '../components/Icons';

type Row = ImportedSong & {
  lib?: Track | null;
  dl?: { state: 'sending' | 'queued' | 'error'; via?: string; msg?: string };
};

/**
 * Import a playlist from Deezer, Spotify, YouTube Music or a file (lib/playlistImport.ts): match each song to
 * the library, save the ones found as a Wavelength playlist, and request or download the rest.
 */
export function ImportPlaylist() {
  const [link, setLink] = useState('');
  const [name, setName] = useState('');
  const [rows, setRows] = useState<Row[]>();
  const [checked, setChecked] = useState(0);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const run = useRef(0);
  const ask = useMustRequest();
  const canGet = useHub((s) => !s.token || s.permissions.includes('downloads.run') || s.permissions.includes('requests.create'));
  const hidden = useHidden();

  const start = async (load: () => Promise<Imported>) => {
    const id = ++run.current;
    setError(undefined);
    setRows(undefined);
    setChecked(0);
    setLoading(true);
    try {
      const got = await load();
      if (id !== run.current) return;
      if (!got.songs.length) throw new Error('No songs found in that. A CSV needs title and artist columns; a text file, one "Artist - Title" per line');
      setName(got.name);
      setRows(got.songs);
      const find = findInLibrary();
      let done = 0;
      await pool(got.songs, 4, async (s, i) => {
        const hit = await find(s);
        if (id !== run.current) return;
        setRows((rs) => rs?.map((r, j) => (j === i ? { ...r, lib: hit ?? null } : r)));
        setChecked(++done);
      });
    } catch (e) {
      if (id === run.current) setError(String((e as Error).message ?? e));
    } finally {
      if (id === run.current) setLoading(false);
    }
  };

  const patch = (i: number, p: Partial<Row>) => setRows((rs) => rs?.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const get = async (i: number) => {
    patch(i, { dl: { state: 'sending' } });
    try {
      patch(i, { dl: { state: 'queued', via: await getSong(rows![i]) } });
    } catch (e) {
      patch(i, { dl: { state: 'error', msg: e instanceof NotOnDeezer ? 'Not on Deezer' : String((e as Error).message ?? e) } });
    }
  };

  const visible = (rows ?? []).map((r, i) => ({ r, i })).filter(({ r }) => !hidden.track({ kind: 'track', id: '', sourceId: '', title: r.title, artist: r.artist, explicit: r.lib?.explicit }));
  const owned = visible.filter(({ r }) => r.lib).map(({ r }) => r.lib!);
  const missing = visible.filter(({ r }) => r.lib === null && !r.dl);
  const total = rows?.length ?? 0;
  const matching = !!rows && checked < total;

  return (
    <div className="page">
      <header className="page-head">
        <h1>Import a playlist</h1>
      </header>
      <p className="muted small">
        Paste a Deezer, Spotify or YouTube Music playlist link, or choose a CSV, M3U or text file (one “Artist - Title” per line).
        Spotify links read public playlists, up to about 100 songs; for longer ones export a CSV with exportify.app.
      </p>
      <form className="inline-form" onSubmit={(e) => { e.preventDefault(); if (link.trim()) start(() => fromLink(link)); }}>
        <input className="wide" placeholder="https://open.spotify.com/playlist/…" value={link} onChange={(e) => setLink(e.target.value)} aria-label="Playlist link" />
        <button className="btn primary" disabled={loading || !link.trim()}>Import link</button>
        <label className="btn">
          Choose file
          <input type="file" accept=".csv,.tsv,.m3u,.m3u8,.txt" hidden onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) start(async () => parseFile(f.name, await f.text()));
          }} />
        </label>
      </form>
      {error && <div className="errors">{error}</div>}
      {loading && !rows && <Spinner />}

      {rows && (
        <>
          <div className="discover-bar">
            <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Playlist name" />
            <span className="muted small">{matching ? <>Finding songs in your library… {checked}/{total}</> : <>{owned.length} of {visible.length} in your library</>}</span>
            <button className="btn small primary" disabled={matching || !owned.length} onClick={() => {
              const id = useLibrary.getState().createPlaylist(name || 'Imported playlist', owned);
              useUi.getState().go({ view: 'playlist', id });
            }}>Save playlist ({owned.length})</button>
            {canGet && (
              <button className="btn small" disabled={matching || !missing.length} onClick={async () => {
                if (!confirm(ask ? `Request ${missing.length} missing songs from your Hub admin?` : `Get ${missing.length} missing songs?`)) return;
                for (const { i } of missing) await get(i);
              }}><IconDownload /> {ask ? 'Request' : 'Get'} missing ({missing.length})</button>
            )}
          </div>
          <div className="tracklist">
            {visible.map(({ r, i }) => (
              <div key={i} className={`track-row chart-row ${r.lib ? 'owned' : ''}`}>
                <div className="chart-rank">{i + 1}</div>
                <Cover src={r.cover ?? r.lib?.coverUrl} alt={r.title} className="tiny" />
                <div className="track-main">
                  <div className="track-title">{r.title}</div>
                  <div className="track-sub">{r.artist}{r.album ? ` · ${r.album}` : ''}</div>
                </div>
                <div className="chart-action">
                  {r.lib === undefined ? <span className="muted small">checking…</span>
                    : r.lib ? <span className="ok small">In your library</span>
                    : r.dl?.state === 'queued' ? <span className="ok small">{r.dl.via === 'request' ? 'Requested' : `Queued via ${r.dl.via}`}</span>
                    : r.dl?.state === 'error' ? <span className="card-err" title={r.dl.msg}>{r.dl.msg}</span>
                    : canGet ? <button className="btn small" disabled={r.dl?.state === 'sending'} onClick={() => get(i)}><IconDownload /> {r.dl?.state === 'sending' ? '…' : ask ? 'Request' : 'Get'}</button>
                    : <span className="muted small">Not in your library</span>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
