import { describe, expect, test } from 'vitest';
import { albumKey, likeness, looseKey } from '../components/MergeInto';
import { albumTarget, mergedName, planAlbumMerge, planArtistMerge, renameArtist, splitCredit, splitCreditOptions } from '../lib/merge';
import type { HubTags } from '../sources/hub';

const song = (path: string, tags: HubTags, albumId = 'a1') => ({ id: path, path, albumId, tags });

describe('merging albums (first ticked is the target)', () => {
  const target = [
    song('UL/01.flac', { title: 'All I Want', album: 'Underground Luxury', albumArtist: 'B.o.B', artist: 'B.o.B', year: '2013' }),
    song('UL/03.flac', { title: 'Paper Route', album: 'Underground Luxury', albumArtist: 'B.o.B', artist: 'B.o.B', year: '2013' }),
  ];

  test('the target is what most of its own songs say', () => {
    const odd = song('UL/04.flac', { album: 'Underground Luxury (Deluxe)', albumArtist: 'B.o.B', year: '2014' });
    expect(albumTarget([...target, odd], { title: 'x', artist: 'y' })).toEqual({ album: 'Underground Luxury', albumArtist: 'B.o.B', year: '2013' });
  });

  test('falls back to Artist, then to the library, when the files have no album artist', () => {
    expect(albumTarget([song('a.mp3', { artist: 'Solo' })], { title: 'T', artist: 'Lib', year: 1999 })).toEqual({ album: 'T', albumArtist: 'Solo', year: '1999' });
    expect(albumTarget([song('a.mp3', {})], { title: 'T', artist: 'Lib' })).toEqual({ album: 'T', albumArtist: 'Lib', year: undefined });
  });

  test('only the tags that differ change, on the other albums’ songs', () => {
    const t = albumTarget(target, { title: '', artist: '' });
    const others = [
      song('UL clean/02.flac', { title: 'One Day', album: 'Underground Luxury (Clean)', albumArtist: 'B.o.B', artist: 'B.o.B', year: '2013' }, 'a2'),
      song('UL clean/05.flac', { title: 'Same', album: 'Underground Luxury', albumArtist: 'B.o.B', year: '2013' }, 'a2'),
      song('Other/06.flac', { title: 'Late', album: 'UL', albumArtist: 'Bobby Ray', year: '2012' }, 'a3'),
    ];
    const plan = planAlbumMerge(t, others);
    expect(plan.map((c) => [c.song.path, c.tags])).toEqual([
      ['UL clean/02.flac', { album: 'Underground Luxury' }],
      ['Other/06.flac', { album: 'Underground Luxury', albumArtist: 'B.o.B', year: '2013' }],
    ]);
  });

  test('a target without a year leaves the others’ years alone', () => {
    const plan = planAlbumMerge({ album: 'A', albumArtist: 'B', year: undefined }, [song('x.mp3', { album: 'A2', albumArtist: 'B', year: '2001' })]);
    expect(plan[0].tags).toEqual({ album: 'A' });
  });
});

describe('merging artists', () => {
  test('renames the whole value and shared credits, not other words', () => {
    expect(renameArtist('Bobby Ray', 'Bobby Ray', 'B.o.B', true)).toBe('B.o.B');
    expect(renameArtist('Bobby Ray feat. T.I.', 'Bobby Ray', 'B.o.B', true)).toBe('B.o.B feat. T.I.');
    expect(renameArtist('Bobby Rayford', 'Bobby Ray', 'B.o.B', true)).toBe('Bobby Rayford');
    expect(renameArtist('Bobby Ray feat. T.I.', 'Bobby Ray', 'B.o.B', false)).toBe('Bobby Ray feat. T.I.');
  });

  test('every other artist becomes the target, in Artist and Album artist', () => {
    const songs = [
      song('1.mp3', { artist: 'Bobby Ray', albumArtist: 'Bobby Ray' }),
      song('2.mp3', { artist: 'BoB & Future', albumArtist: 'BoB' }),
      song('3.mp3', { artist: 'B.o.B', albumArtist: 'B.o.B' }),
    ];
    const plan = planArtistMerge('B.o.B', ['Bobby Ray', 'BoB', 'b.o.b'], songs);
    expect(plan.map((c) => [c.song.path, c.tags])).toEqual([
      ['1.mp3', { artist: 'B.o.B', albumArtist: 'B.o.B' }],
      ['2.mp3', { artist: 'B.o.B & Future', albumArtist: 'B.o.B' }],
    ]);
  });
});

