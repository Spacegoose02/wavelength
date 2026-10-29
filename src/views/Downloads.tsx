import { useEffect, useState } from 'react';
import { deemixClient, useHubRuns } from '../lib/hubServices';
import { REQUEST_STATUS, requestMusic, useMustRequest } from '../lib/inbox';
import type { HubRequest } from '../sources/hub';
import { hubClient } from '../store/hub';
import { searchDeezer, type DeezerResult } from '../sources/deemix';
import type { YtResult } from '../sources/ytdlp';
import { sourceFor } from '../sources/registry';
import { useSettings } from '../store/settings';
import { useCatalog } from '../store/catalog';
import { refreshHub, useDownloads, watchHub, ytSearch } from '../store/downloads';
import { useUi } from '../store/ui';
import { useCan } from '../store/hub';
import { Spinner, fmtTime } from '../components/common';
import { IconDownload, IconRefresh } from '../components/Icons';
import { isAndroid } from '../lib/platform';
import { BrowseBar, DeezerAlbum, DeezerArtist, DeezerPlaylist, DzRow, statusKey, type Browse, type SendStatus } from './DeezerBrowse';

type Tab = 'deezer' | 'ytdlp';

export function Downloads() {
  const sources = useSettings((s) => s.sources);
  const [tab, setTab] = useState<Tab>('deezer');
  const [q, setQ] = useState('');
  // signed in to a Hub: only admins and people with Autodownload get the download logins
  const canDownload = useCan('downloads.run');
  // no Autodownload: search the same way, but each Get becomes a request the admin approves
  const ask = useMustRequest();
  // the Hub runs yt-dlp for every device, Android included; otherwise it needs the desktop app
  const hubYt = useHubRuns('ytdlp');
  const ytHere = hubYt || !isAndroid;

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
      {ask ? <>
        <p className="muted">Your Hub admin looks after downloads, so <b>Request</b> sends them what you'd like. You'll see their answer in your <button className="link" onClick={() => useUi.getState().go({ view: 'inbox' })}>Inbox</button>.</p>
        <input className="search-big" autoFocus placeholder="Search Deezer for music to request…" value={q} onChange={(e) => setQ(e.target.value)} />
        <DeezerTab q={q} request />
      </> : !canDownload ? <p className="muted">Your Hub admin looks after downloads. Ask them to turn on <b>Autodownload</b> for you to download music yourself.</p> : <>
      <div className="tabs">
        <button className={tab === 'deezer' ? 'on' : ''} onClick={() => setTab('deezer')}>Deezer <small>via deemix</small></button>
        {ytHere && <button className={tab === 'ytdlp' ? 'on' : ''} onClick={() => setTab('ytdlp')}>YouTube &amp; more <small>via yt-dlp</small></button>}
      </div>
      <input className="search-big" autoFocus
        placeholder={tab === 'deezer' ? 'Search Deezer to download into your library…' : 'Search YouTube, or paste a YouTube / SoundCloud / Bandcamp URL…'}
        value={q} onChange={(e) => setQ(e.target.value)} />
      {tab === 'deezer' ? <DeezerTab q={q} onFallback={ytHere ? () => setTab('ytdlp') : undefined} /> : <YtTab q={q} />}
      </>}
    </div>
  );
}

