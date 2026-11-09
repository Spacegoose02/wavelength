import { describe, expect, it } from 'vitest';
import { kindOfTag, releaseKind, shelves, sortAlbums } from '../lib/releaseKind';
import type { Album } from '../sources/types';

const al = (title: string, extra: Partial<Album> = {}): Album => ({ id: title, sourceId: 'nd', title, artist: 'Kodak Black', ...extra });

describe('artist page shelves', () => {
  it('reads release type tags', () => {
    expect(kindOfTag('Single')).toBe('single');
    expect(kindOfTag(['album', 'compilation'])).toBe('compilation');
    expect(kindOfTag('album; live')).toBe('album');
    expect(kindOfTag('')).toBeUndefined();
    expect(kindOfTag(['live'])).toBeUndefined();
  });

  it('uses the tag, else Navidrome’s compilation flag, else the song count', () => {
    expect(releaseKind(al('Senseless', { releaseTypes: ['single'], trackCount: 12 }))).toBe('single');
    expect(releaseKind(al('Hits', { compilation: true, trackCount: 20 }))).toBe('compilation');
    expect(releaseKind(al('These Streets', { trackCount: 1 }))).toBe('single');
    expect(releaseKind(al('Walk/Spin', { trackCount: 5 }))).toBe('ep');
    expect(releaseKind(al('Just Getting Started', { trackCount: 16 }))).toBe('album');
    expect(releaseKind(al('Unknown'))).toBe('album');
  });

  it('orders albums as the artist’s setting says', () => {
    const list = [al('B', { year: 2018 }), al('a', { year: 2025 }), al('C')];
    expect(sortAlbums(list, '').map((a) => a.title)).toEqual(['a', 'B', 'C']);
    expect(sortAlbums(list, 'oldest').map((a) => a.title)).toEqual(['B', 'a', 'C']);
    expect(sortAlbums(list, 'title').map((a) => a.title)).toEqual(['a', 'B', 'C']);
  });

  it('cuts albums into Albums, Singles & EPs and Compilations, leaving out empty shelves', () => {
    const got = shelves([al('Single', { trackCount: 1, year: 2024 }), al('LP', { trackCount: 14, year: 2022 }), al('EP', { releaseTypes: ['EP'], year: 2025 })], '');
    expect(got.map((s) => [s.title, s.albums.map((a) => a.title)])).toEqual([['Albums', ['LP']], ['Singles & EPs', ['EP', 'Single']]]);
  });
});