describe('splitting joined credits', () => {
  test('finds the artists in a ";" or " / " credit and leaves single names alone', () => {
    expect(splitCredit('Lil Baby;Jeremih')).toEqual(['Lil Baby', 'Jeremih']);
    expect(splitCredit('Lil Baby; Jeremih; Future')).toEqual(['Lil Baby', 'Jeremih', 'Future']);
    expect(splitCredit('Lil Baby / Jeremih')).toEqual(['Lil Baby', 'Jeremih']);
    expect(splitCredit('AC/DC')).toBeNull();
    expect(splitCredit('Lil Baby')).toBeNull();
  });
  test('offers the first artist alone, featuring the rest, or all of them', () => {
    expect(splitCreditOptions(['Lil Baby', 'Jeremih'])).toEqual(['Lil Baby', 'Lil Baby feat. Jeremih', 'Lil Baby & Jeremih']);
    expect(splitCreditOptions(['A', 'B', 'C'])).toEqual(['A', 'A feat. B & C', 'A, B & C']);
  });
  test('the whole joined credit renames to the chosen one', () => {
    expect(renameArtist('Lil Baby;Jeremih', 'Lil Baby;Jeremih', 'Lil Baby', true)).toBe('Lil Baby');
    expect(renameArtist('Lil Baby', 'Lil Baby;Jeremih', 'Lil Baby', true)).toBe('Lil Baby');
  });
});

describe('merging a joined credit keeps the featured artists (Main feat. X)', () => {
  test('into one of its own artists', () => {
    expect(mergedName('Lil Baby;Jeremih', 'Lil Baby')).toEqual({ artist: 'Lil Baby feat. Jeremih', albumArtist: 'Lil Baby', inCredit: 'Lil Baby; Jeremih' });
    expect(mergedName('A;B;C', 'B')).toEqual({ artist: 'B feat. A; C', albumArtist: 'B', inCredit: 'B; A; C' });
  });

  test('into someone else, or a plain name, is just the target', () => {
    expect(mergedName('Lil Baby;Jeremih', 'Drake').artist).toBe('Drake');
    expect(mergedName('Beatles', 'The Beatles')).toEqual({ artist: 'The Beatles', albumArtist: 'The Beatles', inCredit: 'The Beatles' });
    expect(mergedName('Lil Durk;Lil Durk', 'Lil Durk').artist).toBe('Lil Durk');
  });

  test('songs and albums are retagged that way', () => {
    const plan = planArtistMerge('Lil Baby', ['Lil Baby;Jeremih'], [
      song('a.mp3', { artist: 'Lil Baby;Jeremih', albumArtist: 'Lil Baby;Jeremih' }),
      song('b.mp3', { artist: 'Gunna feat. Lil Baby;Jeremih', albumArtist: 'Gunna' }),
    ]);
    expect(plan.map((c) => c.tags)).toEqual([
      { artist: 'Lil Baby feat. Jeremih', albumArtist: 'Lil Baby' },
      { artist: 'Gunna feat. Lil Baby; Jeremih' },
    ]);
  });

  test('an album target without an album artist takes the main artist of its songs', () => {
    expect(albumTarget([song('a.mp3', { artist: 'Lil Durk feat. Drake' })], { title: 'T', artist: 'x' }).albumArtist).toBe('Lil Durk');
  });
});

describe('Merge into… finds likely duplicates', () => {
  test('artist names alike once case, accents, "The" and "&" are put aside', () => {
    expect(looseKey('The Beatles')).toBe(looseKey('beatles'));
    expect(looseKey('Beyoncé')).toBe(looseKey('Beyonce'));
    expect(looseKey('Simon & Garfunkel')).toBe(looseKey('Simon and Garfunkel'));
    expect(likeness(looseKey('B.o.B'), looseKey('BoB'))).toBe(2);
    expect(likeness(looseKey('Lil Baby'), looseKey('Lil Baby;Jeremih'))).toBe(1);
    expect(likeness(looseKey('Drake'), looseKey('Future'))).toBe(0);
  });

  test('album titles without their edition', () => {
    expect(albumKey('Underground Luxury (Deluxe)')).toBe(albumKey('Underground Luxury'));
    expect(albumKey('Abbey Road - Remastered 2019')).toBe(albumKey('Abbey Road'));
  });
});
