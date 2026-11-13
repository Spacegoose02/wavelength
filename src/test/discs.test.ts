import { describe, expect, test, vi } from 'vitest';
import { discHeading, hasDiscs } from '../lib/discs';

/** Deezer's answers by URL path. */
const pages: Record<string, unknown> = {};
vi.mock('../lib/http', () => ({
  qs: (p: Record<string, string>) => new URLSearchParams(p).toString(),
  chartFetch: vi.fn(),
  setHubFetch: vi.fn(),
  hubEndpoint: vi.fn(),
  http: vi.fn(),
  trimSlash: (s: string) => s,
  isTauri: false,
  getJson: vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    if (!(path in pages)) throw new Error('404');
    return pages[path];
  }),
}));
const { getDeezerAlbum } = await import('../sources/deemix');

/** Where the album page puts "Disc N" headings, as [row, disc]. */
const headings = (tracks: { discNumber?: number }[]) =>
  hasDiscs(tracks) ? tracks.flatMap((t, i) => { const d = discHeading(t, tracks[i - 1]); return d === undefined ? [] : [[i, d]]; }) : [];

describe('disc headings', () => {
  test('only an album on more than one disc gets them', () => {
    expect(headings([{}, {}, {}])).toEqual([]);
    expect(headings([{ discNumber: 1 }, { discNumber: 1 }])).toEqual([]);
    expect(headings([{ discNumber: 2 }, { discNumber: 2 }])).toEqual([]);
  });

  test('one heading over the first song of each disc; no disc number counts as disc 1', () => {
    expect(headings([{}, { discNumber: 1 }, { discNumber: 2 }, { discNumber: 2 }, { discNumber: 3 }])).toEqual([[0, 1], [2, 2], [4, 3]]);
  });

  test('a hidden first song moves the heading to the next song shown', () => {
    // TrackList passes the last row it showed, not the row above
    expect(discHeading({ discNumber: 2 }, { discNumber: 1 })).toBe(2);
    expect(discHeading({ discNumber: 2 }, undefined)).toBe(2);
    expect(discHeading({ discNumber: 2 }, { discNumber: 2 })).toBeUndefined();
  });
});

describe('Deezer album pages', () => {
  const embedded = [{ id: 1, title: 'A' }, { id: 2, title: 'B' }, { id: 3, title: 'C' }];
  pages['/album/9'] = { id: 9, title: 'Double', artist: { name: 'X' }, tracks: { data: embedded } };

  test('take track and disc numbers from /album/{id}/tracks', async () => {
    pages['/album/9/tracks'] = { total: 3, data: [
      { id: 1, track_position: 1, disk_number: 1 },
      { id: 2, track_position: 1, disk_number: 2 },
      { id: 3, track_position: 2, disk_number: 2 },
    ] };
    const page = await getDeezerAlbum(9);
    expect(page.tracks.map((t) => [t.title, t.discNumber, t.trackNumber])).toEqual([['A', 1, 1], ['B', 2, 1], ['C', 2, 2]]);
  });

  test('number the songs in order when /tracks can’t be fetched', async () => {
    delete pages['/album/9/tracks'];
    const page = await getDeezerAlbum(9);
    expect(page.tracks.map((t) => [t.title, t.discNumber, t.trackNumber])).toEqual([['A', undefined, 1], ['B', undefined, 2], ['C', undefined, 3]]);
  });
});
