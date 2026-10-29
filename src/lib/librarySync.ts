import { HubError, type HubPlaylist } from '../sources/hub';
import { NavidromeSource } from '../sources/navidrome';
import { sourceFor } from '../sources/registry';
import type { Track } from '../sources/types';
import { hubClient, useHub } from '../store/hub';
import { useLibrary, type LocalPlay, type Playlist } from '../store/library';
import { useSettings } from '../store/settings';

/**
 * Wavelength's own playlists and play history belong to the person, not the device (docs/HUB.md "Your
 * playlists and history"). Each profile signed in on this device keeps its own copy here, so someone else
 * signing in sees their own; while signed in, the copy syncs with the Hub so it follows them to every device.
 *
 * Playlists sync whole, last change wins per playlist, and a deleted one is sent as a tombstone. Plays are
 * sent once and the Hub's list (newest 300) replaces the device's.
 */

const OWNER_KEY = 'tonearm.libraryOwner';
const copyKey = (owner: string) => `tonearm.library.of.${owner || 'none'}`;
const syncKey = (owner: string) => `tonearm.librarySync.${owner}`;

interface SyncState {
  /** Playlists changed here and not yet taken by the Hub. */
  dirty: string[];
  /** Deleted here, not yet told to the Hub. */
  deleted: { id: string; at: number }[];
  /** Plays not yet sent. */
  plays: LocalPlay[];
}

const read = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* full or blocked: the copy in memory still works */
  }
};
const emptySync = (): SyncState => ({ dirty: [], deleted: [], plays: [] });

const ownerOf = () => String(useHub.getState().token ? useHub.getState().user?.id ?? '' : '');
let owner = '';
let applying = false;

/** Set the library without counting it as local edits. */
function setQuietly(patch: Partial<{ playlists: Playlist[]; history: LocalPlay[] }>) {
  applying = true;
  try {
    useLibrary.setState(patch);
  } finally {
    applying = false;
  }
}

/** Save this profile's copy, and load the copy of whoever is signed in now. */
function switchOwner() {
  const next = ownerOf();
  const known = localStorage.getItem(OWNER_KEY);
  if (known === null) {
    // first run with per-person playlists: what's on the device belongs to whoever is signed in
    owner = next;
    localStorage.setItem(OWNER_KEY, next);
    if (next) {
      const { playlists, history } = useLibrary.getState();
      write(syncKey(next), { dirty: playlists.map((p) => p.id), deleted: [], plays: history.slice(0, 300) } satisfies SyncState);
    }
    return;
  }
  owner = known;
  if (next === owner) return;
  const { playlists, history } = useLibrary.getState();
  write(copyKey(owner), { playlists, history });
  const theirs = read<{ playlists: Playlist[]; history: LocalPlay[] }>(copyKey(next), { playlists: [], history: [] });
  owner = next;
  localStorage.setItem(OWNER_KEY, next);
  setQuietly({ playlists: theirs.playlists ?? [], history: theirs.history ?? [] });
}

/** What goes to the Hub: Navidrome stream and cover links carry this device's login, so they're rebuilt. */
export function forHub(t: Track): Track {
  const cfg = useSettings.getState().sources.find((s) => s.id === t.sourceId);
  if (cfg?.kind !== 'navidrome' || t.kind !== 'track') return t;
  const { streamUrl: _s, coverUrl: _c, ...rest } = t;
  return rest;
}
/** A track that came back from the Hub, with this device's Navidrome links put back. */
export function fromHub(t: Track): Track {
  const cfg = useSettings.getState().sources.find((s) => s.id === t.sourceId);
  if (cfg?.kind !== 'navidrome' || t.kind !== 'track' || t.coverUrl) return t;
  const src = sourceFor(cfg);
  if (!(src instanceof NavidromeSource)) return t;
  const built = src.trackFromId(t.id);
  return { ...t, coverUrl: built.coverUrl, streamUrl: built.streamUrl };
}
const toHub = (p: Playlist): HubPlaylist => ({ id: p.id, name: p.name, tracks: p.tracks.map(forHub), createdAt: p.createdAt, updatedAt: p.updatedAt });

let busy: Promise<void> | null = null;

/** Send what changed here, then take what other devices changed. Throws when the Hub can't be reached. */
export function syncLibrary(): Promise<void> {
  if (busy) return busy;
  busy = run().catch((e) => {
    // an older Hub without playlists: keep them on the device
    if (!(e instanceof HubError && e.status === 404)) throw e;
  }).finally(() => {
    busy = null;
  });
  return busy;
}

