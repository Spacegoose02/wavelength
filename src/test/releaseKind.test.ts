import { describe, expect, it } from 'vitest';
import { guessKind, kindOfTag, releaseKind, shelves, sortAlbums } from '../lib/releaseKind';
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

  it('reads mixtape and leak tags, MusicBrainz’s "mixtape/street" too', () => {
    expect(kindOfTag('Mixtape')).toBe('mixtape');
    expect(kindOfTag('album; mixtape/street')).toBe('mixtape');
    expect(kindOfTag(['album', 'mixtape/street'])).toBe('mixtape');
    expect(kindOfTag(['compilation', 'mixtape/street'])).toBe('mixtape');
    expect(kindOfTag('leak')).toBe('leak');
    expect(kindOfTag(['Leaks'])).toBe('leak');
  });

  it('spots untagged leaks and mixtapes by title or genre', () => {
    expect(guessKind(al('FOMO (Leaks)'))).toBe('leak');
    expect(guessKind(al('Unreleased Vol. 2'))).toBe('leak');
    expect(guessKind(al('Dark Lane Demo Tapes'))).toBe('mixtape');
    expect(guessKind(al('Dedication 2 (Hosted by DJ Drama)'))).toBe('mixtape');
    expect(guessKind(al('Free Bandz [No DJ]'))).toBe('mixtape');
    expect(guessKind(al('Project Baby', { genres: ['Hip-Hop', 'Mixtape'] }))).toBe('mixtape');
    expect(guessKind(al('Painting Pictures'))).toBeUndefined();
    expect(guessKind(al('Tapestry'))).toBeUndefined();
    expect(guessKind(al('Bleak House'))).toBeUndefined();
  });

  it('lets a title beat a plain "album" tag but not a Single, EP or Compilation one', () => {
    expect(releaseKind(al('FOMO (Leaks)', { trackCount: 14 }))).toBe('leak');
    expect(releaseKind(al('FOMO (Leaks)', { releaseTypes: ['album'], trackCount: 14 }))).toBe('leak');
    expect(releaseKind(al('Song (Leak)', { trackCount: 1 }))).toBe('leak');
    expect(releaseKind(al('Song (Leak)', { releaseTypes: ['single'], trackCount: 1 }))).toBe('single');
    expect(releaseKind(al('Best Of The Mixtapes', { releaseTypes: ['compilation'] }))).toBe('compilation');
    expect(releaseKind(al('Heart Break Kid', { releaseTypes: ['mixtape'], trackCount: 18 }))).toBe('mixtape');
  });

  it('knows soundtracks by tag, title or genre, even on a compilation', () => {
    expect(kindOfTag('compilation; soundtrack')).toBe('soundtrack');
    expect(kindOfTag(['album', 'soundtrack'])).toBe('soundtrack');
    expect(releaseKind(al('Black Panther: The Album (Music From and Inspired By)', { releaseTypes: ['soundtrack'] }))).toBe('soundtrack');
    expect(releaseKind(al('Spider-Man: Into the Spider-Verse (Soundtrack From & Inspired by the Motion Picture)', { compilation: true }))).toBe('soundtrack');
    expect(releaseKind(al('Creed II (Original Score)', { releaseTypes: ['album'] }))).toBe('soundtrack');
    expect(releaseKind(al('Superfly', { genres: ['Soundtrack'] }))).toBe('soundtrack');
    expect(releaseKind(al('Ghost Stories', { trackCount: 9 }))).toBe('album');
    expect(releaseKind(al('Hits OST', { releaseTypes: ['compilation'] }))).toBe('compilation');
  });

  it('puts mixtapes and leaks together on a Leaks & Mixtapes shelf, last', () => {
    const got = shelves([
      al('Project Baby 2', { releaseTypes: ['mixtape'], year: 2017, trackCount: 20 }),
      al('LP', { trackCount: 14, year: 2022 }),
      al('Snippets (Leaks)', { year: 2019, trackCount: 9 }),
      al('Hits', { compilation: true, year: 2020 }),
      al('Creed II (Original Score)', { year: 2018 }),
    ], '');
    expect(got.map((s) => [s.title, s.albums.map((a) => a.title)])).toEqual([
      ['Albums', ['LP']], ['Compilations', ['Hits']], ['Soundtracks', ['Creed II (Original Score)']], ['Leaks & Mixtapes', ['Snippets (Leaks)', 'Project Baby 2']],
    ]);
  });
});
