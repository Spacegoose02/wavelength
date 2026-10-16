import { useEffect, useState, type ReactNode } from 'react';
import { list, swTrack, type SubWaveSource, type SwTrack } from '../sources/subwave';
import { Cover, fmtTime, timeAgo } from '../components/common';

/** Poll a SubWave endpoint while the page is open. */
export function usePoll<T>(fn: () => Promise<T>, ms: number, deps: unknown[] = []) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    const run = () =>
      fn()
        .then((d) => alive && (setData(d), setError(undefined)))
        .catch((e) => alive && setError(String(e.message ?? e)));
    run();
    const h = window.setInterval(run, ms);
    return () => {
      alive = false;
      window.clearInterval(h);
    };
  }, [...deps, nonce]);
  return { data, error, refresh: () => setNonce((n) => n + 1) };
}

export function SwList({ sw, tracks, timestamps, action }: { sw: SubWaveSource; tracks: SwTrack[]; timestamps?: boolean; action?: (t: SwTrack, i: number) => ReactNode }) {
  const rows = list(tracks).map(swTrack);
  if (!rows.length) return <p className="muted">Nothing yet.</p>;
  return (
    <div className="tracklist">
      {rows.map((t, i) => (
        <div key={`${i}:${t.id ?? t.title}`} className="station-row">
          <Cover src={sw.coverFor(t)} alt={t.title ?? ''} className="tiny" />
          <div className="track-main">
            <div className="track-title">{t.title}</div>
            <div className="track-sub">{t.artist}{t.album ? ` — ${t.album}` : ''}</div>
          </div>
          {action?.(t, i)}
          {timestamps && t.startedAt ? <div className="track-meta">{timeAgo(t.startedAt)}</div> : t.duration ? <div className="track-time">{fmtTime(t.duration)}</div> : null}
        </div>
      ))}
    </div>
  );
}
