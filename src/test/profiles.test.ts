import { beforeEach, describe, expect, test, vi } from 'vitest';

// the store persists to localStorage, which the test environment doesn't have
vi.hoisted(() => {
  const m = new Map<string, string>();
  globalThis.localStorage ??= { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 } as Storage;
});
import { profilePinHash, STAMPS_KEY, useHub } from '../store/hub';
import type { HubSession } from '../sources/hub';

const session = (id: number, name: string): HubSession =>
  ({ token: `t${id}`, user: { id, username: name.toLowerCase(), displayName: name, role: id === 3 ? 'kid' : 'member' }, permissions: [], device: { id } }) as unknown as HubSession;

describe('profiles on a shared device', () => {
  beforeEach(() => {
    useHub.setState({ token: undefined, user: undefined, profiles: [], pin: undefined, kids: [] });
    useHub.getState().signedIn(session(1, 'Ana'));
  });

  test('adding someone switches to them and keeps the first person', () => {
    localStorage.setItem(STAMPS_KEY, '{}');
    useHub.getState().addProfile(session(2, 'Ben'));
    const s = useHub.getState();
    expect(s.user?.displayName).toBe('Ben');
    expect(s.token).toBe('t2');
    expect(s.profiles.map((p) => p.user.displayName)).toEqual(['Ana']);
    expect(localStorage.getItem(STAMPS_KEY)).toBeNull();
  });

  test('switching swaps the active person and the list, carrying PINs along', async () => {
    await useHub.getState().setProfilePin(1, '1234');
    useHub.getState().addProfile(session(2, 'Ben'));
    useHub.getState().addProfile(session(3, 'Cy'));
    expect(useHub.getState().profiles.map((p) => p.user.id).sort()).toEqual([1, 2]);
    useHub.getState().switchProfile(1);
    const s = useHub.getState();
    expect(s.user?.id).toBe(1);
    expect(s.token).toBe('t1');
    expect(s.pin).toBe(await profilePinHash(1, '1234'));
    expect(s.profiles.map((p) => p.user.id).sort()).toEqual([2, 3]);
    useHub.getState().switchProfile(99);
    expect(useHub.getState().user?.id).toBe(1);
  });

  test('a PIN hash is tied to the person', async () => {
    expect(await profilePinHash(1, '1234')).not.toBe(await profilePinHash(2, '1234'));
    expect(await profilePinHash(1, '1234')).toMatch(/^[0-9a-f]{64}$/);
  });
});
