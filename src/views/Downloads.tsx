import { useEffect, useState } from 'react';
import { Deemix, searchDeezer, type DeezerResult } from '../sources/deemix';
import { ytdlp, type YtResult } from '../sources/ytdlp';
import { sourceFor } from '../sources/registry';
import { useSettings } from '../store/settings';
import { useCatalog } from '../store/catalog';
import { useDownloads } from '../store/downloads';
import { useUi } from '../store/ui';
import { Spinner, fmtTime } from '../components/common';
import { IconDownload, IconRefresh } from '../components/Icons';
import { isAndroid } from '../lib/platform';
import { BrowseBar, DeezerAlbum, DeezerArtist, DzRow, statusKey, type Browse, type SendStatus } from './DeezerBrowse';

type Tab = 'deezer' | 'ytdlp';

export function Downloads() {
  const sources = useSettings((s) => s.sources);
  const [tab, setTab] = useState<Tab>('deezer');
  const [q, setQ] = useState('');

  const rescan = async () => {
    await Promise.all(sources.filter((s) => s.enabled).map((cfg) => sourceFor(cfg).rescan?.().catch(() => {})));
    window.setTimeout(() => useCatalog.getState().load(), 8000);
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>Downloads</h1>
        <button className="btn" onClick={rescan} title="Ask Navidrome to rescan, then reload the catalog"><IconRefresh /> Rescan library</button>
      </header>
      <div className="tabs">
        <button className={tab === 'deezer' ? 'on' : ''} onClick={() => setTab('deezer')}>Deezer <small>via deemix</small></button>
        {!isAndroid && <button className={tab === 'ytdlp' ? 'on' : ''} onClick={() => setTab('ytdlp')}>YouTube &amp; more <small>via yt-dlp</small></button>}
      </div>
      <input className="search-big" autoFocus
        placeholder={tab === 'deezer' ? 'Search Deezer to download into your library…' : 'Search YouTube, or paste a YouTube / SoundCloud / Bandcamp URL…'}
        value={q} onChange={(e) => setQ(e.target.value)} />
      {tab === 'deezer' ? <DeezerTab q={q} onFallback={isAndroid ? undefined : () => setTab('ytdlp')} /> : <YtTab q={q} />}
    </div>
  );
}

function DeezerTab({ q, onFallback }: { q: string; onFallback?: () => void }) {
  const deemix = useSettings((s) => s.deemix);
  const [results, setResults] = useState<DeezerResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const [status, setStatus] = useState<Record<string, SendStatus>>({});
  const [queue, setQueue] = useState<any[]>([]);
  // artist/album pages opened from the results; a new search starts back at the results
  const [stack, setStack] = useState<Browse[]>([]);
  const open = (b: Browse) => setStack((st) => [...st, b]);
  useEffect(() => setStack([]), [q]);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    let alive = true;
    const h = window.setTimeout(async () => {
      setBusy(true);
      try {
        const r = await searchDeezer(q.trim());
        if (alive) setResults(r);
      } catch {
        if (alive) setResults([]);
      } finally {
        if (alive) {
          setBusy(false);
          setSearched(true);
        }
      }
    }, 400);
    return () => {
      alive = false;
      window.clearTimeout(h);
    };
  }, [q]);

  const refreshQueue = async () => {
    try {
      const r = await new Deemix(deemix.url, deemix.arl).getQueue();
      const order: string[] = r.queueOrder ?? Object.keys(r.queue ?? {});
      setQueue(order.map((id) => r.queue?.[id]).filter(Boolean).reverse());
    } catch {
      setQueue([]);
    }
  };
  useEffect(() => {
    if (!deemix.url) return;
    refreshQueue();
    const h = window.setInterval(refreshQueue, 5000);
    return () => window.clearInterval(h);
  }, [deemix.url]);

  const send = async (r: DeezerResult) => {
    const key = statusKey(r);
    setStatus((s) => ({ ...s, [key]: { s: 'sending' } }));
    try {
      await new Deemix(deemix.url, deemix.arl).addToQueue(r.link, deemix.bitrate);
      setStatus((s) => ({ ...s, [key]: { s: 'queued' } }));
      refreshQueue();
    } catch (e) {
      setStatus((s) => ({ ...s, [key]: { s: 'error', msg: String((e as Error).message ?? e) } }));
    }
  };

  const current = stack[stack.length - 1];
  const browse = { open, send, status };

  if (!deemix.url) return <p className="muted">Set your deemix server URL in Settings — or use the yt-dlp tab.</p>;

  return (
    <div className="dl-layout">
      {current ? (
        <div>
          <BrowseBar stack={stack} back={() => setStack((st) => st.slice(0, -1))} home={() => setStack([])} />
          {current.type === 'artist'
            ? <DeezerArtist key={current.id} id={current.id} {...browse} />
            : <DeezerAlbum key={current.id} id={current.id} {...browse} />}
        </div>
      ) : <div>
        {!searched && !busy && <p className="muted">Search for an artist, album or song. Open an artist to see their whole discography, or an album to pick single tracks.</p>}
        {busy && <Spinner />}
        {searched && onFallback && (
          <div className="fallback">
            {results.length ? 'Not the right one?' : 'Nothing on Deezer.'}{' '}
            <button className="link" onClick={onFallback}>Search with yt-dlp instead →</button>
          </div>
        )}
        {results.map((r) => <DzRow key={statusKey(r)} r={r} open={open} send={send} status={status} />)}
      </div>}
      <aside className="dl-queue">
        <h3>deemix queue</h3>
        {!queue.length && <p className="muted">Empty</p>}
        {queue.slice(0, 30).map((item: any) => (
          <div key={item.uuid} className="dl-item">
            <div className="track-title">{item.title}</div>
            <div className="track-sub">{item.artist}</div>
            <div className="progress"><i style={{ width: `${item.status === 'completed' ? 100 : Math.round(item.progress ?? 0)}%` }} /></div>
            <small className="muted">{item.status}{item.failed ? ` · ${item.failed} failed` : ''}</small>
          </div>
        ))}
      </aside>
    </div>
  );
}

