import { invoke } from '@tauri-apps/api/core';
import type { StateStorage } from 'zustand/middleware';

/**
 * Passwords and tokens in the OS keychain (src-tauri/src/secrets.rs): Windows Credential Manager, or the
 * Android Keystore. The saved stores (store/hub.ts, store/settings.ts) keep everything else in localStorage as
 * before; `secretStorage` takes the secret fields out on the way in and puts them back on the way out.
 *
 * The keychain is read once at startup (`loadSecrets`, before any store is created: main.tsx), so the stores
 * can still load synchronously. In a browser, or when the keychain doesn't answer, nothing changes: secrets
 * stay in localStorage.
 *
 * Nothing is lost on the way: a value is written to localStorage in full first and only stripped from it
 * once the keychain has it. A value found in localStorage (from before this, or a session without the
 * keychain) is newer than the keychain's and moves there.
 */

const INDEX_KEY = 'tonearm.secretKeys';
let available = false;
const cache = new Map<string, string>();

const readIndex = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
};
const saveIndex = () => localStorage.setItem(INDEX_KEY, JSON.stringify([...cache.keys()]));

/** Read the keychain into memory. Call before the stores load. */
export async function loadSecrets() {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
  try {
    if (!(await invoke<boolean>('secrets_available'))) return;
    const keys = readIndex();
    const got = keys.length ? await invoke<Record<string, string>>('secrets_get', { keys }) : {};
    for (const [k, v] of Object.entries(got)) cache.set(k, v);
    available = true;
  } catch (e) {
    // keep everything in localStorage this session rather than risk signing anyone out
    console.warn('Keychain unavailable, keeping logins in app storage', e);
  }
}

/** Whether logins are kept in the OS keychain on this device (Settings shows it). */
export const secretsInKeychain = () => available;

/** Where a store's secret fields are: take them out of its saved state, and put them back. */
export interface SecretFields<S> {
  /** The state without secrets, and the secrets by key (empty values left out). */
  strip(state: S): { state: S; secrets: Record<string, string> };
  fill(state: S, get: (key: string) => string | undefined): S;
  /** Keys that belong to this store, to know which to remove from the keychain. */
  owns(key: string): boolean;
}

async function keep(values: Record<string, string | null>) {
  if (!Object.keys(values).length) return;
  await invoke('secrets_set', { values });
  for (const [k, v] of Object.entries(values)) {
    if (v) cache.set(k, v);
    else cache.delete(k);
  }
  saveIndex();
}

export function secretStorage<S>(fields: SecretFields<S>): StateStorage {
  /** Write `full` now; once the keychain has the secrets, the same thing without them (unless it changed since). */
  const write = (name: string, full: string, stripped: string, values: Record<string, string | null>) => {
    if (!Object.keys(values).length) return localStorage.setItem(name, stripped);
    localStorage.setItem(name, full);
    keep(values).then(
      () => localStorage.getItem(name) === full && localStorage.setItem(name, stripped),
      (e) => console.warn('Couldn’t save to the keychain; kept in app storage', e),
    );
  };

  return {
    getItem(name) {
      const raw = localStorage.getItem(name);
      if (!raw || !available) return raw;
      try {
        const saved = JSON.parse(raw) as { state: S; version?: number };
        const { state, secrets: plain } = fields.strip(saved.state);
        if (Object.keys(plain).length) write(name, raw, JSON.stringify({ ...saved, state }), plain);
        return JSON.stringify({ ...saved, state: fields.fill(state, (k) => plain[k] ?? cache.get(k)) });
      } catch {
        return raw;
      }
    },
    setItem(name, value) {
      if (!available) return localStorage.setItem(name, value);
      try {
        const saved = JSON.parse(value) as { state: S; version?: number };
        const { state, secrets } = fields.strip(saved.state);
        const values: Record<string, string | null> = {};
        for (const [k, v] of Object.entries(secrets)) if (cache.get(k) !== v) values[k] = v;
        for (const k of cache.keys()) if (fields.owns(k) && !(k in secrets)) values[k] = null;
        write(name, value, JSON.stringify({ ...saved, state }), values);
      } catch {
        localStorage.setItem(name, value);
      }
    },
    removeItem(name) {
      localStorage.removeItem(name);
    },
  };
}
