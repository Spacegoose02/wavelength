import { beforeEach, describe, expect, test } from 'vitest';
import { isCleanEdition } from '../lib/explicitCheck';
import { albumNotForKids, albumVersion, explicitOfAlbum, explicitOfTrack, flagOn, trackNotForKids, trackVersion, useFlags, useRatings } from '../lib/kids';
import { versionOf } from '../lib/versions';
import { mergeAlbums } from '../sources/registry';
import type { Album, Track } from '../sources/types';

const rating = (kind: 'album' | 'track', title = '') =>
  ({ kind, artist: 'Rihanna', album: 'Loud', title, rating: 'explicit', cleanLink: null, checkedAt: 0 }) as const;

describe('clean versions next to a checked explicit album', () => {
  beforeEach(() => useRatings.setState({ ratings: [rating('album'), rating('track', 'S&M')] }));

  test('the explicit album and its explicit songs stay explicit', () => {
    expect(explicitOfAlbum({ artist: 'Rihanna', title: 'Loud' })).toBe('explicit');
    expect(explicitOfTrack({ artist: 'Rihanna', album: 'Loud', title: 'S&M' })).toBe('explicit');
    expect(explicitOfTrack({ artist: 'Rihanna', album: 'Loud', title: 'Only Girl' })).toBe('clean');
  });

  test('"(Clean)" in the album title wins over the explicit album’s rating', () => {
    expect(explicitOfAlbum({ artist: 'Rihanna', title: 'Loud (Clean)' })).toBe('clean');
    expect(explicitOfTrack({ artist: 'Rihanna', album: 'Loud (Clean)', title: 'S&M' })).toBe('clean');
    expect(explicitOfTrack({ artist: 'Rihanna', album: 'Loud [Edited]', title: 'S&M' })).toBe('clean');
    expect(versionOf({ artist: 'Rihanna', title: 'Loud (Clean)' } as Album)).toBe('clean');
  });

  test('a song file tagged explicit stays explicit', () => {
    expect(explicitOfTrack({ artist: 'Rihanna', album: 'Loud (Clean)', title: 'S&M', explicit: 'explicit' })).toBe('explicit');
  });
});

describe('admin flags', () => {
  test('hiding the explicit album from kids doesn’t hide its clean version', async () => {
    const { useFlags, albumNotForKids } = await import('../lib/kids');
    useRatings.setState({ ratings: [] });
    useFlags.setState({ flags: [{ id: 1, kind: 'album', artist: 'Rihanna', title: 'Loud', verdict: 'block' } as never] });
    expect(albumNotForKids({ artist: 'Rihanna', title: 'Loud' } as Album)).toBe(true);
    expect(albumNotForKids({ artist: 'Rihanna', title: 'Loud (Clean)' } as Album)).toBe(false);
  });
});