function YtTab({ q }: { q: string }) {
  const settings = useSettings((s) => s.ytdlp);
  const { jobs, start, clearFinished } = useDownloads();
  const [results, setResults] = useState<YtResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    let alive = true;
    const h = window.setTimeout(async () => {
      setBusy(true);
      setError(undefined);
      try {
        const r = await ytdlp.search(q.trim(), settings.bin);
        if (alive) setResults(r);
      } catch (e) {
        if (alive) setError(String((e as Error).message ?? e));
      } finally {
        if (alive) setBusy(false);
      }
    }, 700);
    return () => {
      alive = false;
      window.clearTimeout(h);
    };
  }, [q]);

  const jobFor = (r: YtResult) => jobs.find((j) => j.url === r.url);

  return (
    <div className="dl-layout">
      <div>
        {!settings.outDir && (
          <div className="errors">
            Choose where yt-dlp saves files in <button className="link" onClick={() => useUi.getState().go({ view: 'settings' })}>Settings</button> — ideally your Navidrome music folder (e.g. a network share).
          </div>
        )}
        {busy && <Spinner />}
        {error && <div className="errors">{error}</div>}
        {results.map((r) => {
          const job = jobFor(r);
          return (
            <div key={r.id} className="station-row">
              <div className="yt-thumb">{r.thumbnail ? <img src={r.thumbnail} alt="" loading="lazy" /> : null}</div>
              <div className="track-main">
                <div className="track-title">{r.title}</div>
                <div className="track-sub">{r.channel}{r.duration ? ` · ${fmtTime(r.duration)}` : ''}</div>
              </div>
              <button className="btn" disabled={!!job && job.status !== 'error'} onClick={() => start(r)}>
                <IconDownload /> {job ? labelFor(job.status) : 'Get'}
              </button>
            </div>
          );
        })}
      </div>
      <aside className="dl-queue">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3>yt-dlp downloads</h3>
          {jobs.some((j) => j.status === 'done' || j.status === 'error') && <button className="link small" onClick={clearFinished}>Clear</button>}
        </div>
        {!jobs.length && <p className="muted">Nothing yet. Files are saved as Artist / Album / Title with cover art embedded.</p>}
        {jobs.map((j) => (
          <div key={j.jobId} className="dl-item">
            <div className="track-title">{j.title}</div>
            <div className="track-sub">{j.channel}</div>
            <div className="progress"><i style={{ width: `${j.status === 'done' ? 100 : Math.round(j.percent)}%` }} /></div>
            <small className={j.status === 'error' ? 'card-err' : 'muted'}>{j.status === 'error' ? j.message : labelFor(j.status)}</small>
          </div>
        ))}
      </aside>
    </div>
  );
}

function labelFor(s: string) {
  return { queued: 'Starting…', downloading: 'Downloading', processing: 'Converting', done: 'Done', error: 'Retry' }[s] ?? s;
}
