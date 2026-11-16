import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Track } from '../sources/types';

// a stand-in for the audio engine: records what the player asks of it, and lets a test send its events
const h = vi.hoisted(() => {
  const listeners = new Map<string, ((e: Event, el: unknown) => void)[]>();
  const el = { paused: true, currentTime: 0, duration: NaN, src: '' };
  const calls: string[] = [];
  const engine = {
    el,
    on: (type: string, fn: (e: Event, el: unknown) => void) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    load: async (url: string) => {
      calls.push(`load ${url}`);
      Object.assign(el, { src: url, currentTime: 0, duration: NaN, paused: false });
    },
    pause: () => {
      calls.push('pause');
      el.paused = true;
    },
    play: async () => {
      el.paused = false;
    },
    seek: (t: number) => void (el.currentTime = t),
    isRemote: () => false,
    setSpeed: () => undefined,
    setMeta: () => undefined,
    setLevel: () => undefined,
    preload: () => undefined,
    speed: () => 1,
  };
  const emit = (type: string) => listeners.get(type)?.forEach((fn) => fn(new Event(type), el));
  return { engine, el, calls, emit };
});
vi.mock('../player/engine', () => ({
  engine: new Proxy(h.engine, { get: (o, k) => (k in o ? (o as Record<string | symbol, unknown>)[k] : () => undefined) }),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), convertFileSrc: (p: string) => p }));
vi.stubGlobal('window', globalThis);
const store = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });

const { usePlayer, setDeadZoneHook, STALL_SECONDS } = await import('../store/player');
const { aheadPlan } = await import('../lib/deadZone');

const clip = (id: string): Track => ({ id: `preview:${id}`, sourceId: 'preview', kind: 'track', title: id, artist: 'a', streamUrl: `https://cdn.example/${id}.mp3`, duration: 30 }) as Track;
const song = (id: string): Track => ({ id, sourceId: 'nd', kind: 'track', title: id, artist: 'a', streamUrl: `https://music.example/${id}`, duration: 200 }) as Track;
const settle = () => new Promise((r) => setTimeout(r, 0));
const playing = () => usePlayer.getState().current()?.title;

beforeEach(() => {
  setDeadZoneHook(undefined);
  h.calls.length = 0;
  usePlayer.setState({ queue: [], index: 0, repeat: 'off', shuffle: false, error: undefined });
});

describe('Deezer clips never sit on BUF', () => {
  test('a clip waiting for more at its end has ended: the next one plays', async () => {
    usePlayer.getState().playTracks([clip('one'), clip('two')]);
    await settle();
    Object.assign(h.el, { currentTime: 29.6, duration: 30 });
    h.emit('waiting');
    await settle();
    expect(playing()).toBe('two');
    expect(usePlayer.getState().buffering).toBe(true); // the new one loading, not the old one stuck
  });

  test('a clip whose clock runs on past its length has ended', async () => {
    usePlayer.getState().playTracks([clip('one'), clip('two')]);
    await settle();
    Object.assign(h.el, { currentTime: 34, duration: NaN });
    h.emit('timeupdate');
    await settle();
    expect(playing()).toBe('two');
  });

  test('a clip that stops loading part way is skipped, with no dead zone cushion', async () => {
    vi.useFakeTimers();
    try {
      usePlayer.getState().playTracks([clip('one'), clip('two')]);
      await vi.advanceTimersByTimeAsync(0);
      Object.assign(h.el, { currentTime: 12, duration: 30, paused: false });
      h.emit('waiting');
      expect(usePlayer.getState().buffering).toBe(true);
      await vi.advanceTimersByTimeAsync(STALL_SECONDS * 1000 + 10);
      expect(usePlayer.getState().error).toMatch(/preview stopped loading · skipping/);
      await vi.advanceTimersByTimeAsync(2100);
      expect(playing()).toBe('two');
    } finally {
      vi.useRealTimers();
    }
  });

  test('a clip that stalls with the music server reachable is skipped, not waited on for ever', async () => {
    vi.useFakeTimers();
    try {
      setDeadZoneHook({ offline: () => false, check: async () => false, standIn: () => undefined });
      usePlayer.getState().playTracks([clip('one'), clip('two')]);
      await vi.advanceTimersByTimeAsync(0);
      Object.assign(h.el, { currentTime: 12, duration: 30, paused: false });
      h.emit('waiting');
      await vi.advanceTimersByTimeAsync(STALL_SECONDS * 1000 + 2100);
      expect(playing()).toBe('two');
    } finally {
      vi.useRealTimers();
    }
  });

  test('a full song that waits near its end is left alone (only clips end early)', async () => {
    usePlayer.getState().playTracks([song('long'), song('next')]);
    await settle();
    Object.assign(h.el, { currentTime: 199.5, duration: 200 });
    h.emit('waiting');
    expect(playing()).toBe('long');
    expect(usePlayer.getState().buffering).toBe(true);
  });

  test('picking another song stops the one playing right away', async () => {
    usePlayer.getState().playTracks([song('long')]);
    await settle();
    expect(h.el.paused).toBe(false);
    h.calls.length = 0;
    usePlayer.getState().playTracks([clip('one')]);
    expect(h.calls[0]).toBe('pause');
  });

  test("a clip doesn't start past its end", async () => {
    usePlayer.getState().playTracks([clip('one')], 0, 34);
    expect(usePlayer.getState().position).toBe(0);
  });

  test('the dead zone cushion does not save clips', () => {
    expect(aheadPlan([clip('one'), song('s'), clip('two')], 0, 'off', 9999).map((t) => t.id)).toEqual(['s']);
  });
});