async function run() {
  const c = hubClient();
  const me = ownerOf();
  if (!c || !me || me !== owner) return;
  const st = read<SyncState>(syncKey(me), emptySync());
  const local = useLibrary.getState().playlists;

  const send = [
    ...local.filter((p) => st.dirty.includes(p.id)).map(toHub),
    ...st.deleted.map((d) => ({ id: d.id, name: '', tracks: [], createdAt: d.at, updatedAt: d.at, deleted: true })),
  ];
  const { playlists: hub } = send.length ? await c.putMyPlaylists(send) : await c.myPlaylists();
  if (st.plays.length) await c.addMyHistory(st.plays.map((p) => ({ playedAt: p.playedAt, track: forHub(p.track) })));
  const { history } = await c.myHistory();
  if (ownerOf() !== me) return; // switched profile meanwhile

  // edits made while the request was out stay pending; the rest were taken
  const now = read<SyncState>(syncKey(me), emptySync());
  const sentIds = new Set(send.map((p) => p.id));
  const sentAt = new Map(send.map((p) => [p.id, p.updatedAt]));
  const current = useLibrary.getState().playlists;
  now.dirty = now.dirty.filter((id) => !sentIds.has(id) || (current.find((p) => p.id === id)?.updatedAt ?? 0) > (sentAt.get(id) ?? 0));
  now.deleted = now.deleted.filter((d) => !sentIds.has(d.id) || d.at > (sentAt.get(d.id) ?? 0));
  const sentPlays = new Set(st.plays.map((p) => p.playedAt));
  now.plays = now.plays.filter((p) => !sentPlays.has(p.playedAt));
  write(syncKey(me), now);

  // the Hub's copy wins unless this device has a newer edit waiting
  const byId = new Map(hub.map((p) => [p.id, p]));
  const merged: Playlist[] = [];
  for (const p of current) {
    const h = byId.get(p.id);
    byId.delete(p.id);
    if (!h || now.dirty.includes(p.id) || h.updatedAt <= p.updatedAt) {
      // not on the Hub and not ours to send: another profile's leftovers never get here, so keep it
      merged.push(p);
    } else if (!h.deleted) merged.push({ id: h.id, name: h.name, tracks: h.tracks.map(fromHub), createdAt: h.createdAt, updatedAt: h.updatedAt });
  }
  const gone = new Set(now.deleted.map((d) => d.id));
  for (const h of byId.values()) {
    if (!h.deleted && !gone.has(h.id)) merged.push({ id: h.id, name: h.name, tracks: h.tracks.map(fromHub), createdAt: h.createdAt, updatedAt: h.updatedAt });
  }
  const plays = [...now.plays, ...history.map((p) => ({ playedAt: p.playedAt, track: fromHub(p.track) }))]
    .sort((a, b) => b.playedAt - a.playedAt)
    .slice(0, 300);
  setQuietly({ playlists: merged, history: plays });
}

let pushTimer: ReturnType<typeof setTimeout> | undefined;
let started = false;

/** Call once at start-up (lib/hubSync.ts runs the syncs). */
export function startLibrarySync() {
  if (started) return;
  started = true;
  switchOwner();

  useHub.subscribe((s, p) => {
    if (s.token !== p.token || s.user?.id !== p.user?.id) switchOwner();
  });

  useLibrary.subscribe((s, p) => {
    if (applying) return;
    const me = ownerOf();
    // keep a copy per profile, so switching back finds it
    write(copyKey(owner), { playlists: s.playlists, history: s.history });
    if (!me || me !== owner) return;
    const st = read<SyncState>(syncKey(me), emptySync());
    let changed = false;
    if (s.playlists !== p.playlists) {
      const before = new Map(p.playlists.map((x) => [x.id, x]));
      for (const x of s.playlists) {
        if (before.get(x.id) !== x && !st.dirty.includes(x.id)) st.dirty.push(x.id);
        before.delete(x.id);
      }
      for (const id of before.keys()) {
        st.dirty = st.dirty.filter((d) => d !== id);
        st.deleted.push({ id, at: Date.now() });
      }
      changed = true;
    }
    if (s.history !== p.history) {
      const newest = p.history[0]?.playedAt ?? 0;
      const fresh = s.history.filter((h) => h.playedAt > newest);
      if (fresh.length) {
        st.plays = [...fresh, ...st.plays].slice(0, 300);
        changed = true;
      }
    }
    if (!changed) return;
    write(syncKey(me), st);
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => syncLibrary().catch(() => useHub.setState({ offline: true })), 3000);
  });
}
