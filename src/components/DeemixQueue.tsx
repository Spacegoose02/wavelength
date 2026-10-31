import { useState } from 'react';
import { cancelClean, cancelDownload, clearFinished, describe, retryDownload, summary, useDeemixQueue, useFollowDeemix, type DeemixItem } from '../lib/deemixQueue';
import type { HubCleanJob } from '../sources/hub';
import { useUi } from '../store/ui';

/**
 * Downloads → deemix queue: every download deemix has, with its place in line, songs done and failed (and why
 * each failed), a warning when deemix has stopped moving, Cancel and Retry; and the clean versions the Hub is
 * holding until deemix is free (docs/USER-GUIDE.md "Following downloads").
 */
export function DeemixQueuePanel() {
  useFollowDeemix();
  const { items, clean, read, error } = useDeemixQueue();
  const [busy, setBusy] = useState<string>();
  const [fail, setFail] = useState<string>();
  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setFail(undefined);
    try {
      await fn();
    } catch (e) {
      setFail(String((e as Error).message ?? e));
    } finally {
      setBusy(undefined);
    }
  };
  const waiting = clean.filter((j) => j.state === 'waiting');
  const s = summary(items, clean);
  // what's happening first, then what's waiting, then what's finished
  const rank = (i: DeemixItem) => (i.stalled ? 0 : i.status === 'downloading' ? 1 : i.status === 'inQueue' ? 2 : i.status === 'failed' || i.status === 'withErrors' ? 3 : 4);
  const sorted = [...items].sort((a, b) => rank(a) - rank(b) || (a.position ?? 0) - (b.position ?? 0));

  return (
    <aside className="dl-queue">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3>deemix queue</h3>
        {s.done + s.failed > 0 && <button className="link small" disabled={!!busy} onClick={() => act('clear', clearFinished)} title="Take finished and failed downloads off deemix's list">Clear finished</button>}
      </div>
      {read && <p className="muted small">{[s.downloading && `${s.downloading} downloading`, s.waiting && `${s.waiting} waiting`, s.failed && `${s.failed} with problems`, s.done && `${s.done} done`].filter(Boolean).join(' · ') || 'Nothing in the queue'}</p>}
      {s.stuck && <div className="errors small">deemix has stopped moving. Cancel the stuck download below (or restart deemix) and the rest carry on.</div>}
      {error && <div className="card-err">{error}</div>}
      {fail && <div className="card-err">{fail}</div>}
      {waiting.map((j) => <CleanRow key={j.link} j={j} busy={busy === j.link} cancel={() => act(j.link, () => cancelClean(j.link))} />)}
      {sorted.slice(0, 50).map((i) => (
        <ItemRow key={i.uuid} i={i} busy={busy === i.uuid}
          cancel={() => act(i.uuid, () => cancelDownload(i))}
          retry={() => act(i.uuid, () => retryDownload(i))} />
      ))}
      {items.length > 50 && <p className="muted small">…and {items.length - 50} more</p>}
    </aside>
  );
}

function ItemRow({ i, busy, cancel, retry }: { i: DeemixItem; busy: boolean; cancel: () => void; retry: () => void }) {
  const [open, setOpen] = useState(false);
  const bad = i.status === 'failed' || i.status === 'withErrors';
  const live = i.status === 'downloading' || i.status === 'inQueue';
  const pct = i.size > 1 && i.status === 'downloading' ? Math.round(((i.downloaded + i.failed) / i.size) * 100) : Math.round(i.progress);
  return (
    <div className={`dl-item ${i.stalled ? 'dl-stuck' : ''}`}>
      <div className="track-title">{i.title || i.uuid}</div>
      <div className="track-sub">{i.artist}{i.type && i.type !== 'album' ? ` · ${i.type}` : ''}</div>
      {i.status !== 'inQueue' && <div className="progress"><i style={{ width: `${i.status === 'completed' ? 100 : pct}%` }} /></div>}
      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <small className={i.stalled || bad ? 'card-err' : 'muted'}>{describe(i)}</small>
        <span className="row gap">
          {i.errors.length > 0 && <button className="link small" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Why?'}</button>}
          {(bad || i.stalled) && <button className="link small" disabled={busy} onClick={retry}>Retry</button>}
          {live && <button className="link small" disabled={busy} onClick={cancel}>Cancel</button>}
        </span>
      </div>
      {open && (
        <ul className="dl-errors small">
          {i.errors.map((e, n) => <li key={n}><b>{e.title || 'Song'}</b>{e.artist ? ` (${e.artist})` : ''}: {e.message}</li>)}
        </ul>
      )}
    </div>
  );
}

function CleanRow({ j, busy, cancel }: { j: HubCleanJob; busy: boolean; cancel: () => void }) {
  const id = /album\/(\d+)/.exec(j.link)?.[1];
  return (
    <div className={`dl-item ${j.stuck ? 'dl-stuck' : ''}`}>
      <div className="track-title"><a href={j.link} target="_blank" rel="noreferrer">Clean version{id ? ` (album ${id})` : ''}</a></div>
      <div className="track-sub">Held by your Hub until deemix is free{j.position ? ` · ${j.position} in line` : ''}</div>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <small className={j.stuck ? 'card-err' : 'muted'}>{j.detail ?? 'Waiting for deemix'}</small>
        {!j.starting && <button className="link small" disabled={busy} onClick={cancel}>Cancel</button>}
      </div>
    </div>
  );
}

/** A one-line "deemix: 1 downloading · 3 waiting" that opens Downloads, for pages that send things to deemix. */
export function DeemixActivity() {
  useFollowDeemix();
  const { items, clean, read } = useDeemixQueue();
  const s = summary(items, clean);
  if (!read || (!s.downloading && !s.waiting && !s.stuck)) return null;
  return (
    <button className={`link small ${s.stuck ? 'card-err' : ''}`} onClick={() => useUi.getState().go({ view: 'downloads' })} title="See deemix's queue under Downloads">
      deemix: {[s.downloading && `${s.downloading} downloading`, s.waiting && `${s.waiting} waiting`].filter(Boolean).join(' · ')}{s.stuck ? ' · stuck' : ''} →
    </button>
  );
}
