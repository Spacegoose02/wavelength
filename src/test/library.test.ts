import { describe, expect, test } from 'vitest';
import { mergeAlbums, mergeArtists, norm } from '../sources/registry';
import { cleanTitle, pool, primaryArtist } from '../lib/match';
import { versionKey } from '../lib/versions';
import type { Album, Artist } from '../sources/types';

const album = (sourceId: string, artist: string, title: string): Album => ({ id: `${sourceId}-${title}`, sourceId, artist, title }) as Album;

describe('matching the same music across servers', () => {
  test('norm ignores case, accents, a leading "The" and punctuation', () => {
    expect(norm('The Beatles')).toBe(norm('beatles'));
    expect(norm('Beyoncé')).toBe('beyonce');
    expect(norm('Simon & Garfunkel')).toBe(norm('Simon and Garfunkel'));
    expect(norm()).toBe('');
  });

  test('chart titles lose track numbers and "(feat. …)" / "(Remastered)" tags', () => {
    expect(cleanTitle('01 - Song Name (feat. Someone)')).toBe(norm('Song Name'));
    expect(cleanTitle('Song Name [2011 Remaster]')).toBe(norm('Song Name'));
    expect(cleanTitle('Song Name (Clean)')).toBe(norm('Song Name'));
  });

  test('the first credited artist is the one to match on', () => {
    expect(primaryArtist('Drake Featuring Future & Lil Baby')).toBe('Drake');
    expect(primaryArtist('Artist A, Artist B')).toBe('Artist A');
    expect(primaryArtist('Solo')).toBe('Solo');
  });

  test('clean and explicit copies of an album share a version key', () => {
    expect(versionKey({ artist: 'Kendrick Lamar', title: 'DAMN. (Clean)' })).toBe(versionKey({ artist: 'Kendrick Lamar', title: 'DAMN.' }));
  });

  test('the same album on two servers shows once, first source first', () => {
    const merged = mergeAlbums([[album('nd', 'The National', 'Boxer')], [album('plex', 'National', 'Boxer'), album('plex', 'Other', 'Album')]]);
    expect(merged).toHaveLength(2);
    expect(merged[0].sourceId).toBe('nd');
    expect(merged[0].refs?.map((r) => r.sourceId)).toEqual(['nd', 'plex']);
  });

  test('merged artists borrow a cover from a later server when the first has none', () => {
    const a = { id: '1', sourceId: 'nd', name: 'Björk' } as Artist;
    const b = { id: '2', sourceId: 'plex', name: 'Bjork', coverUrl: 'x.jpg' } as Artist;
    const [m] = mergeArtists([[a], [b]]);
    expect(m.coverUrl).toBe('x.jpg');
    expect(m.refs).toHaveLength(2);
  });

  test('pool keeps result order and never runs more than n at once', async () => {
    let running = 0;
    let most = 0;
    const out = await pool([5, 1, 3, 2], 2, async (x) => {
      most = Math.max(most, ++running);
      await new Promise((r) => setTimeout(r, x));
      running--;
      return x * 10;
    });
    expect(out).toEqual([50, 10, 30, 20]);
    expect(most).toBe(2);
  });
});