describe('explicit and clean copies of the same album, flagged separately', () => {
  const t = (album: string, title: string, explicit?: 'explicit' | 'clean') => ({ kind: 'track', id: `${album}/${title}`, sourceId: 'nd', artist: 'Rihanna', album, title, explicit }) as Track;
  const flag = (id: number, kind: string, title: string, verdict: string, version?: string) => ({ id, kind, artist: 'Rihanna', title, verdict, version }) as never;
  beforeEach(() => useRatings.setState({ ratings: [rating('album'), rating('track', 'S&M')] }));

  test('"OK for kids" on the clean version’s song leaves the explicit song hidden', () => {
    useFlags.setState({ flags: [flag(1, 'track', 'S&M', 'allow', trackVersion(t('Loud (Clean)', 'S&M')))] });
    expect(trackNotForKids(t('Loud (Clean)', 'S&M'))).toBe(false);
    expect(trackNotForKids(t('Loud', 'S&M'))).toBe(true);
    expect(trackNotForKids(t('Loud', 'S&M', 'explicit'))).toBe(true);
  });

  test('one album with songs tagged explicit and clean is one album: a flag on it covers all its songs', () => {
    expect(trackVersion(t('Underground Luxury', 'One Day', 'clean'))).toBe('');
    expect(trackVersion(t('Underground Luxury', 'Ready', 'explicit'))).toBe('');
    useFlags.setState({ flags: [flag(1, 'album', 'Underground Luxury', 'block', '')] });
    expect(trackNotForKids(t('Underground Luxury', 'One Day', 'clean'))).toBe(true);
    useFlags.setState({ flags: [] });
    // and its clean song is fine for kids on its own
    expect(trackNotForKids(t('Underground Luxury', 'One Day', 'clean'))).toBe(false);
  });

  test('a flag 0.17.2 saved as "explicit" counts for the song as a whole', () => {
    useFlags.setState({ flags: [flag(1, 'track', 'S&M', 'allow', 'explicit')] });
    expect(trackNotForKids(t('Loud', 'S&M', 'explicit'))).toBe(false);
    expect(trackNotForKids(t('Loud (Clean)', 'S&M'))).toBe(false);
    expect(flagOn('track', 'Rihanna', 'S&M', '')?.id).toBe(1);
  });

  test('hiding the clean version hides only it; "every version" hides both', () => {
    useFlags.setState({ flags: [flag(1, 'album', 'Loud (Clean)', 'block', 'clean')] });
    expect(albumNotForKids({ artist: 'Rihanna', title: 'Loud (Clean)' } as Album)).toBe(true);
    expect(trackNotForKids(t('Loud (Clean)', 'Only Girl'))).toBe(true);
    useFlags.setState({ flags: [flag(1, 'track', 'Only Girl', 'block', 'any')] });
    expect(trackNotForKids(t('Loud (Clean)', 'Only Girl'))).toBe(true);
    expect(trackNotForKids(t('Loud', 'Only Girl'))).toBe(true);
  });

  test('a song tagged explicit is hidden even in a "(Clean)" album', () => {
    useFlags.setState({ flags: [] });
    expect(trackNotForKids(t('Loud (Clean)', 'S&M', 'explicit'))).toBe(true);
  });

  test('the admin button finds the flag for the version on screen only', () => {
    useFlags.setState({ flags: [flag(1, 'album', 'Loud (Clean)', 'allow', 'clean')] });
    expect(flagOn('album', 'Rihanna', 'Loud (Clean)', 'clean')?.id).toBe(1);
    expect(flagOn('album', 'Rihanna', 'Loud', '')).toBeUndefined();
    expect(albumVersion({ title: 'Loud (Clean)' })).toBe('clean');
    expect(albumVersion({ title: 'Loud' })).toBe('');
  });

  test('a flag from an older Hub (no version): "(Clean)" in its title makes it the clean version’s', () => {
    useFlags.setState({ flags: [flag(1, 'album', 'Loud (Clean)', 'block')] });
    expect(albumNotForKids({ artist: 'Rihanna', title: 'Loud (Clean)' } as Album)).toBe(true);
    expect(trackNotForKids(t('Loud', 'Only Girl'))).toBe(false);
  });
});

describe('the library check’s clean version', () => {
  const tracks = (...t: [string, boolean][]) => ({ data: t.map(([title, explicit_lyrics]) => ({ title, explicit_lyrics })) });
  test('only an edited release with no explicit songs counts', () => {
    expect(isCleanEdition({ explicit_lyrics: false, explicit_content_lyrics: 3, tracks: tracks(['S&M', false]) }, ['S&M'])).toBe(true);
    // the explicit album's explicit songs are on it, none explicit
    expect(isCleanEdition({ explicit_lyrics: false, explicit_content_lyrics: 0, tracks: tracks(['S&M', false], ['Only Girl', false]) }, ['S&M'])).toBe(true);
    // a different release with the same title
    expect(isCleanEdition({ explicit_lyrics: false, explicit_content_lyrics: 0, tracks: tracks(['Intro', false]) }, ['S&M'])).toBe(false);
    // an explicit song on it
    expect(isCleanEdition({ explicit_lyrics: false, explicit_content_lyrics: 3, tracks: tracks(['S&M', true]) }, ['S&M'])).toBe(false);
    expect(isCleanEdition({ explicit_lyrics: false, explicit_content_lyrics: 4, tracks: tracks(['S&M', false]) }, ['S&M'])).toBe(false);
    expect(isCleanEdition({ error: { message: 'no' } }, ['S&M'])).toBe(false);
  });
});

describe('albums Navidrome lists in parts', () => {
  const part = (id: string, explicit?: 'explicit' | 'clean', title = 'Underground Luxury') => ({ id, sourceId: 'nd', artist: 'B.o.B', title, explicit }) as Album;
  test('a part tagged clean (its only song is clean) stays with the explicit album, and isn’t a clean version', () => {
    useRatings.setState({ ratings: [] });
    const merged = mergeAlbums([[part('a', 'explicit'), part('b', 'clean')]]);
    expect(merged.map((x) => x.refs!.length)).toEqual([2]);
    expect(versionOf(part('b', 'clean'))).toBeUndefined();
    expect(versionOf(part('a', 'explicit'))).toBe('explicit');
    expect(versionOf(part('c', undefined, 'Underground Luxury (Clean)'))).toBe('clean');
    expect(albumVersion(part('b', 'clean'))).toBe('');
  });
  test('across servers too', () => {
    const a = (sourceId: string, explicit?: 'explicit' | 'clean') => ({ id: sourceId, sourceId, artist: 'Rihanna', title: 'Loud', explicit }) as Album;
    expect(mergeAlbums([[a('nd', 'explicit')], [a('plex')], [a('nd2', 'clean')]]).map((x) => x.refs!.length)).toEqual([3]);
  });
});
