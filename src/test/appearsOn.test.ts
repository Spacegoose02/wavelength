import { describe, expect, test } from 'vitest';
import { appearsOnSongs, creditsOf, isCredited } from '../lib/appearsOn';

const future = { ids: new Set(['ar-future']), name: 'Future' };

describe('Appears On', () => {
  test('credits come from the artist line and "(feat. …)" tags in the title', () => {
    expect(creditsOf('Drake feat. Future & Lil Baby')).toEqual(['Drake', 'Future', 'Lil Baby']);
    expect(creditsOf('Drake', 'Life Is Good (feat. Future)')).toEqual(['Drake', 'Future']);
    expect(creditsOf('Drake', 'Wants and Needs [with Lil Baby, Future]')).toEqual(['Drake', 'Lil Baby', 'Future']);
    expect(creditsOf('Drake', 'Song ft. Future')).toEqual(['Drake', 'Future']);
    expect(creditsOf('Metro Boomin, Future; Travis Scott')).toEqual(['Metro Boomin', 'Future', 'Travis Scott']);
  });

  test('a credit has to be the whole name, not part of another one', () => {
    expect(isCredited({ title: 'Song', artist: 'Futuristic' }, future)).toBe(false);
    expect(isCredited({ title: 'Back to the Future' , artist: 'Someone' }, future)).toBe(false);
    expect(isCredited({ title: 'Song', artists: [{ id: 'ar-future', name: 'FUTURE' }] }, future)).toBe(true);
    expect(isCredited({ title: 'Song', artist: 'Someone x future' }, future)).toBe(true);
  });

  test("keeps other artists' albums once each, and leaves out the artist's own", () => {
    const songs = [
      { albumId: 'a1', title: 'Life Is Good (feat. Future)', artist: 'Drake', albumArtist: 'Drake' },
      { albumId: 'a1', title: 'Another', artist: 'Drake feat. Future', albumArtist: 'Drake' },
      { albumId: 'a2', title: 'Mask Off', artist: 'Future', albumArtist: 'Future' },
      { albumId: 'a3', title: 'Solo', artist: 'Future', albumArtistIds: ['ar-future'] },
      { albumId: 'a4', title: 'Back to the Future', artist: 'Someone', albumArtist: 'Someone' },
      { albumId: 'a5', title: 'Collab', artist: 'Future', albumArtist: 'Metro Boomin' },
      { albumId: 'a6', title: 'Listed', artist: 'X feat. Future', albumArtist: 'X' },
    ];
    expect(appearsOnSongs(songs, future, new Set(['a6'])).map((s) => s.albumId)).toEqual(['a1', 'a5']);
  });
});
