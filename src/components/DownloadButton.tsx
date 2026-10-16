import { useState } from 'react';
import type { Track } from '../sources/types';
import { canDownload, trackKey, useOffline } from '../store/offline';
import { isTauri } from '../lib/http';
import { IconDownload } from './Icons';

interface Props {
  id: string;
  kind: 'album' | 'playlist';
  name: string;
  subtitle?: string;
  cover?: string;
  tracks: Track[];
  className?: string;
}

/** "Download" for an album/playlist → saved on this device for offline listening. */
export function DownloadButton({ id, kind, name, subtitle, cover, tracks, className = 'btn' }: Props) {
  const job = useOffline((s) => s.jobs[id]);
  const saved = useOffline((s) => s.collections.find((c) => c.id === id));
  const have = useOffline((s) => s.tracks);
  const [err, setErr] = useState<string>();
  const list = tracks.filter(canDownload);
  if (!isTauri || !list.length) return null;

  const missing = list.filter((t) => !have[trackKey(t)]).length;
  const running = job && job.done < job.total;
  const start = () =>
    useOffline.getState().download({ id, kind, name, subtitle, cover, tracks: list }).catch((e) => setErr(String(e.message ?? e)));

  if (running) {
    return <button className={`${className} dl-progress`} disabled style={{ ['--pct' as string]: `${(job.done / job.total) * 100}%` }}>
      <IconDownload /> {job.done}/{job.total}
    </button>;
  }
  if (saved && !missing) {
    return (
      <button className={`${className} downloaded`} title="Saved on this device — click to remove the download"
        onClick={() => confirm(`Remove the downloaded copy of "${name}" from this device?`) && useOffline.getState().remove(id)}>
        ✓ Downloaded
      </button>
    );
  }
  return (
    <button className={className} title={err ?? job?.error ?? 'Save on this device to play offline'} onClick={start}>
      <IconDownload /> {saved ? `Finish download (${missing} left)` : 'Download'}
      {job?.failed ? <small className="card-err"> · {job.failed} failed</small> : null}
    </button>
  );
}
