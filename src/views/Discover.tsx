import { useEffect, useRef, useState } from 'react';
import { deemixClient, useHubRuns } from '../lib/hubServices';
import { findTrackOnSource, pool, primaryArtist } from '../lib/match';
import { CHART_COLORS, CHART_LABELS, CHART_SHORT, GENRES, deezerLookup, getChart, getMix, sourcesFor, type ChartEntry, type ChartSource, type Genre } from '../sources/charts';
import { sourceFor } from '../sources/registry';
import type { Track } from '../sources/types';
import { useDownloads, ytSearch } from '../store/downloads';
import { useLibrary } from '../store/library';
import { usePlayer } from '../store/player';
import { enabledSources, useSettings } from '../store/settings';
import { useUi } from '../store/ui';
import { useHub } from '../store/hub';
import { Cover, Spinner } from '../components/common';
import { IconDownload, IconPause, IconPlay, IconRefresh } from '../components/Icons';
import { AddToPlaylist } from '../components/AddToPlaylist';
import { QueueAllOnSubwave, QueueOnSubwave } from '../components/TrackButtons';
import { isAndroid } from '../lib/platform';
import { ReleaseRadar } from '../components/ReleaseRadar';

type View = 'mix' | ChartSource;
type Row = ChartEntry & {
  lib?: Track | null;
  dl?: { state: 'sending' | 'queued' | 'error'; via?: string; msg?: string; notOnDeezer?: boolean };
  /** false = looked it up, Deezer has no clip */
  hasPreview?: boolean;
};

async function deezerLinkFor(e: ChartEntry): Promise<string | undefined> {
  return e.deezerLink ?? (await deezerLookup(e)).link;
}

/** A 30s preview as a playable (unsaveable) track. */
function previewTrack(r: ChartEntry, url: string): Track {
  return { id: `preview:${url}`, sourceId: 'preview', kind: 'track', title: r.title, artist: r.artist, album: '30-second preview', coverUrl: r.cover, streamUrl: url, duration: 30 };
}

