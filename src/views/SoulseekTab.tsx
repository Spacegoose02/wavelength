import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Spinner } from '../components/common';
import type { SlskdDownload, SlskdFolder } from '../sources/hub';
import { hubClient } from '../store/hub';
import { useUi } from '../store/ui';

/**
 * Downloads → Soulseek (hub/src/routes/slskd.ts): search through the Hub's slskd, pick a folder (usually an
 * album) from someone sharing it, and download it into the library. Opened from a request in the Inbox, the
 * download fills that request.
 */

const mb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`);
const errText = (e: unknown) => String((e as Error).message ?? e);

export function SoulseekTab({ initial = '', requestId }: { initial?: string; requestId?: number }) {
  const [q, setQ] = useState(initial);
  const [folders, setFolders] = useState<SlskdFolder[]>();
  const [searching, setSearching] = useState(false);
  const [msg, setMsg] = useState('');
  const [open, setOpen] = useState<string>();
  const [sent, setSent] = useState<Set<string>>(new Set());
  const run = useRef(0);

  const search = async (e?: FormEvent) => {
    e?.preventDefault();
    if (q.trim().length < 3) return;
    const me = ++run.current;
    setFolders(undefined);
    setMsg('');
    setSearching(true);
    try {
      const c = hubClient()!;
      const { id } = await c.slskdSearch(q.trim());
      // people answer over the next 10-20 seconds
      for (let i = 0; i < 20 && me === run.current; i++) {
        await new Promise((r) => setTimeout(r, i ? 1500 : 800));
        const r = await c.slskdResults(id);
        if (me !== run.current) return;
        setFolders(r.folders);
        if (r.done) break;
      }
    } catch (err) {
      if (me === run.current) setMsg(errText(err));
    } finally {
      if (me === run.current) setSearching(false);
    }
  };
  useEffect(() => {
    if (initial) search();
    return () => {
      run.current++;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const key = (f: SlskdFolder) => `${f.username}\u0000${f.folder}`;
  const get = async (f: SlskdFolder) => {
    setMsg('');
    try {
      const c = hubClient()!;
      if (requestId) {
        await c.approveRequest(requestId, undefined, { username: f.username, files: f.files });
        setMsg(`Downloading ${f.name} for the request. The Inbox shows it ready once it's in your library`);
      } else {
        await c.slskdDownload(f);
        setMsg(`Downloading ${f.name} from ${f.username}`);
      }
      setSent((s) => new Set(s).add(key(f)));
    } catch (err) {
      setMsg(errText(err));
    }
  };

  return (
    <>
      {requestId && (
        <p className="muted small">
          Pick a folder for the request. <button className="link" onClick={() => useUi.getState().go({ view: 'inbox' })}>Back to the Inbox</button>
        </p>
      )}
      <form className="row gap" style={{ marginBottom: 12 }} onSubmit={search}>
        <input className="search-big" autoFocus placeholder="Search Soulseek: artist and album…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn primary" disabled={q.trim().length < 3}>Search</button>
      </form>
      {msg && <p className="small">{msg}</p>}
      {searching && <p className="muted small"><Spinner /> Asking the network… results keep coming in for a few seconds.</p>}
      {folders && !folders.length && !searching && <p className="muted">Nobody shares anything matching that right now. Try fewer words.</p>}
      {folders && folders.length > 0 && (
        <div className="tracklist">
          {folders.map((f) => (
            <div key={key(f)} className="slskd-folder">
              <div className="source-row">
                <div className="track-main" onClick={() => setOpen(open === key(f) ? undefined : key(f))} role="button" tabIndex={0}>
                  <div className="track-title">{f.name}</div>
                  <div className="track-sub">
                    {f.files.length} song{f.files.length === 1 ? '' : 's'} · {f.format}{f.bitRate && !f.lossless ? ` ${f.bitRate} kbps` : ''} · {mb(f.size)} · {f.username}
                    {' · '}{f.freeSlot ? <span className="ok">free slot</span> : <span className="muted">{f.queue} waiting</span>}
                  </div>
                </div>
                <button className="btn small primary" disabled={sent.has(key(f))} onClick={() => get(f)}>{sent.has(key(f)) ? 'Sent' : requestId ? 'Use this' : 'Download'}</button>
              </div>
              {open === key(f) && <ol className="slskd-files">{f.files.map((x) => <li key={x.filename}>{x.name} <span className="muted small">{mb(x.size)}</span></li>)}</ol>}
            </div>
          ))}
        </div>
      )}
      <SlskdQueue />
    </>
  );
}

/** What slskd is downloading, refreshed while it's on screen. */
function SlskdQueue() {
  const [list, setList] = useState<SlskdDownload[]>();
  useEffect(() => {
    let alive = true;
    const load = () => hubClient()?.slskdDownloads().then((r) => alive && setList(r.downloads), () => undefined);
    load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  if (!list?.length) return null;
  return (
    <section>
      <h2>In slskd</h2>
      {list.map((d) => (
        <div key={`${d.username}:${d.folder}`} className="source-row">
          <div className="track-main">
            <div className="track-title">{d.name || d.folder}</div>
            <div className="track-sub">{d.username} · {d.done}/{d.files} songs · {d.state}</div>
          </div>
          <span className="progress thin" style={{ width: 120 }}><i style={{ width: `${d.progress}%` }} /></span>
        </div>
      ))}
    </section>
  );
}
