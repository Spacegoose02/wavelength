import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { albumGenres, decadeCounts, decadeLabel, decadeOf, findGenre, genreCounts, genreTree, queryAlbums, queryArtists, splitGenres, tagCounts } from '../lib/browse';
import { albumKey, tagKey, useItemTagStore } from '../lib/itemTags';
import type { Album, Artist } from '../sources/types';

let n = 0;
const album = (artist: string, title: string, year?: number, genres: string[] = [], extra: Partial<Album> = {}): Album =>
  ({ id: `a${n++}`, sourceId: 'nd', artist, title, year, genres, ...extra }) as Album;
const artist = (name: string): Artist => ({ id: name, sourceId: 'nd', name }) as Artist;

describe('browsing by genre, decade and year', () => {
  test('genre tags split on ";" and lose repeats', () => {
    expect(splitGenres('Pop; Dance;pop')).toEqual(['Pop', 'Dance']);
    expect(splitGenres(['Rap', 'Hip-Hop', ''])).toEqual(['Rap', 'Hip-Hop']);
    expect(splitGenres(undefined)).toEqual([]);
  });

  test('an album found on two servers has the genres of both', () => {
    const a = album('X', 'Y', 2001, ['Rock']);
    a.refs = [a, { ...a, sourceId: 'plex', genres: ['Indie Rock', 'rock'] }];
    expect(albumGenres(a)).toEqual(['Rock', 'Indie Rock']);
  });

  test('decades', () => {
    expect(decadeOf(1994)).toBe(1990);
    expect(decadeOf(2020)).toBe(2020);
    expect(decadeOf(0)).toBeUndefined();
    expect(decadeOf(undefined)).toBeUndefined();
    expect(decadeLabel(1980)).toBe('80s');
    expect(decadeLabel(2010)).toBe('2010s');
    expect(decadeCounts([album('a', 'a', 1985), album('b', 'b', 1989), album('c', 'c', 2003), album('d', 'd')])).toEqual([
      { decade: 1980, albums: 2 },
      { decade: 2000, albums: 1 },
    ]);
  });

  test('genre counts go by album, most first, whatever the spelling', () => {
    const list = [album('a', 'a', 2000, ['Hip-Hop']), album('b', 'b', 2000, ['hip hop']), album('c', 'c', 2000, ['Hip-Hop', 'Pop'])];
    expect(genreCounts(list)).toEqual([{ name: 'Hip-Hop', albums: 3 }, { name: 'Pop', albums: 1 }]);
  });

  const lib = [
    album('Drake', 'Views', 2016, ['Rap', 'Hip-Hop', 'Trap'], { addedAt: 3 }),
    album('Nas', 'Illmatic', 1994, ['Rap', 'Hip-Hop', 'Boom Bap'], { addedAt: 1 }),
    album('Nas', 'Stillmatic', 2001, ['Rap', 'Hip-Hop'], { addedAt: 2 }),
    album('Daft Punk', 'Discovery', 2001, ['Electronic', 'House']),
    album('Daft Punk', 'Homework', 1997, ['Electronic', 'House']),
    album('Burial', 'Untrue', 2007, ['Electronic', 'UK Garage']),
    album('Someone', 'No Year', undefined, ['Pop']),
  ];

  test('filter albums by genre, decade and years, and sort them', () => {
    expect(queryAlbums(lib, { genre: 'hip hop' }).map((a) => a.title)).toEqual(['Illmatic', 'Stillmatic', 'Views']);
    expect(queryAlbums(lib, { decade: 2000 }, 'artist').map((a) => a.title)).toEqual(['Untrue', 'Discovery', 'Stillmatic']);
    expect(queryAlbums(lib, { from: 1995, to: 2001 }, 'oldest').map((a) => a.title)).toEqual(['Homework', 'Discovery', 'Stillmatic']);
    expect(queryAlbums(lib, { genre: 'Electronic', decade: 1990 }).map((a) => a.title)).toEqual(['Homework']);
    expect(queryAlbums(lib, {}, 'newest').map((a) => a.title)).toEqual(['Views', 'Untrue', 'Discovery', 'Stillmatic', 'Homework', 'Illmatic', 'No Year']);
    expect(queryAlbums(lib, {}, 'oldest').slice(-1)[0].title).toBe('No Year');
    expect(queryAlbums(lib, { genre: 'Rap' }, 'added').map((a) => a.title)).toEqual(['Views', 'Stillmatic', 'Illmatic']);
  });

  test('artists match through their albums', () => {
    const artists = [artist('Nas'), artist('Daft Punk'), artist('Drake'), artist('Burial'), artist('Nobody')];
    expect(queryArtists(artists, lib, { genre: 'House' }).map((a) => a.name)).toEqual(['Daft Punk']);
    expect(queryArtists(artists, lib, { decade: 1990 }).map((a) => a.name)).toEqual(['Daft Punk', 'Nas']);
    expect(queryArtists(artists, lib, {}, 'albums').map((a) => a.name).slice(0, 2)).toEqual(['Daft Punk', 'Nas']);
    expect(queryArtists(artists, lib, {}).length).toBe(5);
  });

  test('sub-genres sit inside the genre their albums are all in; genres always together are one', () => {
    const tree = genreTree(lib);
    expect(tree.map((g) => [g.label, g.albums])).toEqual([['Electronic', 3], ['Rap / Hip-Hop', 3], ['Pop', 1]]);
    expect(tree[0].subs.map((s) => [s.label, s.albums])).toEqual([['House', 2], ['UK Garage', 1]]);
    expect(tree[1].subs.map((s) => s.label)).toEqual(['Boom Bap', 'Trap']);
    expect(findGenre(tree, 'house')?.parent?.label).toBe('Electronic');
    expect(findGenre(tree, 'Electronic')?.parent).toBeUndefined();
    expect(findGenre(tree, 'Polka')).toBeUndefined();
    const metal = genreTree([album('Metallica', 'Master of Puppets', 1986, ['Metal', 'Thrash Metal'])]);
    expect(metal.map((g) => [g.label, g.subs.map((s) => s.label)])).toEqual([['Metal', ['Thrash Metal']]]);
  });
});

