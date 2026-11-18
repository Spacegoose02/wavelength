import { describe, expect, test } from 'vitest';
import { type BulkSong, planBulkAlbumEdit, stripArtistPrefix } from '../lib/bulkAlbumEdit';

const song = (albumId: string, path: string, tags: BulkSong['tags']): BulkSong => ({ albumId, path, tags });

const carter3 = [
  song('a1', 'Lil Wayne/Carter III/01.flac', { album: 'Lil Wayne - Tha Carter III', albumArtist: 'Lil Wayne', genre: 'Rap', releaseType: 'album' }),
  song('a1', 'Lil Wayne/Carter III/02.flac', { album: 'Lil Wayne - Tha Carter III', albumArtist: 'Lil Wayne', genre: 'Rap', releaseType: 'album' }),
];
const noCeilings = [
  song('a2', 'Lil Wayne/No Ceilings/01.mp3', { album: 'No Ceilings', albumArtist: 'Lil Wayne', genre: 'Hip-Hop' }),
];
const sorry = [
  song('a3', 'Lil Wayne/Sorry 4 the Wait/01.m4a', { album: 'lil wayne – Sorry 4 the Wait', artist: 'Lil Wayne' }),
];
const all = [...carter3, ...noCeilings, ...sorry];

describe('stripArtistPrefix', () => {
  test('takes "Artist - " off, any dash and case', () => {
    expect(stripArtistPrefix('Lil Wayne - Tha Carter III', ['Lil Wayne'])).toBe('Tha Carter III');
    expect(stripArtistPrefix('lil wayne – Sorry 4 the Wait', ['Lil Wayne'])).toBe('Sorry 4 the Wait');
    expect(stripArtistPrefix('Lil Wayne-Lights Out', ['Lil Wayne'])).toBe('Lights Out');
  });
  test('leaves titles that only start with the name, or would be empty', () => {
    expect(stripArtistPrefix('Lil Wayne Live', ['Lil Wayne'])).toBeUndefined();
    expect(stripArtistPrefix('Lil Wayne - ', ['Lil Wayne'])).toBeUndefined();
    expect(stripArtistPrefix('Drake - Views', ['Lil Wayne', undefined])).toBeUndefined();
  });
  test('names with regex characters', () => {
    expect(stripArtistPrefix('A$AP Rocky - Testing', ['A$AP Rocky'])).toBe('Testing');
  });
});

describe('planBulkAlbumEdit', () => {
  test('a release type goes on every song that has another, except .m4a', () => {
    const p = planBulkAlbumEdit(all, { releaseType: 'mixtape' });
    expect(p.changes.map((c) => c.path)).toEqual([carter3[0].path, carter3[1].path, noCeilings[0].path]);
    expect(p.changes.every((c) => c.tags.releaseType === 'mixtape')).toBe(true);
    expect(p.albums).toBe(2);
  });
  test('only what differs is written', () => {
    const p = planBulkAlbumEdit(all, { releaseType: 'album', albumArtist: 'Lil Wayne' });
    // Carter III has both already; No Ceilings needs the type; Sorry needs the album artist but can't hold the type
    expect(p.changes).toEqual([
      { path: noCeilings[0].path, tags: { releaseType: 'album' } },
      { path: sorry[0].path, tags: { albumArtist: 'Lil Wayne' } },
    ]);
  });
  test('empty fields keep each album as it is', () => {
    expect(planBulkAlbumEdit(all, { albumArtist: '  ', year: '', label: '' }).changes).toEqual([]);
  });
  test('genres: add keeps what each album has, replace swaps them', () => {
    const add = planBulkAlbumEdit(all, { genres: { mode: 'add', values: ['Hip-Hop'] } });
    expect(add.changes.map((c) => c.tags.genre)).toEqual(['Rap; Hip-Hop', 'Rap; Hip-Hop', 'Hip-Hop']);
    const replace = planBulkAlbumEdit(all, { genres: { mode: 'replace', values: ['Rap'] } });
    expect(replace.changes.map((c) => [c.path, c.tags.genre])).toEqual([[noCeilings[0].path, 'Rap'], [sorry[0].path, 'Rap']]);
  });
  test('stripping the prefix renames each album once, using the library artist when the tag is missing', () => {
    const p = planBulkAlbumEdit(all, { stripArtistPrefix: true }, (id) => (id === 'a3' ? 'Lil Wayne' : undefined));
    expect(p.changes.map((c) => c.tags.album)).toEqual(['Tha Carter III', 'Tha Carter III', 'Sorry 4 the Wait']);
    expect(p.renames).toEqual([
      { albumId: 'a1', from: 'Lil Wayne - Tha Carter III', to: 'Tha Carter III', artist: 'Lil Wayne' },
      { albumId: 'a3', from: 'lil wayne – Sorry 4 the Wait', to: 'Sorry 4 the Wait', artist: 'Lil Wayne' },
    ]);
  });
  test('the prefix can be the old album artist while a new one is set', () => {
    const p = planBulkAlbumEdit(carter3, { stripArtistPrefix: true, albumArtist: 'Weezy' });
    expect(p.changes[0].tags).toEqual({ albumArtist: 'Weezy', album: 'Tha Carter III' });
    expect(p.renames[0].artist).toBe('Weezy');
  });
});
