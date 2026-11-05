import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Track } from '../sources/types';

// no audio or files in tests
vi.mock('../player/engine', () => {
  const el = { paused: false, currentTime: 0, src: '', play: () => Promise.resolve(), pause: () => undefined, addEventListener: () => undefined };
  const engine = new Proxy({ el }, { get: (o, k) => (k in o ? (o as Record<string | symbol, unknown>)[k] : () => undefined) });
  return { engine };
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), convertFileSrc: (p: string) => p }));
vi.stubGlobal('window', globalThis);
const store = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });

const { aheadPlan, fill, pickStandIn } = await import('../lib/deadZone');
const { setDeadZoneHook, signalBack, usePlayer } = await import('../store/player');
const { useOffline, trackKey } = await import('../store/offline');

const t = (id: string, duration = 200, kind: Track['kind'] = 'track'): Track => ({ id, sourceId: 'nd', kind, title: id, artist: 'a', duration }) as Track;
const ids = (l: Track[]) => l.map((x) => x.id);
const settle = () => new Promise((r) => setTimeout(r, 10));

describe('the queue ahead', () => {
  const q = [t('a'), t('b'), t('c'), t('d'), t('e')];
  test('the song playing and the next ones, until there are enough minutes', () => {
    expect(ids(aheadPlan(q, 1, 'off', 500))).toEqual(['b', 'c', 'd']);
  });
  test('stops at the end of the queue, or wraps round when it repeats', () => {
    expect(ids(aheadPlan(q, 3, 'off', 2000))).toEqual(['d', 'e']);
    expect(ids(aheadPlan(q, 3, 'all', 700))).toEqual(['d', 'e', 'a', 'b']);
  });
  test('music only: radio, books and podcasts are not cached', () => {
    expect(ids(aheadPlan([t('r', 0, 'radio'), t('x'), t('p', 3000, 'episode'), t('y')], 0, 'off', 1000))).toEqual(['x', 'y']);
  });
  test('songs with no length count as four minutes', () => {
    expect(ids(aheadPlan([t('a', 0), t('b', 0), t('c', 0)], 0, 'off', 480))).toEqual(['a', 'b']);
  });
});

describe('songs like the one playing', () => {
  test('fills the minutes, leaving out the queue ahead and repeats', () => {
    expect(ids(fill([t('a'), t('b'), t('b'), t('c'), t('d')], new Set(['nd:a']), 400))).toEqual(['b', 'c']);
  });
});

describe('picking a stand-in', () => {
  const similar = [t('s1'), t('s2')];
  const favs = [t('f1')];
  test('similar songs first, then the other lists, skipping ones used or played lately', () => {
    expect(pickStandIn([similar, favs], [], new Set())?.id).toBe('s1');
    expect(pickStandIn([similar, favs], ['nd:s1'], new Set(['nd:s2']))?.id).toBe('f1');
  });
  test('never the song it stands in for', () => {
    expect(pickStandIn([similar], [], new Set(), t('s1'))?.id).toBe('s2');
  });
  test('when everything has played, it goes round again rather than stop', () => {
    expect(pickStandIn([similar], [], new Set(['nd:s1', 'nd:s2']))?.id).toBe('s1');
    expect(pickStandIn([similar], ['nd:s2', 'nd:s1'], new Set())?.id).toBe('s2');
  });
  test('nothing saved: nothing to play', () => {
    expect(pickStandIn([[], []], [], new Set())).toBeUndefined();
  });
});

describe('the player in a dead zone', () => {
  const saved = [t('s1'), t('s2'), t('s3')];
  const state = { offline: false, lost: false, left: [...saved] };
  beforeEach(() => {
    state.offline = false;
    state.lost = false;
    state.left = [...saved];
    useOffline.setState({ tracks: Object.fromEntries(saved.map((s) => [trackKey(s), { key: trackKey(s), path: `/x/${s.id}`, size: 1, savedAt: 0, track: s }])) });
    setDeadZoneHook({
      offline: () => state.offline,
      // a failed stream: the server doesn't answer (when `lost`)
      check: async () => (state.offline = state.lost),
      standIn: () => state.left.shift(),
    });
  });

  test('already offline: a saved song plays first, and the queue waits behind it', async () => {
    state.offline = true;
    usePlayer.getState().playTracks([t('a'), t('b')]);
    await settle();
    const p = usePlayer.getState();
    expect(ids(p.queue)).toEqual(['s1', 'a', 'b']);
    expect(p.index).toBe(0);
    expect(p.noSignal).toBe(true);
    // the stand-in ends, still no signal: another stands in for the same song
    p.next();
    await settle();
    expect(ids(usePlayer.getState().queue)).toEqual(['s1', 's2', 'a', 'b']);
    expect(usePlayer.getState().current()?.id).toBe('s2');
  });

  test('a stream that fails because the signal went: a stand-in instead of skipping', async () => {
    state.lost = true;
    // no stream URL in tests, so "a" fails to load
    usePlayer.getState().playTracks([t('a'), t('b')]);
    await settle();
    expect(ids(usePlayer.getState().queue)).toEqual(['s1', 'a', 'b']);
    expect(usePlayer.getState().current()?.id).toBe('s1');
  });

  test('a song that fails with the signal fine is skipped as before', async () => {
    usePlayer.getState().playTracks([t('a'), t('b')]);
    await settle();
    expect(ids(usePlayer.getState().queue)).toEqual(['a', 'b']);
    expect(usePlayer.getState().error).toMatch(/skipping/);
  });

  test('the queue runs out with no signal: saved songs carry on', async () => {
    state.offline = true;
    usePlayer.getState().playTracks([saved[2]]);
    await settle();
    usePlayer.getState().next();
    await settle();
    expect(usePlayer.getState().current()?.id).toBe('s1');
    expect(usePlayer.getState().ranOut).toBe(false);
  });

  test('nothing saved left: it waits for the signal, then carries on', async () => {
    state.lost = true;
    state.left = [];
    usePlayer.getState().playTracks([t('a'), t('b')]);
    await settle();
    expect(usePlayer.getState().current()?.id).toBe('a');
    expect(usePlayer.getState().error).toMatch(/No signal/);
    state.offline = state.lost = false;
    signalBack();
    await settle();
    expect(usePlayer.getState().noSignal).toBe(false);
  });
});
