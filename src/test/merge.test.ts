import { describe, expect, test } from 'vitest';
import { albumTarget, planAlbumMerge, planArtistMerge, renameArtist } from '../lib/merge';
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
