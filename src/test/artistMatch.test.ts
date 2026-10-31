import { describe, expect, test } from 'vitest';
import { libraryAlbumsBy, matchArtist, sameNameArtists, type ArtistCandidate } from '../lib/artistMatch';
import type { DeezerResult } from '../sources/deemix';
import type { Album } from '../sources/types';

// Deezer's search for "Drake": a small same-name upload listed before the real one, as in the bug report
const search = [
  { id: 501, name: 'Drake', nb_fan: 1_200, picture_medium: 'https://img.test/501.jpg' },
  { id: 246791, name: 'Drake', nb_fan: 30_000_000 },
  { id: 9, name: 'Drake Bell', nb_fan: 90_000_000 },
  { id: 502, name: 'DRAKE', nb_fan: 40 },
];
const release = (id: number, title: string, artist = 'Drake'): DeezerResult =>
  ({ type: 'album', id, title, artist, link: `https://www.deezer.com/album/${id}`, releaseDate: '2020-01-01', recordType: 'album' }) as DeezerResult;
const album = (title: string, artist = 'Drake'): Album => ({ id: `${artist}/${title}`, sourceId: 'nd', artist, title });
const discographies: Record<number, DeezerResult[]> = {
  501: [release(1, 'The Very Best Of')],
  246791: [release(2, 'Take Care'), release(3, 'Scorpion'), release(4, 'Iceman')],
  502: [release(5, 'Demo')],
};
const releasesOf = async (c: ArtistCandidate) => discographies[c.id] ?? [];

describe('finding a library artist on Deezer', () => {
  test('only exact names count (case, accents and "The" don’t matter), most fans first', () => {
    expect(sameNameArtists('drake', search).map((a) => a.id)).toEqual([246791, 501, 502]);
    expect(sameNameArtists('Beatles', [{ id: 1, name: 'The Beatles', nb_fan: 5 }])[0]?.id).toBe(1);
    expect(sameNameArtists('Nobody', search)).toEqual([]);
    expect(sameNameArtists('', search)).toEqual([]);
  });

  test('the artist with your albums wins, even with fewer fans', async () => {
    const candidates = sameNameArtists('Drake', search);
    const m = await matchArtist(candidates, [album('Take Care'), album('Scorpion')], releasesOf);
    expect(m?.artist.id).toBe(246791);
    expect(m?.sure).toBe(true);
    expect(m?.inLibrary).toBe(2);
    expect(m?.others.map((a) => a.id)).toEqual([501, 502]);

    const small = await matchArtist(candidates, [album('The Very Best Of')], releasesOf);
    expect(small?.artist.id).toBe(501);
    expect(small?.sure).toBe(true);
  });

  test('when none has your albums it’s the one with the most fans, but not sure', async () => {
    const m = await matchArtist(sameNameArtists('Drake', search), [album('Some Mixtape')], releasesOf);
    expect(m?.artist.id).toBe(246791);
    expect(m?.sure).toBe(false);
    // a lone same-name artist without your albums isn't sure either
    const lone = await matchArtist([{ id: 501, name: 'Drake', fans: 1_200 }], [album('Take Care')], releasesOf);
    expect(lone?.sure).toBe(false);
  });

  test('with nothing in the library to check, it’s sure when alone or far ahead on fans', async () => {
    expect((await matchArtist(sameNameArtists('Drake', search), [], releasesOf))?.sure).toBe(true);
    expect((await matchArtist([{ id: 1, name: 'X', fans: 0 }], [], releasesOf))?.sure).toBe(true);
    const close = [{ id: 1, name: 'X', fans: 500 }, { id: 2, name: 'X', fans: 400 }];
    expect((await matchArtist(close, [], releasesOf))?.sure).toBe(false);
  });

  test('a discography that can’t be fetched counts as none of your albums', async () => {
    const m = await matchArtist(sameNameArtists('Drake', search), [album('Take Care')], async () => {
      throw new Error('offline');
    });
    expect(m?.sure).toBe(false);
  });

  test('no candidates, no match', async () => {
    expect(await matchArtist([], [album('Take Care')], releasesOf)).toBeUndefined();
  });

  test('your albums by the artist include ones with guests', () => {
    const lib = [album('Take Care'), album('What a Time to Be Alive', 'Drake & Future'), album('Nothing Was the Same', 'Drake Bell')];
    expect(libraryAlbumsBy('Drake', lib).map((a) => a.title)).toEqual(['Take Care', 'What a Time to Be Alive']);
  });
});
