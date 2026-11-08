import { describe, expect, test } from 'vitest';
import { primaryArtist } from '../lib/match';
import { splitCredit } from '../lib/merge';
import { creditFix, filterUnmatched, issueCounts, maybeJoined, songIssues, tidyCredit, unmatchedSongs } from '../lib/songIssues';

const full = { title: 'Mrs. Officer', album: 'Tha Carter III', track: '7', year: '2008', genre: 'Rap; Hip-Hop' };

describe('joined artist credits', () => {
  test('a semicolon with or without a space becomes the "; " Navidrome splits on', () => {
    expect(tidyCredit('Lil Wayne;Drake')).toBe('Lil Wayne; Drake');
    expect(tidyCredit('Lil Wayne ;Drake;  Future')).toBe('Lil Wayne; Drake; Future');
    expect(tidyCredit('Lil Wayne；Drake')).toBe('Lil Wayne; Drake');
    expect(tidyCredit('Drake;')).toBe('Drake');
    expect(tidyCredit('Lil Wayne; Drake')).toBe('Lil Wayne; Drake');
    expect(tidyCredit('Lil Wayne feat. Drake')).toBe('Lil Wayne feat. Drake');
    expect(tidyCredit('Lil Durk;Lil Durk')).toBe('Lil Durk');
    expect(tidyCredit('Lil Durk Lil Durk')).toBe('Lil Durk');
    expect(tidyCredit('Duran Duran')).toBe('Duran Duran');
  });

  test('the main artist is found the same with or without the space', () => {
    expect(primaryArtist('Lil Wayne;Drake')).toBe('Lil Wayne');
    expect(primaryArtist('Lil Wayne; Drake')).toBe('Lil Wayne');
    expect(primaryArtist('Lil Wayne / Drake')).toBe('Lil Wayne');
    expect(primaryArtist('AC/DC')).toBe('AC/DC');
    expect(splitCredit('Lil Wayne;Drake')).toEqual(['Lil Wayne', 'Drake']);
  });

  test('other joins are only flagged', () => {
    expect(maybeJoined('Lil Wayne,Drake')).toBe(true);
    expect(maybeJoined('AC/DC')).toBe(true);
    expect(maybeJoined('Tyler, The Creator')).toBe(false);
    expect(maybeJoined('Lil Wayne / Drake')).toBe(false);
  });
});

describe('unmatched songs', () => {
  test('what is wrong with a song', () => {
    expect(songIssues({ ...full, artist: 'Lil Wayne', albumArtist: 'Lil Wayne' })).toEqual([]);
    expect(songIssues({ ...full, artist: 'Lil Wayne;Drake', albumArtist: 'Lil Wayne' })).toEqual(['joined']);
    expect(songIssues({ title: 'x', artist: '[Unknown Artist]' })).toEqual(['noArtist', 'noAlbumArtist', 'noAlbum', 'noGenre', 'noYear', 'noTrack']);
    expect(songIssues({ ...full, title: '', artist: 'A,B', albumArtist: 'A' })).toEqual(['maybeJoined', 'noTitle']);
  });

  test('the fix touches only the joined tags', () => {
    expect(creditFix({ artist: 'Lil Wayne;Drake', albumArtist: 'Lil Wayne' })).toEqual({ artist: 'Lil Wayne; Drake' });
    expect(creditFix({ artist: 'Lil Wayne', albumArtist: 'Lil Wayne;Drake' })).toEqual({ albumArtist: 'Lil Wayne; Drake' });
    expect(creditFix({ artist: 'Lil Wayne; Drake' })).toBeNull();
    expect(creditFix({ artist: 'Lil Durk;Lil Durk', albumArtist: 'Lil Durk' })).toEqual({ artist: 'Lil Durk' });
    expect(songIssues({ ...full, artist: 'Lil Durk Lil Durk', albumArtist: 'Lil Durk' })).toContain('joined');
  });

  test('filters and counts', () => {
    const songs = unmatchedSongs([
      { id: '1', albumId: 'a', path: 'a/1.mp3', tags: { ...full, artist: 'Lil Wayne;Drake', albumArtist: 'Lil Wayne' } },
      { id: '2', albumId: 'a', path: 'a/2.mp3', tags: { ...full, artist: 'Lil Wayne;Drake', albumArtist: 'Lil Wayne', genre: '' } },
      { id: '3', albumId: 'b', path: 'b/3.mp3', tags: { ...full, artist: 'Nicki Minaj', albumArtist: 'Nicki Minaj', genre: '' } },
      { id: '4', albumId: 'b', path: 'b/4.mp3', tags: { ...full, artist: 'Fine', albumArtist: 'Fine' } },
    ]);
    expect(songs.map((s) => s.id)).toEqual(['1', '2', '3']);
    expect(issueCounts(songs)).toMatchObject({ joined: 2, noGenre: 2, noYear: 0 });
    expect(filterUnmatched(songs, new Set(['joined', 'noGenre'])).map((s) => s.id)).toEqual(['2']);
    expect(filterUnmatched(songs, new Set(), 'nicki').map((s) => s.id)).toEqual(['3']);
    expect(filterUnmatched(songs, new Set(), 'B/3').map((s) => s.id)).toEqual(['3']);
  });
});
