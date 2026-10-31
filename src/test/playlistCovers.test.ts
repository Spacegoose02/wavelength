import { describe, expect, test, vi } from 'vitest';

// the stores persist to localStorage, which the test environment doesn't have
vi.hoisted(() => {
  const m = new Map<string, string>();
  globalThis.localStorage ??= { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 } as Storage;
});
import { mosaicOf, playlistCoverOf, usePlaylistCovers } from '../lib/playlistCovers';
import type { Track } from '../sources/types';
import { useHub } from '../store/hub';

const song = (id: string, artist: string, album: string, coverUrl?: string): Track =>
  ({ id, sourceId: 'nd', kind: 'track', title: `Song ${id}`, artist, album, coverUrl }) as Track;

describe('playlist covers', () => {
  test('the mosaic takes the first four different albums, not four songs from one', () => {
    const tracks = [
      song('1', 'A', 'One', 'u/1'), song('2', 'A', 'One', 'u/2'), // same album, the server names each song's picture
      song('3', 'B', 'Two', 'u/3'), song('4', 'C', 'Three'), // no picture: skipped
      song('5', 'C', 'Four (Deluxe Edition)', 'u/5'), song('6', 'D', 'Five', 'u/6'), song('7', 'E', 'Six', 'u/7'),
    ];
    expect(mosaicOf(tracks)).toEqual(['u/1', 'u/3', 'u/5', 'u/6']);
  });

  test('fewer than four albums show the first one', () => {
    expect(mosaicOf([song('1', 'A', 'One', 'u/1'), song('2', 'B', 'Two', 'u/2')])).toEqual(['u/1']);
    expect(mosaicOf([])).toEqual([]);
  });

  test("the Hub's picture wins over one kept on this device", () => {
    useHub.setState({ url: 'https://hub.example/' });
    usePlaylistCovers.setState({ hub: [], local: { 'wavelength:x': 'data:image/jpeg;base64,AAA' } });
    expect(playlistCoverOf('wavelength:x')).toBe('data:image/jpeg;base64,AAA');
    usePlaylistCovers.setState({ hub: [{ key: 'wavelength:x', url: '/api/art/abc.jpg', updatedAt: 1 }] });
    expect(playlistCoverOf('wavelength:x')).toBe('https://hub.example/api/art/abc.jpg');
    expect(playlistCoverOf('wavelength:y')).toBeUndefined();
    expect(playlistCoverOf(undefined)).toBeUndefined();
  });
});
