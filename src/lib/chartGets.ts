import { create } from 'zustand';
import { songKey } from '../sources/charts';
import { getSong, NotOnDeezer, viaYtdlp, type Wanted } from './getSong';

/**
 * Getting (or requesting) chart songs from Discover, kept outside the page so it carries on when you leave it.
 *
 * Each song's state is kept by its chart key (sources/charts.ts songKey), so a row shows "Queued" again when you
 * come back, under any genre or chart. **Get all missing** is one background job: songs go one at a time (deemix and
 * the Hub's request queue both prefer that), with a progress bar on Discover and a Stop button.
 */

export interface GetState {
  state: 'sending' | 'queued' | 'error';
  via?: string;
  msg?: string;
  notOnDeezer?: boolean;
}

export interface GetAllJob {
  label: string;
  total: number;
  done: number;
  failed: number;
  running: boolean;
  stopped?: boolean;
}

interface ChartGets {
  songs: Record<string, GetState>;
  job: GetAllJob | null;
}

export const useChartGets = create<ChartGets>()(() => ({ songs: {}, job: null }));

const set = (k: string, s: GetState) => useChartGets.setState((st) => ({ songs: { ...st.songs, [k]: s } }));

/** Get one song (deemix, the Hub's requests, or yt-dlp as `how` says). Never throws: the outcome is in the store. */
export async function getOne(e: Wanted, how: 'auto' | 'ytdlp' = 'auto'): Promise<boolean> {
  const k = songKey(e);
  set(k, { state: 'sending' });
  try {
    set(k, { state: 'queued', via: how === 'ytdlp' ? await viaYtdlp(e) : await getSong(e) });
    return true;
  } catch (err) {
    set(k, { state: 'error', msg: String((err as Error).message ?? err), notOnDeezer: err instanceof NotOnDeezer });
    return false;
  }
}

let stopRequested = false;

/** Get every song in `list` in the background. Starting another while one runs adds nothing; it says so. */
export function getAll(list: Wanted[], label: string): boolean {
  if (useChartGets.getState().job?.running) return false;
  const todo = list.filter((e) => {
    const s = useChartGets.getState().songs[songKey(e)];
    return !s || s.state === 'error';
  });
  if (!todo.length) return false;
  stopRequested = false;
  useChartGets.setState({ job: { label, total: todo.length, done: 0, failed: 0, running: true } });
  void (async () => {
    for (const e of todo) {
      if (stopRequested) break;
      const ok = await getOne(e);
      useChartGets.setState((st) => (st.job ? { job: { ...st.job, done: st.job.done + 1, failed: st.job.failed + (ok ? 0 : 1) } } : {}));
    }
    useChartGets.setState((st) => (st.job ? { job: { ...st.job, running: false, stopped: stopRequested } } : {}));
  })();
  return true;
}

export function stopGetAll() {
  stopRequested = true;
}

export function clearGetAll() {
  if (!useChartGets.getState().job?.running) useChartGets.setState({ job: null });
}
