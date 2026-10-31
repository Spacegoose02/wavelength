import { HubError, type HubPrefs } from '../sources/hub';
import { hubClient, STAMPS_KEY, useHub } from '../store/hub';
import { useSettings } from '../store/settings';
import { applyHubServices, loadHubServices } from './hubServices';
import { startLibrarySync, syncLibrary } from './librarySync';

/**
 * Sync settings to the signed-in Hub profile so they follow the person to every device.
 *
 * Each setting is its own key, last-writer-wins on the time it was changed, so changing the skin on the
 * TV and the EQ on the phone never overwrite each other. Changes made offline are kept (with their
 * timestamps) and sent when the Hub is reachable again. Server logins come from the Hub separately
 * (hubServices.ts), and playlists and play history from librarySync.ts.
 */
const SYNCED = ['skin', 'seasonal', 'randomDaily', 'eq', 'npScene', 'raccoon', 'stations', 'hiddenStations', 'stationOrder', 'discoverCharts', 'versions', 'playback'] as const;
type SyncedKey = (typeof SYNCED)[number];
const prefKey = (k: SyncedKey) => `settings.${k}`;

interface Stamps {
  /** When each setting last changed on this device (0 / missing = never since signing in). */
  at: Partial<Record<SyncedKey, number>>;
  /** Changed here, not yet accepted by the Hub. */
  pending: SyncedKey[];
}

function loadStamps(): Stamps {
  try {
    const s = JSON.parse(localStorage.getItem(STAMPS_KEY) ?? '') as Stamps;
    return { at: s.at ?? {}, pending: s.pending ?? [] };
  } catch {
    return { at: {}, pending: [] };
  }
}
const saveStamps = (s: Stamps) => localStorage.setItem(STAMPS_KEY, JSON.stringify(s));

let applying = false;
let pushTimer: ReturnType<typeof setTimeout> | undefined;
let busy: Promise<void> | null = null;

/** Write values that came from the Hub without counting them as local edits. */
function apply(prefs: HubPrefs, stamps: Stamps) {
  const patch: Record<string, unknown> = {};
  for (const k of SYNCED) {
    const r = prefs[prefKey(k)];
    if (!r || stamps.pending.includes(k) || r.updatedAt <= (stamps.at[k] ?? 0)) continue;
    if (r.value !== null && r.value !== undefined) patch[k] = r.value;
    stamps.at[k] = r.updatedAt;
  }
  if (!Object.keys(patch).length) return;
  applying = true;
  try {
    useSettings.setState(patch);
  } finally {
    applying = false;
  }
}

/** Send pending local changes. Keeps them pending if the Hub can't be reached. */
async function push() {
  const c = hubClient();
  const stamps = loadStamps();
  if (!c || !stamps.pending.length) return;
  const state = useSettings.getState() as unknown as Record<SyncedKey, unknown>;
  const sent = [...stamps.pending];
  const changes: HubPrefs = {};
  for (const k of sent) changes[prefKey(k)] = { value: state[k] ?? null, updatedAt: stamps.at[k] ?? Date.now() };
  const r = await c.putPrefs(changes);
  const now = loadStamps(); // edits may have happened while the request was out
  now.pending = now.pending.filter((k) => !sent.includes(k) || (now.at[k] ?? 0) > (stamps.at[k] ?? 0));
  apply(r.prefs, now); // keys where another device was newer
  saveStamps(now);
  useHub.setState({ lastSeen: Date.now(), offline: false });
}

/** Fetch the profile's settings, apply newer ones, and upload settings the Hub doesn't have yet. */
async function pull() {
  const c = hubClient();
  if (!c) return;
  const { prefs } = await c.getPrefs();
  const stamps = loadStamps();
  apply(prefs, stamps);
  // first sign-in on this device: offer the Hub what it's missing, as "older than anything real"
  for (const k of SYNCED) {
    if (!prefs[prefKey(k)] && !stamps.pending.includes(k)) {
      stamps.at[k] = Math.max(stamps.at[k] ?? 0, 1);
      stamps.pending.push(k);
    }
  }
  saveStamps(stamps);
  await push();
}

/** Run one sync now (pull then push). Errors other than "offline" are thrown for the Settings screen. */
export function syncNow(): Promise<void> {
  if (busy) return busy;
  busy = (async () => {
    try {
      await Promise.all([pull(), loadHubServices(), syncLibrary()]);
    } catch (e) {
      if (e instanceof HubError) {
        if (e.status === 401) await useHub.getState().refresh();
        else throw e;
      } else useHub.setState({ offline: true });
    } finally {
      busy = null;
    }
  })();
  return busy;
}

let started = false;

/** Call once at start-up. Cheap when not signed in to a Hub. */
export function startHubSync() {
  if (started) return;
  started = true;
  // before the sign-in sync below, so a new profile's playlists are in place first
  startLibrarySync();

  useSettings.subscribe((state, prev) => {
    if (applying || !useHub.getState().token) return;
    const s = state as unknown as Record<SyncedKey, unknown>;
    const p = prev as unknown as Record<SyncedKey, unknown>;
    const changed = SYNCED.filter((k) => s[k] !== p[k]);
    if (!changed.length) return;
    const stamps = loadStamps();
    for (const k of changed) {
      stamps.at[k] = Date.now();
      if (!stamps.pending.includes(k)) stamps.pending.push(k);
    }
    saveStamps(stamps);
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => push().catch(() => useHub.setState({ offline: true })), 2000);
  });

  // signing in (or switching profile) syncs straight away
  useHub.subscribe((s, p) => {
    if (s.token && s.token !== p.token) syncNow().catch(() => undefined);
    // new logins from the Hub, or permissions changed (Autodownload on/off): update Settings
    if (s.services !== p.services || s.permissions !== p.permissions || s.token !== p.token) applyHubServices(s.services, p.services);
  });

  const tick = () => {
    if (!useHub.getState().token) return;
    useHub.getState().refresh().then(() => syncNow()).catch(() => undefined);
  };
  tick();
  setInterval(tick, 5 * 60_000);
  window.addEventListener('focus', tick);
  window.addEventListener('online', tick);
}
