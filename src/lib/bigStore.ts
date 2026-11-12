import type { StateStorage } from 'zustand/middleware';

/**
 * Room for the big saved things: your Wavelength playlists and play history (store/library.ts) and each signed-in
 * profile's copy of them (lib/librarySync.ts). They used to live in localStorage, which holds about 5 MB per app.
 * A few hundred synced playlists of Plex songs (every song carries its stream and cover links) is more than that,
 * and saving failed with "Setting the value of 'tonearm.library' exceeded the quota".
 *
 * They live in IndexedDB now, which has room for hundreds of MB. IndexedDB only answers asynchronously, so
 * `loadBigStore()` reads it all into memory once at startup (main.tsx, before the stores are created, like
 * lib/secrets.ts); after that reads are synchronous and the stores load exactly as before. Writes go to memory
 * at once and to IndexedDB a moment later (and right away when the window is hidden or closed).
 *
 * Nothing is lost on the way: a key not in IndexedDB yet is read from localStorage, and only removed from
 * localStorage once IndexedDB has it. Without IndexedDB (private windows, tests) everything stays in
 * localStorage as before, and a full localStorage is reported in the console instead of breaking the save.
 */

const DB = 'wavelength';
const STORE = 'kv';
const cache = new Map<string, string | null>();
let db: IDBDatabase | undefined;
const pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

/** Read every saved value into memory. Call once before the stores load; resolves even when IndexedDB can't open. */
export async function loadBigStore(): Promise<void> {
  if (db || typeof indexedDB === 'undefined') return;
  try {
    const d = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return;
        if (typeof c.value === 'string') cache.set(String(c.key), c.value);
        c.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db = d;
    moveFromLocalStorage();
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', flush);
      document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
    }
  } catch (e) {
    console.warn('IndexedDB unavailable, saving playlists in localStorage', e);
  }
}

/** Keys that belong here; ones still in localStorage (from before) move over at startup to free it up. */
const MINE = (k: string) => k === 'tonearm.library' || k.startsWith('tonearm.library.of.');

function moveFromLocalStorage() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !MINE(k)) continue;
      // IndexedDB's copy is newer when there is one (written there, then the localStorage removal failed)
      if (!cache.has(k)) cache.set(k, localStorage.getItem(k));
      pending.add(k);
    }
  } catch {
    /* blocked */
  }
  if (pending.size) void flush();
}

/** Whether values go to IndexedDB (false: localStorage, as before). */
export const bigStoreReady = () => !!db;

const lsGet = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export function bigGet(key: string): string | null {
  if (cache.has(key)) return cache.get(key) ?? null;
  return lsGet(key);
}

export function bigSet(key: string, value: string): void {
  if (!db) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      // full: the copy in memory still works for this session
      console.warn(`Couldn't save ${key}`, e);
    }
    return;
  }
  cache.set(key, value);
  pending.add(key);
  clearTimeout(timer);
  timer = setTimeout(flush, 250);
}

export function bigRemove(key: string): void {
  if (db) {
    cache.set(key, null);
    pending.add(key);
    clearTimeout(timer);
    timer = setTimeout(flush, 250);
  }
  try {
    localStorage.removeItem(key);
  } catch {
    /* blocked */
  }
}

/** Write what changed to IndexedDB; once it's there, drop the old localStorage copy. */
let writing: Promise<void> = Promise.resolve();
export function flush(): Promise<void> {
  clearTimeout(timer);
  // one write at a time, in order, so awaiting flush() means everything so far is saved
  writing = writing.then(write);
  return writing;
}

function write(): Promise<void> {
  if (!db || !pending.size) return Promise.resolve();
  const keys = [...pending];
  pending.clear();
  return new Promise<void>((resolve) => {
    const tx = db!.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const k of keys) {
      const v = cache.get(k);
      if (v == null) store.delete(k);
      else store.put(v, k);
    }
    tx.oncomplete = () => {
      for (const k of keys) {
        try {
          localStorage.removeItem(k);
        } catch {
          /* blocked */
        }
      }
      resolve();
    };
    tx.onerror = tx.onabort = () => {
      console.warn("Couldn't save to IndexedDB", tx.error);
      for (const k of keys) if (!pending.has(k)) pending.add(k);
      resolve();
    };
  });
}

/** For zustand's persist (createJSONStorage(() => bigStorage)): synchronous, like localStorage. */
export const bigStorage: StateStorage = {
  getItem: bigGet,
  setItem: bigSet,
  removeItem: bigRemove,
};

/** Tests: forget the open database and memory. */
export function resetBigStoreForTests() {
  db?.close();
  db = undefined;
  cache.clear();
  pending.clear();
  clearTimeout(timer);
  writing = Promise.resolve();
}
