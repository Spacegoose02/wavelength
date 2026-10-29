import { create } from 'zustand';
import { hubRuns } from '../lib/hubServices';
import type { HubYtJob } from '../sources/hub';
import { ytdlp, type YtProgress, type YtResult } from '../sources/ytdlp';
import { hubClient } from './hub';
import { useSettings } from './settings';

export interface YtJob extends YtResult {
  jobId: string;
  status: YtProgress['status'] | 'queued';
  percent: number;
  message?: string;
  /** Hub downloads: who started it (admins see everyone's). */
  username?: string;
}

interface DownloadsState {
  jobs: YtJob[];
  start(r: YtResult): Promise<void>;
  clearFinished(): void;
}

/**
 * yt-dlp downloads. When the signed-in Hub runs yt-dlp, it searches and downloads straight into the music
 * folder (from any device, Android included) and this mirrors its job list; otherwise yt-dlp runs on
 * this computer (desktop app only).
 */
export const useDownloads = create<DownloadsState>()((set) => ({
  jobs: [],
  async start(r) {
    const c = hubClient();
    if (c && hubRuns('ytdlp')) {
      try {
        const { job } = await c.ytStart({ url: r.url, title: r.title, channel: r.channel });
        set((s) => ({ jobs: [fromHub(job), ...s.jobs.filter((j) => j.jobId !== job.jobId)] }));
        watchHub();
      } catch (e) {
        set((s) => ({ jobs: [{ ...r, jobId: crypto.randomUUID(), status: 'error', percent: 0, message: String((e as Error).message ?? e) }, ...s.jobs] }));
      }
      return;
    }
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
  clearFinished: () => {
    const c = hubClient();
    if (c && hubRuns('ytdlp')) c.ytClear().then(refreshHub).catch(() => undefined);
    set((s) => ({ jobs: s.jobs.filter((j) => j.status !== 'done' && j.status !== 'error') }));
  },
}));

/** Search YouTube (or expand a link) on the Hub when it runs yt-dlp, else on this computer. */
export async function ytSearch(q: string): Promise<YtResult[]> {
  const c = hubClient();
  if (c && hubRuns('ytdlp')) return (await c.ytSearch(q)).results;
  return ytdlp.search(q, useSettings.getState().ytdlp.bin);
}

let connectedShare: string | undefined;

function update(jobId: string, patch: Partial<YtJob>) {
  useDownloads.setState((s) => ({ jobs: s.jobs.map((j) => (j.jobId === jobId ? { ...j, ...patch } : j)) }));
}

ytdlp.onProgress((p) =>
  update(p.id, { status: p.status, ...(p.percent != null ? { percent: p.percent } : {}), ...(p.message ? { message: p.message } : {}) }),
);

const fromHub = (j: HubYtJob): YtJob => ({ id: j.jobId, jobId: j.jobId, title: j.title, channel: j.channel, url: j.url, status: j.status, percent: j.percent, message: j.message, username: j.username });

/** Load the Hub's job list (also shows downloads started on other devices). */
export async function refreshHub() {
  const c = hubClient();
  if (!c || !hubRuns('ytdlp')) return;
  const { jobs } = await c.ytJobs();
  useDownloads.setState({ jobs: jobs.map(fromHub) });
  return jobs.some((j) => j.status !== 'done' && j.status !== 'error');
}

let watching: ReturnType<typeof setInterval> | undefined;
/** Poll the Hub while any of its downloads is still running. */
export function watchHub() {
  if (watching) return;
  watching = setInterval(async () => {
    const busy = await refreshHub().catch(() => false);
    if (!busy) {
      clearInterval(watching);
      watching = undefined;
    }
  }, 1500);
}
