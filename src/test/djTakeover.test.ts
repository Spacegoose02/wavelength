import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Track } from '../sources/types';

// no audio in tests: the player and the DJ's voice talk to this instead
vi.mock('../player/engine', () => {
  const el = { paused: true, currentTime: 0, src: '', play: () => Promise.resolve(), pause: () => undefined, addEventListener: () => undefined };
  const engine = new Proxy({ el }, { get: (o, k) => (k in o ? (o as Record<string | symbol, unknown>)[k] : () => undefined) });
  return { engine };
});
const song = (id: string, artist = 'Joyner Lucas'): Track => ({ kind: 'track', id, sourceId: 'lib', title: `Song ${id}`, artist, album: 'ADHD', duration: 200 }) as Track;
const station = [song('s1'), song('s2'), song('s3'), song('s4'), song('s5')];
vi.mock('../store/hub', async (orig) => ({
  ...(await orig<typeof import('../store/hub')>()),
  hubClient: () => ({
    djStation: async () => ({ kind: 'favourites', title: 'Your favorites', intro: null, songs: station.map((t) => ({ title: t.title, artist: t.artist })), spent: 0, limit: null }),
    djVoice: async () => null,
  }),
}));
vi.mock('../lib/mixes', () => ({ findSong: async (s: { title: string }) => station.find((t) => t.title === s.title) }));
vi.mock('../lib/match', async (orig) => ({ ...(await orig<typeof import('../lib/match')>()), findInLibrary: () => () => undefined }));

// the player keeps timers on window
vi.stubGlobal('window', globalThis);
const store = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
const { usePlayer } = await import('../store/player');
const { startDjStation, startStation, stopStation, useStation } = await import('../lib/djStation');
const { djQueued, markDjQueued, startDjVoice } = await import('../lib/djVoice');
startDjVoice();
startDjStation();

describe('DJ Trash Panda only runs what it started', () => {
  beforeEach(() => {
    stopStation();
    djQueued.clear();
  });

  test('playing an album from your library ends DJ mode, even one holding songs the station played', async () => {
    await startStation({ kind: 'favourites' });
    expect(useStation.getState().on).toBe(true);
    expect(usePlayer.getState().queueBy).toBe('station');
    // the album holds the very songs the station queued (the library hands out the same tracks)
    const album = [song('a1'), station[1], station[2], song('a4')];
    usePlayer.getState().playTracks(album, 0);
    expect(useStation.getState().on).toBe(false);
    expect(usePlayer.getState().queueBy).toBe('you');
  });

  test('Play next and Add to queue keep DJ mode going', async () => {
    await startStation({ kind: 'favourites' });
    usePlayer.getState().playNext([song('n1')]);
    usePlayer.getState().enqueue([song('e1')]);
    expect(useStation.getState().on).toBe(true);
  });

  test('your own music is never queued as the DJ’s; a queue you start drops the AI DJ chat’s songs', () => {
    const mine = [song('m1'), song('m2'), song('m3')];
    usePlayer.getState().playTracks(mine);
    expect(useStation.getState().on).toBe(false);
    expect(djQueued.size).toBe(0);
    const chat = [song('c1'), song('c2')];
    usePlayer.getState().playTracks(chat, 0, 0, 'dj');
    markDjQueued(chat);
    expect(djQueued.size).toBe(2);
    usePlayer.getState().playTracks(mine);
    expect(djQueued.size).toBe(0);
  });
});