export function Discover() {
  const [genre, setGenre] = useState<Genre>('all');
  const [view, setView] = useState<View>('mix');
  const [rows, setRows] = useState<Row[]>();
  const [error, setError] = useState<string>();
  const [info, setInfo] = useState<string>();
  const [checked, setChecked] = useState(0);
  const custom = useSettings((s) => s.discoverCharts);
  const available = sourcesFor(genre, custom);
  // switching genre can remove the current tab (e.g. Billboard has no current rap chart)
  useEffect(() => {
    if (view !== 'mix' && !available.includes(view)) setView('mix');
  }, [genre, available.join()]);
  const [nonce, setNonce] = useState(0);
  const deemix = useSettings((s) => s.deemix);
  const yt = useSettings((s) => s.ytdlp);
  const playTracks = usePlayer((s) => s.playTracks);
  const run = useRef(0);

  // load the chart, then check each song against the library in the background
  useEffect(() => {
    const id = ++run.current;
    setRows(undefined);
    setError(undefined);
    setInfo(undefined);
    setChecked(0);
    (async () => {
      try {
        let entries: ChartEntry[];
        if (view === 'mix') {
          const m = await getMix(genre, available);
          entries = m.entries;
          setInfo(`Combining ${m.used.map((s) => CHART_LABELS[s]).join(' + ')}`);
          if (!m.used.length) throw new Error(m.failed.map((f) => f.reason).join(' · ') || "Couldn't reach any chart service.");
          if (m.failed.length) setError(`Skipped: ${m.failed.map((f) => f.reason).join(' · ')}`);
        } else {
          const c = await getChart(view, genre);
          entries = c.entries;
          setInfo(c.asOf ? `${CHART_LABELS[view]} · ${c.asOf}` : CHART_LABELS[view]);
          if (!entries.length) throw new Error(`${CHART_LABELS[view]} has no ${GENRES.find((g) => g.id === genre)!.label} songs right now.`);
        }
        if (id !== run.current) return;
        setRows(entries);
        const libs = enabledSources().filter((s) => s.kind === 'navidrome' || s.kind === 'plex').map(sourceFor);
        let done = 0;
        await pool(entries, 4, async (e, i) => {
          let hit: Track | undefined;
          for (const src of libs) if (!hit) hit = await findTrackOnSource(src, e).catch(() => undefined);
          if (id !== run.current) return;
          setRows((rs) => rs?.map((r, j) => (j === i ? { ...r, lib: hit ?? null } : r)));
          setChecked(++done);
        });
      } catch (e) {
        if (id === run.current) setError(String((e as Error).message ?? e));
      }
    })();
  }, [genre, view, nonce, available.join()]);

  const patch = (i: number, p: Partial<Row>) => setRows((rs) => rs?.map((r, j) => (j === i ? { ...r, ...p } : r)));

  const hubYt = useHubRuns('ytdlp');
  const ytAvailable = hubYt || (!isAndroid && !!yt.outDir);
  const nowPlayingId = usePlayer((s) => s.queue[s.index]?.id);
  const playing = usePlayer((s) => s.playing);

  /** Play (or stop) the 30s Deezer clip for a song you don't own yet. */
  const preview = async (i: number) => {
    const r = rows![i];
    const url = r.preview ?? (await deezerLookup(r)).preview;
    if (!url) return patch(i, { hasPreview: false });
    patch(i, { preview: url, hasPreview: true });
    if (nowPlayingId === `preview:${url}`) return usePlayer.getState().toggle();
    playTracks([previewTrack(r, url)]);
  };

  const viaYtdlp = async (i: number) => {
    const e = rows![i];
    patch(i, { dl: { state: 'sending' } });
    try {
      const [hit] = await ytSearch(`${primaryArtist(e.artist)} - ${e.title} audio`);
      if (!hit) throw new Error('No YouTube match');
      useDownloads.getState().start(hit);
      patch(i, { dl: { state: 'queued', via: 'yt-dlp' } });
    } catch (err) {
      patch(i, { dl: { state: 'error', msg: String((err as Error).message ?? err) } });
    }
  };

  /**
   * deemix is the downloader. yt-dlp is only a backup for songs Deezer doesn't have — a deemix
   * *failure* (not logged in, unreachable) is shown, not silently swapped for yt-dlp.
   */
  const get = async (i: number) => {
    const e = rows![i];
    if (!deemix.url) {
      if (ytAvailable) return viaYtdlp(i);
      return patch(i, { dl: { state: 'error', msg: useHub.getState().token && !useHub.getState().permissions.includes('downloads.run') ? 'Ask your Hub admin for Autodownload' : 'Set your deemix URL in Settings' } });
    }
    patch(i, { dl: { state: 'sending' } });
    const link = await deezerLinkFor(e);
    if (!link) {
      if (ytAvailable) return viaYtdlp(i);
      return patch(i, { dl: { state: 'error', msg: 'Not on Deezer', notOnDeezer: true } });
    }
    try {
      await deemixClient().addToQueue(link, deemix.bitrate);
      patch(i, { dl: { state: 'queued', via: 'deemix' } });
    } catch (err) {
      patch(i, { dl: { state: 'error', msg: String((err as Error).message ?? err) } });
    }
  };

  const owned = (rows ?? []).filter((r) => r.lib).map((r) => r.lib!) as Track[];
  const missing = (rows ?? []).map((r, i) => ({ r, i })).filter(({ r }) => r.lib === null && !r.dl);
  const total = rows?.length ?? 0;
  const label = `${view === 'mix' ? 'Mix' : CHART_LABELS[view]} · ${GENRES.find((g) => g.id === genre)!.label}`;

  return (
    <div className="page">
      <header className="page-head">
        <h1>Discover</h1>
        <button className="btn small" onClick={() => setNonce(nonce + 1)}><IconRefresh /> Refresh</button>
        <button className="btn small ghost" onClick={() => {
          useUi.getState().go({ view: 'settings', tab: 'discover' });
        }} title="Pick which charts each genre uses">Edit charts</button>
      </header>
      <div className="chips">
        {GENRES.map((g) => <button key={g.id} className={`chip ${genre === g.id ? 'on' : ''}`} onClick={() => setGenre(g.id)}>{g.label}</button>)}
      </div>
      <div className="tabs">
        <button className={view === 'mix' ? 'on' : ''} onClick={() => setView('mix')}>Mix <small>all charts combined</small></button>
        {available.map((s) => (
          <button key={s} className={view === s ? 'on' : ''} onClick={() => setView(s)}>{CHART_LABELS[s]}</button>
        ))}
      </div>

      {genre === 'new' && <ReleaseRadar />}
      {genre === 'new' && <h2 className="mt">Editors' new music</h2>}
      {info && <div className="muted small chart-info">{info}</div>}
      {error && <div className="errors">{error}</div>}
      {rows && (
        <div className="discover-bar">
          <span className="muted small">
            {checked < total ? <>Checking your library… {checked}/{total}</> : <>{owned.length} of {total} already in your library</>}
          </span>
          <button className="btn small primary" disabled={!owned.length} onClick={() => playTracks(owned)}><IconPlay /> Play what I have</button>
          <AddToPlaylist tracks={() => owned} label="Save owned as playlist" className="btn small" />
          {owned.length > 0 && <QueueAllOnSubwave tracks={() => owned} className="btn small" />}
          <button className="btn small" disabled={!missing.length || checked < total} onClick={async () => {
            if (!confirm(`Send ${missing.length} missing songs to ${deemix.url ? 'deemix' : 'yt-dlp'}?`)) return;
            for (const { i } of missing) await get(i);
          }}><IconDownload /> Get all missing ({missing.length})</button>
          <button className="btn small ghost" disabled={!owned.length} onClick={() => {
            const id = useLibrary.getState().createPlaylist(`${label} — ${new Date().toLocaleDateString()}`, owned);
            useUi.getState().go({ view: 'playlist', id });
          }}>New playlist from chart</button>
        </div>
      )}

      {!rows ? <Spinner /> : (
        <div className="tracklist">
          {rows.map((r, i) => (
            <div key={`${i}:${r.title}`} className={`track-row chart-row ${r.lib ? 'owned' : ''}`} onDoubleClick={() => r.lib && playTracks([r.lib])}>
              <div className="chart-rank">{r.rank}</div>
              <Cover src={r.cover ?? r.lib?.coverUrl} alt={r.title} className="tiny" />
              <div className="track-main">
                <div className="track-title">{r.title}</div>
                <div className="track-sub">{r.artist}</div>
              </div>
              {view === 'mix' && (
                <div className="chart-badges">
                  {r.sources.map((s) => (
                    <span key={s.source} title={`#${s.rank} on ${CHART_LABELS[s.source]}`} style={{ background: CHART_COLORS[s.source] }}>
                      {CHART_SHORT[s.source]}{s.rank}
                    </span>
                  ))}
                </div>
              )}
              {r.lib === null && (
                <button className={`icon-btn preview-btn ${r.preview && nowPlayingId === `preview:${r.preview}` ? 'on' : ''}`}
                  disabled={r.hasPreview === false}
                  title={r.hasPreview === false ? 'No preview available' : 'Play a 30-second preview'}
                  onClick={(e) => { e.stopPropagation(); preview(i); }}>
                  {r.preview && nowPlayingId === `preview:${r.preview}` && playing ? <IconPause /> : <IconPlay />}
                </button>
              )}
              <div className="chart-action">
                {r.lib === undefined ? <span className="muted small">checking…</span>
                  : r.lib ? (
                    <>
                      <QueueOnSubwave track={r.lib} />
                      <AddToPlaylist tracks={[r.lib]} />
                      <button className="btn small primary" onClick={() => playTracks([r.lib!])}><IconPlay /> Play</button>
                    </>
                  ) : r.dl?.state === 'queued' ? <span className="ok small">Queued via {r.dl.via}</span>
                  : r.dl?.state === 'error' ? (
                    <div className="dl-err">
                      <span className="card-err" title={r.dl.msg}>{r.dl.msg}</span>
                      {!r.dl.notOnDeezer && <button className="btn small" onClick={() => get(i)}>Retry deemix</button>}
                      {ytAvailable && <button className="btn small ghost" onClick={() => viaYtdlp(i)}>Use yt-dlp</button>}
                    </div>
                  )
                  : <button className="btn small" disabled={r.dl?.state === 'sending'} onClick={() => get(i)}><IconDownload /> {r.dl?.state === 'sending' ? '…' : 'Get'}</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
