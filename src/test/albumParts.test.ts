import { afterEach, describe, expect, test, vi } from 'vitest';
import { loadParts } from '../lib/albumParts';
import { getJson } from '../lib/http';
import type { Track } from '../sources/types';

const t = (id: string, trackNumber: number) => ({ id, title: id, trackNumber }) as Track;

describe('album parts', () => {
  test('parts load together, in track order', async () => {
    const parts: Record<string, Track[]> = { a: [t('3', 3), t('1', 1)], b: [t('2', 2)] };
    const r = await loadParts(['a', 'b'], async (id) => parts[id]);
    expect(r.tracks.map((x) => x.id)).toEqual(['1', '2', '3']);
    expect(r.failed).toBeUndefined();
  });

  test('a part that fails leaves the rest of the album showing', async () => {
    const r = await loadParts(['a', 'b'], async (id) => {
      if (id === 'b') throw new Error('broken reply');
      return [t('1', 1)];
    });
    expect(r.tracks.map((x) => x.id)).toEqual(['1']);
    expect(r.failed).toBe('broken reply');
  });

  test('only fails when no part loads', async () => {
    await expect(loadParts(['a'], async () => { throw new Error('nope'); })).rejects.toThrow('nope');
  });
});

describe('getJson', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('a reply cut short names where it came from, without the token', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"subsonic-response":{"status":"ok","album"', { status: 200 }));
    await expect(getJson('https://music.example/rest/getAlbum?t=secret&id=1')).rejects.toThrow(/Couldn't read the reply from https:\/\/music\.example\/rest\/getAlbum \(/);
    await expect(getJson('https://music.example/rest/getAlbum?t=secret&id=1')).rejects.not.toThrow(/secret/);
  });
});
