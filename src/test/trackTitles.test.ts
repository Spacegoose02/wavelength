import { describe, expect, test } from 'vitest';
import { looseWithoutTrackNumber, numberedTitle, titleFixes, withoutTrackNumber } from '../lib/trackTitles';
import { lyricQueries } from '../lib/lyrics';
import { artistOfAlbum } from '../lib/trackLinks';

describe('track numbers in titles', () => {
  test('padded numbers and the song’s own number come off', () => {
    expect(withoutTrackNumber("04 - God's Plan")).toBe("God's Plan");
    expect(withoutTrackNumber("04. God's Plan")).toBe("God's Plan");
    expect(withoutTrackNumber('04 – Nice For What')).toBe('Nice For What');
    expect(withoutTrackNumber('04 Nice For What')).toBe('Nice For What');
    expect(withoutTrackNumber('4 - Nice For What', 4)).toBe('Nice For What');
    expect(withoutTrackNumber('12. In My Feelings', 12)).toBe('In My Feelings');
    expect(numberedTitle('04 - Song')).toEqual({ number: 4, title: 'Song' });
  });

  test('numbers that are part of the name stay', () => {
    expect(withoutTrackNumber('7 Rings', 7)).toBe('7 Rings');
    expect(withoutTrackNumber('99 Problems')).toBe('99 Problems');
    expect(withoutTrackNumber('1-800-273-8255', 1)).toBe('1-800-273-8255');
    expect(withoutTrackNumber('22 - Taylor', 3)).toBe('22 - Taylor');
    expect(withoutTrackNumber('4 - Song', 7)).toBe('4 - Song');
    expect(withoutTrackNumber('04 Song', 7)).toBe('04 Song');
    expect(withoutTrackNumber('04')).toBe('04');
    expect(withoutTrackNumber('')).toBe('');
  });

  test('lookups also try a short number without the track number', () => {
    expect(looseWithoutTrackNumber('4 - Song')).toBe('Song');
    expect(looseWithoutTrackNumber('7 Rings')).toBe('7 Rings');
  });

  test('lyrics are looked up without the number', () => {
    expect(lyricQueries({ title: "04 - God's Plan", artist: 'Drake' })[0]).toEqual({ artist: 'Drake', title: "God's Plan" });
    expect(lyricQueries({ title: '4 - Nice For What', artist: 'Drake', trackNumber: 4 })[0]).toEqual({ artist: 'Drake', title: 'Nice For What' });
    // the "Artist - Title" reading of YouTube downloads still works
    expect(lyricQueries({ title: 'Adele - Hello', artist: '' })[0]).toEqual({ artist: 'Adele', title: 'Hello' });
  });

  test('the files to fix', () => {
    const fixes = titleFixes([
      { path: 'a/04 - x.mp3', albumId: 'al1', tags: { title: "04 - God's Plan", track: '4/18' } },
      { path: 'a/05 - y.mp3', albumId: 'al1', tags: { title: 'Nice For What', track: '5' } },
      { path: 'a/06 - z.mp3', albumId: 'al1', tags: { title: '6 - In My Feelings', track: '6' } },
    ]);
    expect(fixes).toEqual([
      { path: 'a/04 - x.mp3', albumId: 'al1', from: "04 - God's Plan", to: "God's Plan" },
      { path: 'a/06 - z.mp3', albumId: 'al1', from: '6 - In My Feelings', to: 'In My Feelings' },
    ]);
  });
});

describe("an album's artist link", () => {
  const drake = { id: 'ar1', sourceId: 'nd', name: 'Drake' };
  const album = { id: 'al1', sourceId: 'nd', title: 'Scorpion', artist: 'Drake', artistId: 'ar1' };
  test('by the artist id', () => {
    expect(artistOfAlbum(album, [{ id: 'x', sourceId: 'nd', name: 'Future' }, drake])).toBe(drake);
  });
  test('by name when the id isn’t in the artist list', () => {
    expect(artistOfAlbum({ ...album, artistId: 'other' }, [drake])).toBe(drake);
    expect(artistOfAlbum({ ...album, artist: 'Drake & Future', artistId: undefined }, [drake])).toBe(drake);
  });
  test('else the server’s artist id', () => {
    expect(artistOfAlbum({ ...album, artistId: 'ar9' }, [])).toEqual({ id: 'ar9', sourceId: 'nd', name: 'Drake' });
    expect(artistOfAlbum({ ...album, artistId: undefined }, [])).toBeUndefined();
  });
});
