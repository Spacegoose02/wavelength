/**
 * Podcasts across shows (docs/USER-GUIDE.md "Latest episodes"): the newest episodes from every show (or the shows
 * you pick) in one list you can play straight through, the episodes you're part way through, and marking episodes
 * played or unplayed. Played state lives on Audiobookshelf, so it's the same on every device.
 */
import { create } from 'zustand';
import { sourceFor } from '../sources/registry';
import type { Book, Track } from '../sources/types';
import { enabledSources, useSettings } from '../store/settings';

const keyOf = (t: { sourceId: string; id: string }) => `${t.sourceId}:${t.id}`;

interface MarksState {
  /** What you changed in this session, by episode or book: progress (1 played, 0 unplayed). Lists show these over what they loaded. */
  marks: Record<string, number>;
}

/** Changes made here win over lists that were loaded before them, until the lists are loaded again. */
export const useMarks = create<MarksState>()(() => ({ marks: {} }));

/** The episodes with what you've marked since they were loaded. */
export function withMarks<T extends { sourceId: string; id: string; progress?: number }>(list: T[], marks: Record<string, number>): T[] {
  if (!Object.keys(marks).length) return list;
  return list.map((t) => {
    const m = marks[keyOf(t)];
    return m === undefined ? t : { ...t, progress: m, finished: m >= 1 };
  });
}

export const isPlayed = (t: { progress?: number }) => (t.progress ?? 0) >= 1;
export const isStarted = (t: { progress?: number }) => (t.progress ?? 0) > 0 && (t.progress ?? 0) < 1;

/** "23 min left", for an episode or book you're part way through. */
export function timeLeft(duration?: number, progress?: number): string | undefined {
  if (!duration || !progress || progress <= 0 || progress >= 1) return undefined;
  const s = duration * (1 - progress);
  if (s < 60) return 'Under a minute left';
  const mins = Math.round(s / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h} h${m ? ` ${m} min` : ''} left` : `${m} min left`;
}

/** "Today", "Yesterday", "Tuesday" this week, else the date. */
export function episodeDate(ms?: number, now = Date.now()): string {
  if (!ms) return '';
  const day = (x: number) => Math.floor((x - new Date(x).getTimezoneOffset() * 60_000) / 86_400_000);
  const ago = day(now) - day(ms);
  if (ago <= 0) return 'Today';
  if (ago === 1) return 'Yesterday';
  if (ago < 7) return new Date(ms).toLocaleDateString(undefined, { weekday: 'long' });
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, d.getFullYear() === new Date(now).getFullYear() ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
}

function sourceOf(sourceId: string) {
  const cfg = useSettings.getState().sources.find((s) => s.id === sourceId);
  return cfg ? sourceFor(cfg) : undefined;
}

/** Mark episodes played or unplayed on their server; the lists show it straight away. */
export async function setPlayed(tracks: Track[], played: boolean) {
  const eps = tracks.filter((t) => t.kind === 'episode');
  if (!eps.length) return;
  const before = useMarks.getState().marks;
  useMarks.setState({ marks: { ...before, ...Object.fromEntries(eps.map((t) => [keyOf(t), played ? 1 : 0])) } });
  const bySource = new Map<string, Track[]>();
  for (const t of eps) bySource.set(t.sourceId, [...(bySource.get(t.sourceId) ?? []), t]);
  try {
    await Promise.all([...bySource].map(([id, list]) => sourceOf(id)?.setPlayed?.(list, played)));
  } catch (e) {
    useMarks.setState({ marks: before });
    throw e;
  }
}

/** Mark a book finished, or back to not started. */
export async function setBookFinished(book: Book, finished: boolean) {
  const before = useMarks.getState().marks;
  useMarks.setState({ marks: { ...before, [keyOf(book)]: finished ? 1 : 0 } });
  try {
    await sourceOf(book.sourceId)?.setBookFinished?.(book.id, finished);
  } catch (e) {
    useMarks.setState({ marks: before });
    throw e;
  }
}

/** An episode that played to the end counts as played in the lists (the server is told by the last sync). */
export function markEnded(t: Track) {
  if (t.kind !== 'episode') return;
  useMarks.setState((s) => ({ marks: { ...s.marks, [keyOf(t)]: 1 } }));
}

// ---- the Latest episodes list ----

export type LatestOrder = 'newest' | 'oldest';

export interface LatestFilter {
  /** Podcast ids to include; empty is every show. */
  shows: string[];
  unplayedOnly: boolean;
  /** Only episodes out in the last this many days; 0 is any time. */
  days: number;
  order: LatestOrder;
}

export const LATEST_DAYS: [number, string][] = [
  [7, 'This week'],
  [30, 'This month'],
  [0, 'Any time'],
];

const FILTER_KEY = 'wavelength.latestEpisodes';
const DEFAULT_FILTER: LatestFilter = { shows: [], unplayedOnly: true, days: 0, order: 'newest' };

export function savedLatestFilter(): LatestFilter {
  try {
    const f = JSON.parse(localStorage.getItem(FILTER_KEY) ?? 'null');
    if (!f || typeof f !== 'object') return DEFAULT_FILTER;
    return {
      shows: Array.isArray(f.shows) ? f.shows.filter((x: unknown) => typeof x === 'string') : [],
      unplayedOnly: f.unplayedOnly !== false,
      days: LATEST_DAYS.some(([d]) => d === f.days) ? f.days : 0,
      order: f.order === 'oldest' ? 'oldest' : 'newest',
    };
  } catch {
    return DEFAULT_FILTER;
  }
}

export function saveLatestFilter(f: LatestFilter) {
  try {
    localStorage.setItem(FILTER_KEY, JSON.stringify(f));
  } catch {
    /* private window: not remembered */
  }
}

/**
 * The list to show and play: the picked shows (all when none are picked), unplayed only if asked, within the time
 * window, newest or oldest first. Oldest first plays a backlog in the order it came out.
 */
export function filterLatest(episodes: Track[], f: LatestFilter, now = Date.now()): Track[] {
  const shows = new Set(f.shows);
  const since = f.days ? now - f.days * 86_400_000 : 0;
  const out = episodes.filter(
    (t) => (!shows.size || (t.bookId && shows.has(t.bookId))) && (!f.unplayedOnly || !isPlayed(t)) && (!since || (t.publishedAt ?? 0) >= since),
  );
  const dir = f.order === 'oldest' ? -1 : 1;
  return out.sort((a, b) => dir * ((b.publishedAt ?? 0) - (a.publishedAt ?? 0)));
}

/** Put lists from several places together, keeping one of each episode. */
export function mergeEpisodes(lists: Track[][]): Track[] {
  const seen = new Map<string, Track>();
  for (const list of lists) for (const t of list) if (!seen.has(keyOf(t))) seen.set(keyOf(t), t);
  return [...seen.values()];
}

/** The episodes you're part way through, across servers, most recently played first. */
export async function loadInProgress(): Promise<Track[]> {
  const lists = await Promise.all(enabledSources().map((cfg) => sourceFor(cfg).getEpisodesInProgress?.().catch(() => [] as Track[]) ?? []));
  return lists.flat().sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0));
}
