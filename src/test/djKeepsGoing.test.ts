import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Track } from '../sources/types';

// no audio in tests: the player and the DJ's voice talk to this instead
vi.mock('../player/engine', () => {
  const el = { paused: true, currentTime: 0, src: '', play: () => Promise.resolve(), pause: () => undefined, addEventListener: () => undefined };
  const engine = new Proxy({ el }, { get: (o, k) => (k in o ? (o as Record<string | symbol, unknown>)[k] : () => undefined) });
  return { engine };
});

const library = new Map<string, Track>();
const song = (id: string): Track => {
  const t = { kind: 'track', id, sourceId: 'lib', title: `Song ${id}`, artist: 'Trash Panda', album: 'Bins', duration: 200 } as Track;
  library.set(t.title, t);
  return t;
};
let made = 0;
/** What the Hub does: hands out fresh segments of 24 songs you have, or something worse. */
const hub = {
  mode: 'ok' as 'ok' | 'fail',
  size: 24,
  /** Holds each answer until released, like a slow Hub or music server. */
  gate: null as Promise<void> | null,
};
const KINDS = ['favourites', 'discover', 'throwbacks', 'tophits'];
vi.mock('../store/hub', async (orig) => ({
  ...(await orig<typeof import('../store/hub')>()),
  hubClient: () => ({
    djStation: async (b: { previous?: string }) => {
      if (hub.gate) await hub.gate;
      if (hub.mode === 'fail') throw new Error('The DJ has nothing to play yet');
      const kind = KINDS[(KINDS.indexOf(b.previous ?? '') + 1) % KINDS.length];
      const songs = Array.from({ length: hub.size }, () => song(`x${made++}`)).map((t) => ({ title: t.title, artist: t.artist }));
      return { kind, title: kind, intro: null, songs, spent: 0, limit: null };
    },
    djVoice: async () => null,
  }),
}));
vi.mock('../lib/mixes', () => ({ findSong: async (s: { title: string }) => library.get(s.title) }));
vi.mock('../lib/match', async (orig) => ({ ...(await orig<typeof import('../lib/match')>()), findInLibrary: () => async () => undefined }));
// "More like this" looks songs up on Deezer: nothing here
vi.mock('../lib/songRadio', () => ({ songRadio: async () => [] }));

vi.stubGlobal('window', globalThis);
const store = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
const { usePlayer } = await import('../store/player');
const { startDjStation, startStation, stopStation, useStation } = await import('../lib/djStation');
startDjStation();

let now = 1e12;
vi.spyOn(Date, 'now').mockImplementation(() => now);
const settle = () => new Promise((r) => setTimeout(r, 10));
/** One song plays to the end (three and a bit minutes pass). */
async function playOne() {
  now += 200_000;
  usePlayer.getState().next();
  await settle();
}

describe('DJ Trash Panda keeps the mix going until you stop it', () => {
  beforeEach(() => {
    stopStation();
    hub.mode = 'ok';
    hub.size = 24;
    hub.gate = null;
  });

  test('segment after segment, well past the first dozen songs', async () => {
    await startStation({});
    for (let i = 0; i < 60; i++) await playOne();
    const p = usePlayer.getState();
    expect(useStation.getState().on).toBe(true);
    expect(p.ranOut).toBe(false);
    expect(p.index).toBe(60);
    expect(p.queue.length - p.index).toBeGreaterThan(0);
  });

  test('songs that arrive after the queue ran out start playing', async () => {
    await startStation({});
    let release!: () => void;
    hub.gate = new Promise<void>((r) => (release = r));
    // the Hub is slow: the whole first segment plays out while it thinks
    for (let i = 0; i < 12; i++) await playOne();
    const before = usePlayer.getState();
    expect(before.ranOut).toBe(true);
    expect(before.index).toBe(11);
    release();
    hub.gate = null;
    await settle();
    await settle();
    const after = usePlayer.getState();
    expect(useStation.getState().on).toBe(true);
    expect(after.queue.length).toBe(24);
    expect(after.index).toBe(12);
    expect(after.ranOut).toBe(false);
  });

  test('a short first segment and a Hub with nothing more: an encore, not silence', async () => {
    hub.size = 5;
    await startStation({});
    hub.mode = 'fail';
    for (let i = 0; i < 20; i++) await playOne();
    const p = usePlayer.getState();
    expect(useStation.getState().on).toBe(true);
    expect(p.ranOut).toBe(false);
    expect(p.index).toBe(20);
  });
});
