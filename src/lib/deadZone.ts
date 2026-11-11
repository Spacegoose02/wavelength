import { http, isTauri } from './http';
import { featureOn } from './features';
import { kidSafe } from './kids';
import { onCellular } from './smartOffline';
import { sonicOn, soundsLike } from './sonic';
import { songRadio } from './songRadio';
import type { Track } from '../sources/types';
import { useLibrary } from '../store/library';
import { collectionTracks, trackKey, useOffline } from '../store/offline';
import { setDeadZoneHook, signalBack, usePlayer, type Repeat } from '../store/player';
import { useSettings } from '../store/settings';
export { DEFAULT_DEAD_ZONE, type DeadZoneSettings } from '../store/settings';

/**
 * Dead zone cushion: music keeps playing through a stretch with no signal (a tunnel, the countryside, a lift).
 *
 * Wavelength streams from your own server, so with no signal the song playing stops when its buffer runs out
 * and every song after it fails. The cushion keeps two small rolling caches on the device, as offline
 * collections of kind `cushion` (store/offline.ts):
 *
 * - `cushion:ahead`: the queue from the song playing onward, about `minutes` of it. Those songs then play from
 *   the file (store/player.ts `loadCurrent` already prefers a saved song), so the queue just carries on.
 * - `cushion:similar`: about `minutes` of songs like the one playing ("Sounds like this" on the Hub when there is
 *   one, else song radio), rebuilt every half hour of listening. These stand in when the queue ahead runs out.
 *
 * When a stream fails or stalls, the player asks `check()` whether the server is reachable. If it isn't, the
 * player puts a stand-in (`standIn`) in front of the song that couldn't play and plays that, and keeps doing so
 * until the signal is back; then the queue picks up again from the song that was cut off. Stand-ins come from
 * the similar-songs cache first, then smart offline's shelves, then anything else downloaded.
 *
 * Per device, not synced. Windows and Android app only (a browser can't keep files). Settings → Downloads →
 * Dead zones. A Hub admin switching smart offline off (lib/features.ts `smartOffline`) switches this off too.
 */

export const AHEAD_ID = 'cushion:ahead';
export const SIMILAR_ID = 'cushion:similar';
/** a song with no duration counts as this long, seconds */
const AVG_SECONDS = 240;
/** rebuild the similar songs after this much listening */
const SIMILAR_EVERY = 30 * 60_000;
/** how long to wait for the server to answer a "are you there?" check */
const PROBE_TIMEOUT = 5000;
/** how often to look for the signal coming back */
const PROBE_EVERY = 15_000;

/**
 * The songs to keep ready from the queue: the one playing and those after it, until `seconds` of music.
 * Music only (radio, books and podcasts aren't cached). Wraps round when the queue repeats.
 */
export function aheadPlan(queue: Track[], index: number, repeat: Repeat, seconds: number): Track[] {
  const out: Track[] = [];
  if (index < 0) return out;
  const seen = new Set<string>();
  let total = 0;
  for (let i = 0; i < queue.length && total < seconds; i++) {
    let j = index + i;
    if (j >= queue.length) {
      if (repeat !== 'all') break;
      j -= queue.length;
    }
    const t = queue[j];
    if (t.kind !== 'track' || seen.has(trackKey(t))) continue;
    seen.add(trackKey(t));
    out.push(t);
    total += t.duration || AVG_SECONDS;
  }
  return out;
}

/** Up to `seconds` of `tracks`, leaving out songs in `skip` and repeats. */
export function fill(tracks: Track[], skip: Set<string>, seconds: number): Track[] {
  const out: Track[] = [];
  const seen = new Set(skip);
  let total = 0;
  for (const t of tracks) {
    if (total >= seconds) break;
    if (t.kind !== 'track' || seen.has(trackKey(t))) continue;
    seen.add(trackKey(t));
    out.push(t);
    total += t.duration || AVG_SECONDS;
  }
  return out;
}

/**
 * The saved song to play next while there's no signal: the first one in `lists` (in order of preference) that
 * hasn't stood in yet this time (`used`) and wasn't played lately (`recent`). When everything has, played-lately
 * songs are allowed again, then songs that already stood in (oldest first), so the music never just stops while
 * something is saved.
 */
export function pickStandIn(lists: Track[][], used: string[], recent: Set<string>, instead?: Track): Track | undefined {
  const all = lists.flat().filter((t) => t.kind === 'track' && (!instead || trackKey(t) !== trackKey(instead)));
  const usedSet = new Set(used);
  return (
    all.find((t) => !usedSet.has(trackKey(t)) && !recent.has(trackKey(t))) ??
    all.find((t) => !usedSet.has(trackKey(t))) ??
    used.map((k) => all.find((t) => trackKey(t) === k)).find(Boolean)
  );
}

// ---- is the server there? -----------------------------------------------

let offline = false;
let probeTimer: number | undefined;
/** songs that stood in during this dead zone, oldest first */
let used: string[] = [];

const on = () => isTauri && featureOn('smartOffline') && useSettings.getState().deadZone.enabled;

/** The music server to check: the one the song playing comes from, else the first one turned on. */
function serverUrl(): string | undefined {
  const sources = useSettings.getState().sources.filter((s) => s.enabled && s.url);
  const t = usePlayer.getState().current();
  return (sources.find((s) => s.id === t?.sourceId) ?? sources[0])?.url;
}

