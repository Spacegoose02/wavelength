/**
 * Sorting and filtering for the Audiobooks and Podcasts pages and a show's episode list (docs/USER-GUIDE.md
 * "Audiobooks and podcasts"). The choice is remembered per page on this device.
 */
import type { Book, Podcast, Track } from '../sources/types';

export type BookSort = 'added' | 'played' | 'title' | 'author' | 'series' | 'published' | 'longest' | 'shortest';
export type BookShow = 'all' | 'new' | 'started' | 'finished';
export type PodcastSort = 'updated' | 'added' | 'played' | 'title' | 'author' | 'episodes';
export type EpisodeSort = 'newest' | 'oldest' | 'unplayed' | 'shortest' | 'longest';

export const BOOK_SORTS: [BookSort, string][] = [
  ['added', 'Recently added'],
  ['played', 'Recently played'],
  ['title', 'Title'],
  ['author', 'Author'],
  ['series', 'Series'],
  ['published', 'Newest published'],
  ['longest', 'Longest'],
  ['shortest', 'Shortest'],
];
export const BOOK_SHOWS: [BookShow, string][] = [
  ['all', 'All'],
  ['new', 'Not started'],
  ['started', 'In progress'],
  ['finished', 'Finished'],
];
export const PODCAST_SORTS: [PodcastSort, string][] = [
  ['updated', 'New episodes'],
  ['added', 'Recently added'],
  ['played', 'Recently played'],
  ['title', 'Title'],
  ['author', 'Author'],
  ['episodes', 'Most episodes'],
];
export const EPISODE_SORTS: [EpisodeSort, string][] = [
  ['newest', 'Newest'],
  ['oldest', 'Oldest'],
  ['unplayed', 'Unplayed first'],
  ['shortest', 'Shortest'],
  ['longest', 'Longest'],
];

const byText = (a = '', b = '') => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
/** Newest first, with the ones that have no date at the end. */
const newest = (a?: number, b?: number) => (b ?? -Infinity) - (a ?? -Infinity) || 0;
/** "The Hobbit" files under H. */
const sortTitle = (s: string) => s.replace(/^(the|a|an)\s+/i, '');

const bookState = (b: Book): BookShow => (b.finished || (b.progress ?? 0) >= 1 ? 'finished' : (b.progress ?? 0) > 0 ? 'started' : 'new');

export function sortBooks(books: Book[], sort: BookSort, show: BookShow = 'all'): Book[] {
  const list = show === 'all' ? [...books] : books.filter((b) => bookState(b) === show);
  const title = (a: Book, b: Book) => byText(sortTitle(a.title), sortTitle(b.title));
  const cmp: Record<BookSort, (a: Book, b: Book) => number> = {
    added: (a, b) => newest(a.addedAt, b.addedAt) || title(a, b),
    played: (a, b) => newest(a.lastPlayedAt, b.lastPlayedAt) || newest(a.addedAt, b.addedAt),
    title,
    author: (a, b) => byText(a.author, b.author) || byText(a.series, b.series) || title(a, b),
    // books in a series together, in title order (which is usually the number); the rest after, by title
    series: (a, b) => (a.series ? 0 : 1) - (b.series ? 0 : 1) || byText(a.series, b.series) || title(a, b),
    published: (a, b) => newest(a.publishedYear, b.publishedYear) || title(a, b),
    longest: (a, b) => (b.duration ?? 0) - (a.duration ?? 0),
    shortest: (a, b) => (a.duration ?? Infinity) - (b.duration ?? Infinity),
  };
  return list.sort(cmp[sort] ?? cmp.added);
}

export function sortPodcasts(podcasts: Podcast[], sort: PodcastSort): Podcast[] {
  const title = (a: Podcast, b: Podcast) => byText(sortTitle(a.title), sortTitle(b.title));
  const cmp: Record<PodcastSort, (a: Podcast, b: Podcast) => number> = {
    updated: (a, b) => newest(a.updatedAt ?? a.addedAt, b.updatedAt ?? b.addedAt) || title(a, b),
    added: (a, b) => newest(a.addedAt, b.addedAt) || title(a, b),
    played: (a, b) => newest(a.lastPlayedAt, b.lastPlayedAt) || title(a, b),
    title,
    author: (a, b) => byText(a.author, b.author) || title(a, b),
    episodes: (a, b) => (b.episodeCount ?? 0) - (a.episodeCount ?? 0) || title(a, b),
  };
  return [...podcasts].sort(cmp[sort] ?? cmp.updated);
}

export function sortEpisodes(episodes: Track[], sort: EpisodeSort): Track[] {
  const played = (t: Track) => ((t.progress ?? 0) >= 1 ? 2 : (t.progress ?? 0) > 0 ? 0 : 1);
  const cmp: Record<EpisodeSort, (a: Track, b: Track) => number> = {
    newest: (a, b) => newest(a.publishedAt, b.publishedAt),
    oldest: (a, b) => newest(b.publishedAt, a.publishedAt),
    // the one you're in the middle of, then ones you haven't heard (newest first), then finished ones
    unplayed: (a, b) => played(a) - played(b) || newest(a.publishedAt, b.publishedAt),
    shortest: (a, b) => (a.duration ?? Infinity) - (b.duration ?? Infinity),
    longest: (a, b) => (b.duration ?? 0) - (a.duration ?? 0),
  };
  return [...episodes].sort(cmp[sort] ?? cmp.newest);
}

/** A remembered choice (one of `options`), or `fallback`. */
export function savedChoice<T extends string>(key: string, options: [T, string][], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && options.some(([o]) => o === v) ? v : fallback;
  } catch {
    return fallback;
  }
}

export function saveChoice(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* no storage */
  }
}
