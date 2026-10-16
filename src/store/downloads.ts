import { create } from 'zustand';
import { ytdlp, type YtProgress, type YtResult } from '../sources/ytdlp';
import { useSettings } from './settings';

export interface YtJob extends YtResult {
  jobId: string;
  status: YtProgress['status'] | 'queued';
  percent: number;
  message?: string;
}

interface DownloadsState {
  jobs: YtJob[];
  start(r: YtResult): Promise<void>;
  clearFinished(): void;
}

export const useDownloads = create<DownloadsState>()((set) => ({
  jobs: [],
  async start(r) {
    const { outDir, format, bin, shareUser, sharePass } = useSettings.getState().ytdlp;
    const jobId = crypto.randomUUID();
    set((s) => ({ jobs: [{ ...r, jobId, status: 'queued', percent: 0 }, ...s.jobs] }));
    if (!outDir) {
      update(jobId, { status: 'error', message: 'Set a yt-dlp download folder in Settings first' });
      return;
    }
    try {
      // network folder: log in to the share first (once per run)
      if (/^(\\\\|\/\/)/.test(outDir) && connectedShare !== outDir) {
        await ytdlp.connectShare(outDir, shareUser, sharePass);
        connectedShare = outDir;
      }
      await ytdlp.download({ id: jobId, url: r.url, outDir, format, bin });
    } catch (e) {
      update(jobId, { status: 'error', message: String(e) });
    }
  },
  clearFinished: () => set((s) => ({ jobs: s.jobs.filter((j) => j.status !== 'done' && j.status !== 'error') })),
}));

let connectedShare: string | undefined;

function update(jobId: string, patch: Partial<YtJob>) {
  useDownloads.setState((s) => ({ jobs: s.jobs.map((j) => (j.jobId === jobId ? { ...j, ...patch } : j)) }));
}

ytdlp.onProgress((p) =>
  update(p.id, { status: p.status, ...(p.percent != null ? { percent: p.percent } : {}), ...(p.message ? { message: p.message } : {}) }),
);