/** True when the server answered at all (any status: a 401 still means the network works). */
async function reachable(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  const url = serverUrl();
  if (!url) return false;
  const ctl = new AbortController();
  let timer: number | undefined;
  const timeout = new Promise<false>((res) => {
    timer = window.setTimeout(() => {
      ctl.abort();
      res(false);
    }, PROBE_TIMEOUT);
  });
  try {
    return await Promise.race([http(url, { method: 'GET', signal: ctl.signal }).then(() => true, () => false), timeout]);
  } finally {
    window.clearTimeout(timer);
  }
}

function goneOffline() {
  if (offline) return;
  offline = true;
  used = [];
  window.clearInterval(probeTimer);
  probeTimer = window.setInterval(() => void lookForSignal(), PROBE_EVERY);
}

async function lookForSignal() {
  if (!offline || !(await reachable())) return;
  offline = false;
  window.clearInterval(probeTimer);
  probeTimer = undefined;
  signalBack();
  schedule(1000);
}

async function check(): Promise<boolean> {
  if (!on()) return false;
  if (await reachable()) {
    if (offline) void lookForSignal();
    return false;
  }
  goneOffline();
  return true;
}

function standIn(instead?: Track): Track | undefined {
  const off = useOffline.getState();
  const byId = (id: string) => off.collections.find((c) => c.id === id);
  const similar = byId(SIMILAR_ID);
  const lists = [
    similar ? collectionTracks(similar) : [],
    // smart offline's shelves (favourites, mixes, played lately), then everything else downloaded
    ...off.collections.filter((c) => c.kind === 'auto').map(collectionTracks),
    ...off.collections.filter((c) => c.kind === 'album' || c.kind === 'playlist').map(collectionTracks),
  ].map(kidSafe);
  const recent = new Set(useLibrary.getState().history.slice(-40).map((p) => trackKey(p.track)));
  const pick = pickStandIn(lists, used, recent, instead);
  if (pick) used = [...used.filter((k) => k !== trackKey(pick)), trackKey(pick)];
  return pick;
}

// ---- keeping the cushion filled -----------------------------------------

let busy = false;
let again = false;
let similarAt = 0;
let timer: number | undefined;

function schedule(ms = 4000) {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void refresh(), ms);
}

/** Bring both caches up to date with the queue. One run at a time; changes during a run cause one more. */
export async function refresh(): Promise<void> {
  if (busy) {
    again = true;
    return;
  }
  busy = true;
  try {
    do {
      again = false;
      await refreshOnce();
    } while (again);
  } finally {
    busy = false;
  }
}

async function refreshOnce() {
  const cfg = useSettings.getState().deadZone;
  const off = useOffline.getState();
  if (!on()) {
    // turned off: give the space back
    for (const c of off.collections.filter((c) => c.kind === 'cushion')) await off.remove(c.id);
    return;
  }
  if (offline || (cfg.wifiOnly && onCellular())) return;
  const p = usePlayer.getState();
  const seconds = cfg.minutes * 60;

  const ahead = kidSafe(aheadPlan(p.queue, p.index, p.repeat, seconds));
  await save(AHEAD_ID, 'Up next (for dead zones)', ahead);

  const cur = p.current();
  if (!cfg.similar) {
    if (useOffline.getState().collections.some((c) => c.id === SIMILAR_ID)) await useOffline.getState().remove(SIMILAR_ID);
    return;
  }
  if (!cur || cur.kind !== 'track') return;
  const have = useOffline.getState().collections.some((c) => c.id === SIMILAR_ID);
  if (have && Date.now() - similarAt < SIMILAR_EVERY) return;
  similarAt = Date.now();
  const like = await (sonicOn() ? soundsLike(cur) : songRadio({ artist: cur.artist, title: cur.title, track: cur })).catch(() => [] as Track[]);
  const picks = fill(kidSafe(like), new Set(ahead.map(trackKey)), seconds);
  if (picks.length) await save(SIMILAR_ID, `Like ${cur.artist} (for dead zones)`, picks);
}

/** Make collection `id` exactly these songs: drop the ones that left it, download the new ones. */
async function save(id: string, name: string, tracks: Track[]) {
  const off = useOffline.getState();
  if (!tracks.length) {
    if (off.collections.some((c) => c.id === id)) await off.remove(id);
    return;
  }
  await off.trim(id, tracks.map(trackKey));
  await useOffline.getState().download({ id, kind: 'cushion', name, cover: tracks.find((t) => t.coverUrl)?.coverUrl, tracks });
}

/** Start watching the queue (App.tsx). Windows and Android app only. */
export function startDeadZone() {
  if (!isTauri) return;
  setDeadZoneHook({ offline: () => offline && on(), check, standIn });
  usePlayer.subscribe((s, prev) => {
    if (s.queue !== prev.queue || s.index !== prev.index || s.repeat !== prev.repeat) schedule();
  });
  useSettings.subscribe((s, prev) => {
    if (s.deadZone !== prev.deadZone) schedule(500);
  });
  // the system says the network is back: check now rather than at the next look
  window.addEventListener('online', () => void lookForSignal());
  window.addEventListener('offline', () => on() && goneOffline());
}
