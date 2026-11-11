/**
 * Pick up where you left off (docs/USER-GUIDE.md "Pick up where you left off"): the queue, the song and the spot
 * in it are saved on this device as you listen, and come back paused after the app restarts (Android closing it in
 * the background, quitting the desktop app). Nothing loads until you press play. Audiobooks reopen on the server,
 * so they resume where Audiobookshelf says you are (which may be further on, from another device).
 *
 * Per device and per profile; turn it off in Settings → Playback → Pick up where you left off.
 */
import { useSettings } from '../store/settings';
import { restoreQueue, usePlayer } from '../store/player';
import { useHub } from '../store/hub';
import { sourceFor } from '../sources/registry';
import type { Track } from '../sources/types';
import { engine } from '../player/engine';
import { RESUME_KEY, storable, trimQueue, usable, type SavedQueue } from './resumeQueue';

const who = () => String(useHub.getState().user?.id ?? 'local');
const regenerates = (t: Track) => t.kind === 'episode' || t.kind === 'book' || !!sourceOf(t)?.prepare;
function sourceOf(t: Track) {
  const cfg = useSettings.getState().sources.find((s) => s.id === t.sourceId);
  return cfg ? sourceFor(cfg) : undefined;
}

function read(): SavedQueue | null {
  try {
    return JSON.parse(localStorage.getItem(RESUME_KEY) ?? 'null');
  } catch {
    return null;
  }
}

let lastJson = '';
function save() {
  if (!useSettings.getState().resume) return;
  const { queue, index, position } = usePlayer.getState();
  const t = queue[index];
  try {
    if (!t) {
      if (lastJson) localStorage.removeItem(RESUME_KEY);
      lastJson = '';
      return;
    }
    const kept = trimQueue(queue, index);
    // a radio station starts live, not at a spot
    const at = t.kind === 'radio' ? 0 : Math.max(0, Math.floor(position));
    const data: SavedQueue = { v: 1, who: who(), queue: kept.queue.map((q) => storable(q, regenerates)), index: kept.index, at, savedAt: Date.now() };
    const json = JSON.stringify(data);
    if (json.length > 2_000_000) return; // something odd; don't fill the storage
    localStorage.setItem(RESUME_KEY, json);
    lastJson = json;
  } catch {
    /* storage full or blocked: nothing to resume next time */
  }
}

/** Reopen an audiobook on the server and play from where it says you are. */
async function reopenBook(t: Track) {
  const src = sourceOf(t);
  if (!src?.startBook || !t.bookId) return;
  const { tracks, resumeAt } = await src.startBook(t.bookId);
  if (!tracks.length) return;
  let idx = tracks.findIndex((x) => resumeAt >= (x.bookOffset ?? 0) && resumeAt < (x.bookOffset ?? 0) + (x.duration ?? 0));
  if (idx < 0) idx = 0;
  usePlayer.getState().playTracks(tracks, idx, Math.max(0, resumeAt - (tracks[idx].bookOffset ?? 0)));
}

let started = false;
export function startResume() {
  if (started) return;
  started = true;
  // put the saved queue back once the settings and the Hub sign-in are read (they come from the keychain)
  const restore = () => {
    const saved = useSettings.getState().resume ? usable(read(), who()) : undefined;
    if (!saved) return;
    const t = saved.queue[saved.index];
    restoreQueue(saved.queue, saved.index, saved.at, t.kind === 'book' ? () => void reopenBook(t).catch(() => {}) : undefined);
  };
  const hydrated = () => useSettings.persist.hasHydrated() && useHub.persist.hasHydrated();
  if (hydrated()) restore();
  else {
    let done = false;
    const check = () => {
      if (done || !hydrated()) return;
      done = true;
      restore();
    };
    useSettings.persist.onFinishHydration(check);
    useHub.persist.onFinishHydration(check);
  }
  // save on every change of song or queue, every 10 s while playing, and when the app goes to the background
  let timer: number | undefined;
  usePlayer.subscribe((s, p) => {
    if (s.queue !== p.queue || s.index !== p.index || s.playing !== p.playing) {
      window.clearTimeout(timer);
      timer = window.setTimeout(save, 500);
    }
  });
  window.setInterval(() => {
    if (!engine.el.paused) save();
  }, 10_000);
  const now = () => save();
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && now());
  window.addEventListener('pagehide', now);
  useSettings.subscribe((s, p) => {
    if (p.resume && !s.resume) {
      try {
        localStorage.removeItem(RESUME_KEY);
      } catch {
        /* nothing */
      }
    }
  });
}