function DeezerTab({ q, onFallback, request }: { q: string; onFallback?: () => void; request?: boolean }) {
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
      const r = await deemixClient().getQueue();
      const order: string[] = r.queueOrder ?? Object.keys(r.queue ?? {});
      setQueue(order.map((id) => r.queue?.[id]).filter(Boolean).reverse());
    } catch {
      setQueue([]);
    }
  };
  useEffect(() => {
    if (!deemix.url || request) return;
    refreshQueue();
    const h = window.setInterval(refreshQueue, 5000);
    return () => window.clearInterval(h);
  }, [deemix.url]);

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
      refreshQueue();
    } catch (e) {
      setStatus((s) => ({ ...s, [key]: { s: 'error', msg: String((e as Error).message ?? e) } }));
    }
  };

  const current = stack[stack.length - 1];
  const browse = { open, send, status };

  if (!deemix.url && !request) return <p className="muted">Set your deemix server URL in Settings — or use the yt-dlp tab.</p>;

  return (
    <div className="dl-layout">
      {current ? (
        <div>
          <BrowseBar stack={stack} back={() => setStack((st) => st.slice(0, -1))} home={() => setStack([])} />
          {current.type === 'artist'
            ? <DeezerArtist key={current.id} id={current.id} {...browse} />
            : current.type === 'album'
            ? <DeezerAlbum key={current.id} id={current.id} {...browse} />
            : <DeezerPlaylist key={current.id} id={current.id} {...browse} />}
        </div>
      ) : <div>
        {!searched && !busy && <p className="muted">Search for an artist, album, playlist or song. Open an artist to see their whole discography, or an album or playlist to pick single tracks.</p>}
        {busy && <Spinner />}
        {request && <RequestLink />}
        {searched && onFallback && (
          <div className="fallback">
            {results.length ? 'Not the right one?' : 'Nothing on Deezer.'}{' '}
            <button className="link" onClick={onFallback}>Search with yt-dlp instead →</button>
          </div>
        )}
        {results.map((r) => <DzRow key={statusKey(r)} r={r} open={open} send={send} status={status} />)}
      </div>}
      {request ? <MyRequestsAside /> : <aside className="dl-queue">
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
      </aside>}
    </div>
  );
}

function YtTab({ q }: { q: string }) {
  const settings = useSettings((s) => s.ytdlp);
  const hubYt = useHubRuns('ytdlp');
  const { jobs, start, clearFinished } = useDownloads();
  // show downloads already running on the Hub (from any device)
  useEffect(() => {
    if (hubYt) refreshHub().then((busy) => busy && watchHub()).catch(() => undefined);
  }, [hubYt]);
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
        const r = await ytSearch(q.trim());
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
        {!hubYt && !settings.outDir && (
          <div className="errors">
            Choose where yt-dlp saves files in <button className="link" onClick={() => useUi.getState().go({ view: 'settings', tab: 'downloads' })}>Settings</button> — ideally your Navidrome music folder (e.g. a network share).
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
        {!jobs.length && <p className="muted">Nothing yet. Files are saved as Artist / Album / Title with cover art embedded{hubYt ? ', by your Hub, straight into the music folder' : ''}.</p>}
        {jobs.map((j) => (
          <div key={j.jobId} className="dl-item">
            <div className="track-title">{j.title}</div>
            <div className="track-sub">{j.channel}{j.username ? ` · ${j.username}` : ''}</div>
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

/** Not on Deezer? Request a YouTube, SoundCloud or Bandcamp link instead. */
function RequestLink() {
  const [link, setLink] = useState('');
  const [title, setTitle] = useState('');
  const [msg, setMsg] = useState<string>();
  return (
    <form className="request-link" onSubmit={async (e) => {
      e.preventDefault();
      setMsg('…');
      try {
        await requestMusic({ link: link.trim(), kind: '', title: title.trim() || link.trim(), artist: '' });
        setLink('');
        setTitle('');
        setMsg('Requested');
      } catch (err) {
        setMsg(String((err as Error).message ?? err));
      }
    }}>
      <small className="muted">Not on Deezer? Paste a YouTube, SoundCloud or Bandcamp link:</small>
      <div className="row gap">
        <input placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)} />
        <input placeholder="What is it? (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
        <button className="btn small" disabled={!/^https?:\/\/\S+$/i.test(link.trim())}>Request</button>
      </div>
      {msg && <small className="muted">{msg}</small>}
    </form>
  );
}

function MyRequestsAside() {
  const [list, setList] = useState<HubRequest[]>();
  useEffect(() => {
    const load = () => hubClient()?.myRequests().then((r) => setList(r.requests)).catch(() => setList([]));
    load();
    const h = window.setInterval(load, 10000);
    return () => window.clearInterval(h);
  }, []);
  return (
    <aside className="dl-queue">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3>Your requests</h3>
        <button className="link small" onClick={() => useUi.getState().go({ view: 'inbox' })}>All</button>
      </div>
      {list && !list.length && <p className="muted">Nothing yet. Press Request on anything you'd like in the library.</p>}
      {list?.slice(0, 20).map((r) => (
        <div key={r.id} className="dl-item">
          <div className="track-title">{r.title}</div>
          <div className="track-sub">{r.artist}</div>
          <small className={`req-status ${r.status}`}>{REQUEST_STATUS[r.status]}{r.reason ? ` · ${r.reason}` : ''}</small>
        </div>
      ))}
    </aside>
  );
}
