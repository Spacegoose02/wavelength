import { describe, expect, test } from 'vitest';
import { sortBooks, sortEpisodes, sortPodcasts } from '../lib/shelfSort';
import { chapterAt } from '../lib/chapters';
import { chapters } from '../sources/audiobookshelf';
import type { Book, Podcast, Track } from '../sources/types';

const book = (title: string, x: Partial<Book> = {}): Book => ({ id: title, sourceId: 'abs', title, author: 'A', ...x });
const titles = (l: { title: string }[]) => l.map((b) => b.title);

describe('audiobook sorting', () => {
  const books = [
    book('The Hobbit', { addedAt: 1, lastPlayedAt: 50, progress: 0.4, publishedYear: 1937, duration: 40_000 }),
    book('Dune', { addedAt: 3, publishedYear: 1965, duration: 75_000, series: 'Dune' }),
    book('Dune Messiah', { addedAt: 2, progress: 1, finished: true, series: 'Dune', duration: 30_000 }),
    book('Atlas', { lastPlayedAt: 90, progress: 0.1 }),
  ];
  test('recently added, with undated books last', () => {
    expect(titles(sortBooks(books, 'added'))).toEqual(['Dune', 'Dune Messiah', 'The Hobbit', 'Atlas']);
  });
  test('recently played', () => {
    expect(titles(sortBooks(books, 'played')).slice(0, 2)).toEqual(['Atlas', 'The Hobbit']);
  });
  test('title ignores "The"', () => {
    expect(titles(sortBooks(books, 'title'))).toEqual(['Atlas', 'Dune', 'Dune Messiah', 'The Hobbit']);
  });
  test('series first, then the rest', () => {
    expect(titles(sortBooks(books, 'series'))).toEqual(['Dune', 'Dune Messiah', 'Atlas', 'The Hobbit']);
  });
  test('length and published', () => {
    expect(titles(sortBooks(books, 'longest'))[0]).toBe('Dune');
    expect(titles(sortBooks(books, 'shortest'))[0]).toBe('Dune Messiah');
    expect(titles(sortBooks(books, 'published')).slice(0, 2)).toEqual(['Dune', 'The Hobbit']);
  });
  test('not started, in progress and finished', () => {
    expect(titles(sortBooks(books, 'title', 'new'))).toEqual(['Dune']);
    expect(titles(sortBooks(books, 'title', 'started'))).toEqual(['Atlas', 'The Hobbit']);
    expect(titles(sortBooks(books, 'title', 'finished'))).toEqual(['Dune Messiah']);
  });
});

describe('podcast sorting', () => {
  const pod = (title: string, x: Partial<Podcast>): Podcast => ({ id: title, sourceId: 'abs', title, author: '', ...x });
  const pods = [pod('Old show', { addedAt: 1, updatedAt: 100, episodeCount: 300 }), pod('New show', { addedAt: 5, updatedAt: 10, lastPlayedAt: 7, episodeCount: 3 })];
  test('new episodes, added, played, most episodes', () => {
    expect(titles(sortPodcasts(pods, 'updated'))).toEqual(['Old show', 'New show']);
    expect(titles(sortPodcasts(pods, 'added'))).toEqual(['New show', 'Old show']);
    expect(titles(sortPodcasts(pods, 'played'))).toEqual(['New show', 'Old show']);
    expect(titles(sortPodcasts(pods, 'episodes'))).toEqual(['Old show', 'New show']);
  });
  test('episodes: oldest first, and unplayed first puts the one in progress on top', () => {
    const ep = (title: string, publishedAt: number, progress?: number): Track => ({ id: title, sourceId: 'abs', kind: 'episode', title, artist: '', publishedAt, progress });
    const eps = [ep('Ep 3', 3), ep('Ep 2', 2, 1), ep('Ep 1', 1, 0.5)];
    expect(titles(sortEpisodes(eps, 'oldest'))).toEqual(['Ep 1', 'Ep 2', 'Ep 3']);
    expect(titles(sortEpisodes(eps, 'unplayed'))).toEqual(['Ep 1', 'Ep 3', 'Ep 2']);
  });
});

describe('chapters', () => {
  const list = chapters([{ start: 600, end: 1200, title: 'Two' }, { start: 0, end: 600, title: '' }, { start: 5, end: 5 }]);
  test('read from Audiobookshelf, sorted, named and without empty ones', () => {
    expect(list).toEqual([{ start: 0, end: 600, title: 'Chapter 2' }, { start: 600, end: 1200, title: 'Two' }]);
    expect(chapters([{ start: 0, end: 10, title: 'Only' }])).toBeUndefined();
  });
  test('the chapter playing', () => {
    expect(chapterAt(list, 10)?.index).toBe(0);
    expect(chapterAt(list, 599.9)?.index).toBe(1); // within a quarter second counts as the next one
    expect(chapterAt(list, 900)?.chapter.title).toBe('Two');
  });
});
