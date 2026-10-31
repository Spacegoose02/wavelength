import { beforeEach, describe, expect, test } from 'vitest';
import { explicitOfAlbum, explicitOfTrack, useRatings } from '../lib/kids';
import { versionOf } from '../lib/versions';
import type { Album } from '../sources/types';

const rating = (kind: 'album' | 'track', title = '') =>
  ({ kind, artist: 'Rihanna', album: 'Loud', title, rating: 'explicit', cleanLink: null, checkedAt: 0 }) as const;

describe('clean versions next to a checked explicit album', () => {
  beforeEach(() => useRatings.setState({ ratings: [rating('album'), rating('track', 'S&M')] }));

  test('the explicit album and its explicit songs stay explicit', () => {
    expect(explicitOfAlbum({ artist: 'Rihanna', title: 'Loud' })).toBe('explicit');
    expect(explicitOfTrack({ artist: 'Rihanna', album: 'Loud', title: 'S&M' })).toBe('explicit');
    expect(explicitOfTrack({ artist: 'Rihanna', album: 'Loud', title: 'Only Girl' })).toBe('clean');
  });

  test('"(Clean)" in the album title wins over the explicit album’s rating', () => {
    expect(explicitOfAlbum({ artist: 'Rihanna', title: 'Loud (Clean)' })).toBe('clean');
    expect(explicitOfTrack({ artist: 'Rihanna', album: 'Loud (Clean)', title: 'S&M' })).toBe('clean');
    expect(explicitOfTrack({ artist: 'Rihanna', album: 'Loud [Edited]', title: 'S&M' })).toBe('clean');
    expect(versionOf({ artist: 'Rihanna', title: 'Loud (Clean)' } as Album)).toBe('clean');
  });

  test('a song file tagged explicit stays explicit', () => {
    expect(explicitOfTrack({ artist: 'Rihanna', album: 'Loud (Clean)', title: 'S&M', explicit: 'explicit' })).toBe('explicit');
  });
});

describe('admin flags', () => {
  test('hiding the explicit album from kids doesn’t hide its clean version', async () => {
    const { useFlags, albumNotForKids } = await import('../lib/kids');
    useRatings.setState({ ratings: [] });
    useFlags.setState({ flags: [{ id: 1, kind: 'album', artist: 'Rihanna', title: 'Loud', verdict: 'block' } as never] });
    expect(albumNotForKids({ artist: 'Rihanna', title: 'Loud' } as Album)).toBe(true);
    expect(albumNotForKids({ artist: 'Rihanna', title: 'Loud (Clean)' } as Album)).toBe(false);
  });
});
