import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bigGet, bigSet, bigStoreReady, flush, loadBigStore, resetBigStoreForTests } from '../lib/bigStore';

/** A localStorage with a quota, like a browser's (about 5 MB there; tiny here). */
function fakeLocalStorage(quota = 1000) {
  const m = new Map<string, string>();
  const size = () => [...m].reduce((s, [k, v]) => s + k.length + v.length, 0);
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      const before = m.get(k);
      m.set(k, v);
      if (size() > quota) {
        if (before === undefined) m.delete(k);
        else m.set(k, before);
        throw new Error(`Setting the value of '${k}' exceeded the quota.`);
      }
    },
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeLocalStorage());
  indexedDB.deleteDatabase('wavelength');
});
afterEach(() => {
  resetBigStoreForTests();
  vi.unstubAllGlobals();
});

describe('bigStore', () => {
  it('moves playlists out of localStorage at startup and keeps them across restarts', async () => {
    localStorage.setItem('tonearm.library', '{"old":1}');
    localStorage.setItem('tonearm.library.of.7', '{"copy":1}');
    localStorage.setItem('tonearm.settings', '{"keep":1}');
    await loadBigStore();
    expect(bigStoreReady()).toBe(true);
    expect(bigGet('tonearm.library')).toBe('{"old":1}');
    await flush();
    expect(localStorage.getItem('tonearm.library')).toBeNull();
    expect(localStorage.getItem('tonearm.library.of.7')).toBeNull();
    expect(localStorage.getItem('tonearm.settings')).toBe('{"keep":1}');

    resetBigStoreForTests();
    await loadBigStore();
    expect(bigGet('tonearm.library.of.7')).toBe('{"copy":1}');
  });

  it('saves far more than localStorage holds', async () => {
    await loadBigStore();
    const big = 'x'.repeat(50_000);
    bigSet('tonearm.library', big);
    expect(bigGet('tonearm.library')).toBe(big);
    await flush();
    resetBigStoreForTests();
    await loadBigStore();
    expect(bigGet('tonearm.library')).toBe(big);
  });

  it('without IndexedDB uses localStorage, and a full one is logged instead of throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    bigSet('tonearm.library', 'small');
    expect(localStorage.getItem('tonearm.library')).toBe('small');
    expect(() => bigSet('tonearm.library', 'x'.repeat(5000))).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
