import { describe, expect, test } from 'vitest';
import { duplicateKey, findDuplicates, topArtists } from '../lib/libraryCare';
import { matches, newSmartPlaylist } from '../lib/smartPlaylists';
import type { Album } from '../sources/types';

const album = (id: string, title: string, artist = 'Drake', more: Partial<Album> = {}): Album => ({ id, sourceId: 'nd', title, artist, ...more });

describe('duplicates', () => {
  test('editions and remasters are the same album', () => {
    expect(duplicateKey(album('1', 'Views (Deluxe)'))).toBe(duplicateKey(album('2', 'Views')));
    expect(duplicateKey(album('1', 'Thriller - 25th Anniversary Edition', 'Michael Jackson'))).toBe(duplicateKey(album('2', 'Thriller', 'Michael Jackson')));
    expect(duplicateKey(album('1', 'Super Freaky Girl'))).not.toBe(duplicateKey(album('2', 'Freaky Girl')));
  });

  test('same server only, most complete copy first, clean versions apart', () => {
    const groups = findDuplicates([
      album('a', 'Views', 'Drake', { trackCount: 20 }),
      album('b', 'Views (Deluxe)', 'Drake', { trackCount: 24 }),
      album('c', 'Views (Clean)', 'Drake', { trackCount: 20 }),
      album('d', 'Views', 'Drake', { sourceId: 'plex' }),
      album('e', 'Scorpion'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].copies.map((a) => a.id)).toEqual(['b', 'a']);
  });

  test('top artists by album count, skipping Various Artists', () => {
    expect(topArtists([album('1', 'A'), album('2', 'B'), album('3', 'C', 'Various Artists'), album('4', 'D', 'SZA feat. Drake')], 5)).toEqual(['Drake', 'SZA']);
  });
});

describe('smart playlists', () => {
  const now = Date.parse('2026-10-31T00:00:00Z');
  const day = 86_400_000;
  const p = { ...newSmartPlaylist(), genres: ['Rap; Hip-Hop'], minRating: 4, notPlayedDays: 90 };
  const facts = { rating: 5, starred: false, plays: 3, playedAt: now - 200 * day, genre: 'Rap; Hip-Hop' };

  test('every rule has to hold', () => {
    expect(matches(p, facts, now)).toBe(true);
    expect(matches(p, { ...facts, rating: 3 }, now)).toBe(false);
    expect(matches(p, { ...facts, playedAt: now - 10 * day }, now)).toBe(false);
    expect(matches(p, { ...facts, playedAt: undefined }, now)).toBe(true);
    expect(matches(p, { ...facts, genre: 'Pop' }, now)).toBe(false);
  });

  test('added recently, years and ♥', () => {
    const q = { ...newSmartPlaylist(), addedDays: 30, fromYear: 2020, starred: true };
    expect(matches(q, { rating: 0, starred: true, plays: 0, addedAt: now - 5 * day, year: 2024 }, now)).toBe(true);
    expect(matches(q, { rating: 0, starred: true, plays: 0, addedAt: now - 50 * day, year: 2024 }, now)).toBe(false);
    expect(matches(q, { rating: 0, starred: true, plays: 0, addedAt: now - 5 * day, year: 2019 }, now)).toBe(false);
    expect(matches(q, { rating: 0, starred: false, plays: 0, addedAt: now - 5 * day, year: 2024 }, now)).toBe(false);
  });
});
