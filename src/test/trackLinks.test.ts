import { describe, expect, it } from 'vitest';
import { albumOfTrack, artistOfTrack, focusIndex } from '../lib/trackLinks';
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
