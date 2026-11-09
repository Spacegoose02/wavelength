import { afterEach, describe, expect, test, vi } from 'vitest';
import { episodeDate, filterLatest, isPlayed, mergeEpisodes, timeLeft, withMarks, type LatestFilter } from '../lib/episodes';
import { AudiobookshelfSource } from '../sources/audiobookshelf';
import type { Track } from '../sources/types';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 9, 12);
const ep = (id: string, show: string, daysAgo: number, x: Partial<Track> = {}): Track => ({
  id: `${show}:${id}`,
  sourceId: 'abs',
  kind: 'episode',
  title: id,
  artist: show,
  album: show,
  bookId: show,
  episodeId: id,
  publishedAt: NOW - daysAgo * DAY,
  duration: 3600,
  ...x,
});
const ids = (l: Track[]) => l.map((t) => t.title);
const all: LatestFilter = { shows: [], unplayedOnly: false, days: 0, order: 'newest' };

describe('latest episodes', () => {
  const list = [
    ep('dark-1', 'dark', 40),
    ep('weekly-3', 'weekly', 1),
    ep('dark-2', 'dark', 3, { progress: 0.5 }),
    ep('weekly-2', 'weekly', 8, { progress: 1 }),
    ep('other-1', 'other', 0),
  ];

  test('every show, newest first', () => {
    expect(ids(filterLatest(list, all, NOW))).toEqual(['other-1', 'weekly-3', 'dark-2', 'weekly-2', 'dark-1']);
  });

  test('only the picked shows', () => {
    expect(ids(filterLatest(list, { ...all, shows: ['dark', 'weekly'] }, NOW))).toEqual(['weekly-3', 'dark-2', 'weekly-2', 'dark-1']);
  });

  test('unplayed only keeps the ones you are part way through', () => {
    expect(ids(filterLatest(list, { ...all, unplayedOnly: true }, NOW))).toEqual(['other-1', 'weekly-3', 'dark-2', 'dark-1']);
  });

  test('this week, oldest first (catching up in order)', () => {
    expect(ids(filterLatest(list, { ...all, days: 7, order: 'oldest' }, NOW))).toEqual(['dark-2', 'weekly-3', 'other-1']);
  });

  test('one of each when a show is read in full as well', () => {
    expect(mergeEpisodes([[list[0], list[1]], [list[1], list[2]]])).toHaveLength(3);
  });

  test('what you marked wins over what was loaded', () => {
    const marked = withMarks(list, { 'abs:weekly:weekly-3': 1, 'abs:weekly:weekly-2': 0 });
    expect(isPlayed(marked[1])).toBe(true);
    expect(isPlayed(marked[3])).toBe(false);
    expect(marked[0]).toBe(list[0]);
  });
});

describe('labels', () => {
  test('time left', () => {
    expect(timeLeft(3600, 0.5)).toBe('30 min left');
    expect(timeLeft(4 * 3600, 0.25)).toBe('3 h left');
    expect(timeLeft(3600 * 2, 0.4)).toBe('1 h 12 min left');
    expect(timeLeft(3600, 0)).toBeUndefined();
    expect(timeLeft(3600, 1)).toBeUndefined();
  });

  test('episode dates', () => {
    expect(episodeDate(NOW - 1000, NOW)).toBe('Today');
    expect(episodeDate(NOW - DAY, NOW)).toBe('Yesterday');
    expect(episodeDate(undefined, NOW)).toBe('');
  });
});

describe('Audiobookshelf', () => {
  afterEach(() => vi.unstubAllGlobals());
  const abs = new AudiobookshelfSource({ id: 'abs', kind: 'audiobookshelf', name: 'ABS', url: 'http://abs', token: 'tok', enabled: true } as any);

  test('latest episodes come from every podcast library, newest first, with progress', async () => {
    const fetch = vi.fn(async (url: string) => {
      const body = url.includes('/api/libraries/pods/recent-episodes')
        ? {
            episodes: [
              { id: 'e1', libraryItemId: 'dark', title: 'Old', publishedAt: 100, audioFile: { duration: 1800 }, podcast: { metadata: { title: 'In the Dark' } } },
              { id: 'e2', libraryItemId: 'weekly', title: 'New', publishedAt: 200, duration: 2400, podcast: { metadata: { title: 'The Weekly Show' } } },
            ],
          }
        : url.includes('/api/libraries')
          ? { libraries: [{ id: 'pods', mediaType: 'podcast' }, { id: 'books', mediaType: 'book' }] }
          : { mediaProgress: [{ libraryItemId: 'dark', episodeId: 'e1', progress: 0.5, currentTime: 900, lastUpdate: 5 }] };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.stubGlobal('fetch', fetch);
    const list = await abs.getLatestEpisodes();
    expect(list.map((t) => [t.title, t.album, t.bookId, t.episodeId, t.progress])).toEqual([
      ['New', 'The Weekly Show', 'weekly', 'e2', undefined],
      ['Old', 'In the Dark', 'dark', 'e1', 0.5],
    ]);
    expect(list[1].duration).toBe(1800);
    expect(fetch.mock.calls.some(([u]) => String(u).includes('/books/recent-episodes'))).toBe(false);
  });

  test('marking played and unplayed', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await abs.setPlayed([ep('e1', 'dark', 0)], true);
    await abs.setPlayed([ep('e1', 'dark', 0), ep('e2', 'weekly', 0)], false);
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][0]).toBe('http://abs/api/me/progress/dark/e1');
    expect(calls[0][1].method).toBe('PATCH');
    expect(JSON.parse(String(calls[0][1].body))).toEqual({ isFinished: true });
    expect(calls[1][0]).toBe('http://abs/api/me/progress/batch/update');
    expect(JSON.parse(String(calls[1][1].body))).toEqual([
      { libraryItemId: 'dark', episodeId: 'e1', isFinished: false, progress: 0, currentTime: 0 },
      { libraryItemId: 'weekly', episodeId: 'e2', isFinished: false, progress: 0, currentTime: 0 },
    ]);
  });
});