describe('browsing by style, mood and collection (kept on the Hub)', () => {
  const tag = (kind: 'album' | 'artist', artist: string, title: string, facets: Record<string, string[]>) =>
    ({ kind, artist, title, facets, sources: {}, updatedAt: 1 });
  const lib = [
    album('*NSYNC', 'Home for Christmas', 1998, ['Christmas']),
    album('NSYNC', 'Celebrity', 2001, ['Pop']),
    album('Lil Baby', 'It’s Only Me', 2022, ['Rap']),
    album('Mariah Carey', 'Merry Christmas', 1994, ['Pop']),
  ];
  beforeEach(() => {
    useItemTagStore.setState({
      albums: {
        [albumKey('NSYNC', 'Home for Christmas')]: tag('album', 'NSYNC', 'Home for Christmas', { style: ['Christmas Pop'], mood: ['Warm'] }),
        [albumKey('Lil Baby', 'Its Only Me')]: tag('album', 'Lil Baby', 'Its Only Me', { style: ['Southern Rap', 'Trap (Rap)'], mood: ['Druggy'] }),
        [albumKey('Mariah Carey', 'Merry Christmas')]: tag('album', 'Mariah Carey', 'Merry Christmas', { collection: ['Christmas'] }),
      },
      artists: { [tagKey('NSYNC')]: tag('artist', 'NSYNC', '', { genre: ['Pop'], style: ['Teen Pop'], mood: ['Cheerful'], collection: ['Boy Bands'] }) },
    } as never);
  });
  afterEach(() => useItemTagStore.setState({ albums: {}, artists: {} } as never));

  test('albums by their own style, else their artist’s; collections add the artist’s', () => {
    expect(queryAlbums(lib, { style: 'southern rap' }).map((a) => a.title)).toEqual(['It’s Only Me']);
    expect(queryAlbums(lib, { style: 'Christmas Pop' }).map((a) => a.title)).toEqual(['Home for Christmas']);
    // Celebrity has no styles of its own: it takes *NSYNC's
    expect(queryAlbums(lib, { style: 'Teen Pop' }).map((a) => a.title)).toEqual(['Celebrity']);
    expect(queryAlbums(lib, { collection: 'boy bands' }).map((a) => a.title)).toEqual(['Celebrity', 'Home for Christmas']);
    expect(queryAlbums(lib, { collection: 'Christmas', decade: 1990 }).map((a) => a.title)).toEqual(['Merry Christmas']);
    expect(queryAlbums(lib, { mood: 'Warm', genre: 'Christmas' }).map((a) => a.title)).toEqual(['Home for Christmas']);
    expect(tagCounts(lib, 'mood')).toEqual([{ name: 'Cheerful', albums: 1 }, { name: 'Druggy', albums: 1 }, { name: 'Warm', albums: 1 }]);
  });

  test('an artist shows for their own genres from the Hub, even when their albums have others', () => {
    const people = [artist('NSYNC'), artist('Lil Baby')];
    expect(queryArtists(people, [album('NSYNC', 'Home for Christmas', 1998, ['Christmas'])], { genre: 'Pop' }).map((a) => a.name)).toEqual(['NSYNC']);
    // with a year, it's their albums that count
    expect(queryArtists(people, [album('NSYNC', 'Home for Christmas', 1998, ['Christmas'])], { genre: 'Pop', decade: 1990 })).toEqual([]);
  });
});
