import { describe, expect, it } from 'vitest';
import { albumOfTrack, artistOfTrack, creditLinks, focusIndex } from '../lib/trackLinks';
import type { Album, Artist, Track } from '../sources/types';

const track = (more: Partial<Track> = {}): Track =>
  ({ kind: 'track', id: 't1', sourceId: 'nd', title: 'NO BYSTANDERS', artist: 'Travis Scott', album: 'ASTROWORLD (Clean)', albumId: 'a1', ...more }) as Track;
const astro: Album = { id: 'p9', sourceId: 'plex', title: 'ASTROWORLD (Clean)', artist: 'Travis Scott', artistId: 'r9', refs: [] };
astro.refs = [astro, { id: 'a1', sourceId: 'nd', title: 'ASTROWORLD (Clean)', artist: 'Travis Scott', artistId: 'r1' }];
const travis: Artist = { id: 'r1', sourceId: 'nd', name: 'Travis Scott' };
const drake: Artist = { id: 'r2', sourceId: 'nd', name: 'Drake' };

describe('Now Playing links', () => {
  it('finds the album by its id on the song\'s server, else by name', () => {
    expect(albumOfTrack(track(), [astro])).toBe(astro);
    expect(albumOfTrack(track({ albumId: 'zz', sourceId: 'other' }), [astro])).toBe(astro);
  });

  it('opens an album the catalog lacks by its id, and nothing for radio or previews', () => {
    expect(albumOfTrack(track({ albumId: 'x', album: 'Rodeo' }), [astro])).toMatchObject({ id: 'x', sourceId: 'nd', title: 'Rodeo' });
    expect(albumOfTrack(track({ kind: 'radio' }), [astro])).toBeUndefined();
    expect(albumOfTrack(track({ sourceId: 'preview' }), [astro])).toBeUndefined();
  });

  it('finds the artist by name, the first of several, or the album\'s artist', () => {
    expect(artistOfTrack(track({ artist: 'travis scott' }), [drake, travis])).toBe(travis);
    expect(artistOfTrack(track({ artist: 'Drake feat. Travis Scott' }), [drake, travis])).toBe(drake);
    expect(artistOfTrack(track({ artist: 'Travis Scott, Drake' }), [drake, travis])).toBe(travis);
    expect(artistOfTrack(track({ artist: 'Unknown' }), [drake, travis], astro)).toBe(travis);
    expect(artistOfTrack(track({ artist: 'Unknown' }), [drake, travis])).toBeUndefined();
  });

  it('flashes the song on the album, by id or by title on another server\'s copy', () => {
    const list = [track({ id: 'a' }), track({ id: 'b', title: 'SKELETONS' })];
    expect(focusIndex(list, { id: 'b', sourceId: 'nd' })).toBe(1);
    expect(focusIndex(list, { id: 'zz', sourceId: 'plex', title: 'Skeletons' })).toBe(1);
    expect(focusIndex(list)).toBe(-1);
  });
});

describe('creditLinks: each artist in a credit', () => {
  const lib = (...names: string[]) => names.map((name, i) => ({ id: `ar${i}`, sourceId: 'nd', name }) as Artist);
  const show = (parts: ReturnType<typeof creditLinks>) => parts.map((p) => (p.name ? `[${p.name}${p.artist ? '' : '?'}]` : p.text)).join('');

  it('cuts "A feat. B; C; D" into four artists, keeping the text between them', () => {
    const parts = creditLinks('Future feat. Drake; Travis Scott; Loe Shimmy', lib('Future', 'Drake', 'Travis Scott'));
    expect(show(parts)).toBe('[Future] feat. [Drake]; [Travis Scott]; [Loe Shimmy?]');
    expect(parts.map((p) => p.text).join('')).toBe('Future feat. Drake; Travis Scott; Loe Shimmy');
    expect(parts.find((p) => p.name === 'Drake')?.artist?.id).toBe('ar1');
  });

  it('keeps a library artist with a comma or "&" whole', () => {
    expect(show(creditLinks('Tyler, The Creator', lib('Tyler, The Creator')))).toBe('[Tyler, The Creator]');
    expect(show(creditLinks('Earth, Wind & Fire feat. Drake', lib('Earth, Wind & Fire')))).toBe('[Earth, Wind & Fire] feat. [Drake?]');
  });

  it('cuts on "&", "," and "x" only when a piece is a library artist', () => {
    expect(show(creditLinks('Simon & Garfunkel', lib()))).toBe('[Simon & Garfunkel?]');
    expect(show(creditLinks('Metro Boomin & Future', lib('Future')))).toBe('[Metro Boomin?] & [Future]');
    expect(show(creditLinks('Drake, 21 Savage', lib('Drake')))).toBe('[Drake], [21 Savage?]');
  });

  it('reads a bracketed "(feat. X)" and a " / " join', () => {
    expect(show(creditLinks('Future (feat. Drake)', lib('Future', 'Drake')))).toBe('[Future] (feat. [Drake])');
    expect(show(creditLinks('Future / Drake', lib()))).toBe('[Future?] / [Drake?]');
  });

  it('matches names as the catalog merges them', () => {
    expect(creditLinks('the weeknd feat. DRAKE', lib('The Weeknd', 'Drake')).filter((p) => p.artist)).toHaveLength(2);
  });
});
