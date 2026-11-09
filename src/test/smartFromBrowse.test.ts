import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { albumKey, useItemTagStore } from '../lib/itemTags';
import { albumFits, byAlbum, describe as say, fromBrowse } from '../lib/smartPlaylists';
import type { Album } from '../sources/types';

const album = (artist: string, title: string, year: number, genres: string[]) => ({ id: title, sourceId: 'nd', artist, title, year, genres }) as Album;

describe('smart playlists from Browse', () => {
  beforeEach(() => useItemTagStore.setState({
    albums: {
      [albumKey('NSYNC', 'Home for Christmas')]: { kind: 'album', artist: 'NSYNC', title: 'Home for Christmas', facets: { style: ['Christmas Pop'], collection: ['Christmas'] }, sources: {}, updatedAt: 1 },
      [albumKey('Lil Baby', 'It’s Only Me')]: { kind: 'album', artist: 'Lil Baby', title: 'It’s Only Me', facets: { style: ['Southern Rap'], mood: ['Reckless'] }, sources: {}, updatedAt: 1 },
    },
    artists: {},
  } as never));
  afterEach(() => useItemTagStore.setState({ albums: {}, artists: {} } as never));

  test('a decade, genre, style, mood or collection becomes the rules', () => {
    const p = fromBrowse({ decade: 1980, genre: 'Pop' }, '80s Pop');
    expect(p).toMatchObject({ name: '80s Pop', genres: ['Pop'], fromYear: 1980, toYear: 1989 });
    expect(byAlbum(p)).toBe(false);
    const x = fromBrowse({ collection: 'Christmas', mood: 'Warm', style: 'Christmas Pop' }, 'Christmas');
    expect(x).toMatchObject({ collections: ['Christmas'], tagMoods: ['Warm'], styles: ['Christmas Pop'] });
    expect(byAlbum(x)).toBe(true);
    // a mood or style can be the album's or a song's own, so it becomes advanced rules that say either
    expect(say(x)).toContain('Album collection is Christmas');
    expect(say(x)).toContain('any of (Album mood is Warm, Track mood is Warm)');
    expect(fromBrowse({ collection: 'Christmas' }, 'x').rules).toBeUndefined();
  });

  test('albums fit by genre, year, style, mood and collection, and a collection can be left out', () => {
    const xmas = album('*NSYNC', 'Home for Christmas', 1998, ['Christmas', 'Pop']);
    const baby = album('Lil Baby', 'It’s Only Me', 2022, ['Rap']);
    const base = fromBrowse({}, 'x');
    expect(albumFits({ ...base, styles: ['southern rap'] }, baby)).toBe(true);
    expect(albumFits({ ...base, styles: ['southern rap'] }, xmas)).toBe(false);
    expect(albumFits({ ...base, genres: ['Pop'], notCollections: ['Christmas'] }, xmas)).toBe(false);
    expect(albumFits({ ...base, genres: ['Rap; Hip-Hop'], notCollections: ['Christmas'] }, baby)).toBe(true);
    expect(albumFits({ ...base, fromYear: 1990, toYear: 1999, collections: ['Christmas'] }, xmas)).toBe(true);
    expect(albumFits({ ...base, fromYear: 2000 }, xmas)).toBe(false);
  });
});
