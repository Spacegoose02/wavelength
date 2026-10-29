import { trackArt } from '../lib/artwork';
import { kidSafe } from '../lib/kids';
import { create } from 'zustand';
import { engine } from '../player/engine';
import { getJson } from '../lib/http';
import { parseNowPlaying, parseNowPlayingCover } from '../sources/radio';
import { sourceFor } from '../sources/registry';
import type { Track } from '../sources/types';
import { useSettings } from './settings';
import { useLibrary } from './library';
import { offlinePlaybackUrl } from './offline';

export type Repeat = 'off' | 'all' | 'one';

interface PlayerState {
  queue: Track[];
  index: number;
  playing: boolean;
  buffering: boolean;
  position: number;
  duration: number;
  volume: number;
  shuffle: boolean;
  repeat: Repeat;
  liveTitle?: string;
  /** Radio stations that publish artwork (e.g. SubWave) — overrides the station logo. */
  liveCover?: string;
  error?: string;
  current(): Track | undefined;
  playTracks(tracks: Track[], start?: number, startAt?: number): void;
  enqueue(tracks: Track[]): void;
  playNext(tracks: Track[]): void;
  jump(i: number): void;
  removeAt(i: number): void;
  toggle(): void;
  next(): void;
  prev(): void;
  seek(t: number): void;
  setVolume(v: number): void;
  toggleShuffle(): void;
  cycleRepeat(): void;
}

const savedVolume = (() => {
  try {
    return Number(localStorage.getItem('tonearm.volume') ?? 0.8);
  } catch {
    return 0.8;
  }
})();
engine.setVolume(savedVolume);
// equalizer: apply the saved settings, then follow changes from the EQ panel
engine.setEq(useSettings.getState().eq);
useSettings.subscribe((s, prev) => {
  if (s.eq !== prev.eq) engine.setEq(s.eq);
});

const sourceOf = (t: Track) => {
  const cfg = useSettings.getState().sources.find((s) => s.id === t.sourceId);
  return cfg ? sourceFor(cfg) : undefined;
};

export const usePlayer = create<PlayerState>()((set, get) => ({
  queue: [],
  index: -1,
  playing: false,
  buffering: false,
  position: 0,
  duration: 0,
  volume: savedVolume,
  shuffle: false,
  repeat: 'off',
  current: () => get().queue[get().index],

  playTracks(all, start = 0, startAt = 0) {
    // kid profiles: drop what they may not play, keeping the chosen song's place when it stays
    const tracks = kidSafe(all);
    if (!tracks.length) return;
    if (tracks !== all) start = Math.max(0, tracks.indexOf(all[start]));
    let queue = [...tracks];
    let index = start;
    if (get().shuffle && tracks.length > 1) {
      const first = queue.splice(start, 1)[0];
      queue = [first, ...shuffled(queue)];
      index = 0;
    }
    set({ queue, index });
    loadCurrent(startAt);
  },
  enqueue(all) {
    const tracks = kidSafe(all);
    if (!tracks.length) return;
    const wasEmpty = get().queue.length === 0;
    set((s) => ({ queue: [...s.queue, ...tracks], index: wasEmpty ? 0 : s.index }));
    if (wasEmpty) loadCurrent();
  },
  playNext(all) {
    const tracks = kidSafe(all);
    if (!tracks.length) return;
    if (!get().queue.length) return get().playTracks(tracks);
    set((s) => {
      const queue = [...s.queue];
      queue.splice(s.index + 1, 0, ...tracks);
      return { queue };
    });
  },
  jump(i) {
    if (i < 0 || i >= get().queue.length) return;
    set({ index: i });
    loadCurrent();
  },
  removeAt(i) {
    const { index } = get();
    if (i === index) return;
    set((s) => ({ queue: s.queue.filter((_, j) => j !== i), index: i < index ? index - 1 : index }));
  },
  toggle() {
    if (!get().current()) return;
    if (engine.el.paused) engine.play();
    else engine.pause();
  },
  next() {
    const { index, queue, repeat } = get();
    if (index + 1 < queue.length) set({ index: index + 1 });
    else if (repeat === 'all' && queue.length) set({ index: 0 });
    else {
      engine.pause();
      return;
    }
    loadCurrent();
  },
  prev() {
    if (engine.el.currentTime > 4) return engine.seek(0);
    const { index } = get();
    if (index > 0) {
      set({ index: index - 1 });
      loadCurrent();
    } else engine.seek(0);
  },
  seek: (t) => engine.seek(t),
  setVolume(v) {
    engine.setVolume(v);
    set({ volume: v });
    try {
      localStorage.setItem('tonearm.volume', String(v));
    } catch {
      /* non-essential */
    }
  },
  toggleShuffle() {
    const { shuffle, queue, index } = get();
    if (!shuffle && queue.length > 1) {
      const rest = queue.filter((_, i) => i !== index);
      set({ shuffle: true, queue: [queue[index], ...shuffled(rest)], index: 0 });
    } else set({ shuffle: !shuffle });
  },
  cycleRepeat: () => set((s) => ({ repeat: s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off' })),
}));

function shuffled<T>(arr: T[]) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---- playback lifecycle -------------------------------------------------

let scrobbled = false;
let listened = 0;
let lastTick = 0;
let lastSync = 0;
let nowPlayingTimer: number | undefined;
let loadSeq = 0;
/** blob: URL of the downloaded song playing on Android (see offlinePlaybackUrl) */
let localBlob: string | undefined;

function releaseLocalBlob() {
  if (localBlob) URL.revokeObjectURL(localBlob);
  localBlob = undefined;
}

async function loadCurrent(startAt = 0) {
  const t = usePlayer.getState().current();
  if (!t) return;
  scrobbled = false;
  listened = 0;
  const token = ++loadSeq;
  usePlayer.setState({ position: startAt, duration: t.duration ?? 0, error: undefined, liveTitle: undefined, liveCover: undefined, buffering: true });
  updateMediaSession(t);
  watchNowPlaying(t);
  try {
    // Downloaded on this device? Play the local file — no server, works offline.
    const local = await offlinePlaybackUrl(t);
    if (token !== loadSeq) {
      if (local?.startsWith('blob:')) URL.revokeObjectURL(local);
      return;
    }
    if (local) {
      releaseLocalBlob();
      if (local.startsWith('blob:')) localBlob = local;
      await engine.load(local, startAt);
      if (t.kind === 'track') sourceOf(t)?.scrobble?.(t, false).catch(() => {});
      return;
    }
    // Refresh tokens / open listening sessions (podcast episodes, saved Navidrome tracks…)
    const prepared = (await sourceOf(t)?.prepare?.(t)) ?? { track: t };
    if (token !== loadSeq) return;
    const ready = prepared.track;
    if (ready !== t) {
      usePlayer.setState((s) => ({ queue: s.queue.map((q, i) => (i === s.index ? ready : q)) }));
    }
    if (!ready.streamUrl) throw new Error('No stream for this item');
    releaseLocalBlob();
    await engine.load(ready.streamUrl, startAt || prepared.startAt || 0);
    if (ready.kind === 'track') sourceOf(ready)?.scrobble?.(ready, false).catch(() => {});
  } catch (e) {
    if (token === loadSeq) usePlayer.setState({ error: String((e as Error).message ?? e), buffering: false });
  }
}

engine.on('timeupdate', (_, el) => {
  const st = usePlayer.getState();
  const t = st.current();
  const now = el.currentTime;
  const delta = now - lastTick;
  if (delta > 0 && delta < 2) listened += delta;
  lastTick = now;
  usePlayer.setState({ position: now });
  if (!t) return;
  const dur = el.duration || t.duration || 0;
  if (!scrobbled && t.kind !== 'radio' && dur > 30 && (now > dur / 2 || now > 240)) {
    scrobbled = true;
    useLibrary.getState().recordPlay(t);
    if (t.kind === 'track') sourceOf(t)?.scrobble?.(t, true).catch(() => {});
  }
  if ((t.kind === 'book' || t.kind === 'episode') && Date.now() - lastSync > 15_000) {
    lastSync = Date.now();
    sourceOf(t)?.syncBook?.(t, (t.bookOffset ?? 0) + now, listened).catch(() => {});
    listened = 0;
  }
  if ('mediaSession' in navigator && Number.isFinite(dur) && dur > 0) {
    try {
      navigator.mediaSession.setPositionState({ duration: dur, position: Math.min(now, dur), playbackRate: 1 });
    } catch {
      /* ignore */
    }
  }
});
engine.on('durationchange', (_, el) => {
  if (Number.isFinite(el.duration)) usePlayer.setState({ duration: el.duration });
});
engine.on('play', () => usePlayer.setState({ playing: true }));
engine.on('playing', () => usePlayer.setState({ playing: true, buffering: false }));
engine.on('waiting', () => usePlayer.setState({ buffering: true }));
engine.on('pause', () => usePlayer.setState({ playing: false }));
engine.on('error', (_, el) => usePlayer.setState({ error: `Playback failed (code ${el.error?.code ?? '?'})`, buffering: false, playing: false }));
engine.on('ended', () => {
  const st = usePlayer.getState();
  if (st.repeat === 'one') {
    engine.seek(0);
    engine.play();
  } else st.next();
});

function watchNowPlaying(t: Track) {
  window.clearInterval(nowPlayingTimer);
  if (t.kind !== 'radio' || !t.nowPlayingUrl) return;
  const poll = async () => {
    try {
      const json = await getJson(t.nowPlayingUrl!);
      const title = parseNowPlaying(json, t.streamUrl);
      const cover = parseNowPlayingCover(json, t.nowPlayingUrl!);
      if (usePlayer.getState().current() === t) {
        usePlayer.setState({ liveTitle: title, liveCover: cover });
        if (title) updateMediaSession(t, title, cover);
      }
    } catch {
      /* station has no metadata endpoint */
    }
  };
  poll();
  nowPlayingTimer = window.setInterval(poll, 15_000);
}

function updateMediaSession(t: Track, live?: string, cover?: string) {
  if (!('mediaSession' in navigator)) return;
  const art = cover ?? trackArt(t);
  navigator.mediaSession.metadata = new MediaMetadata({
    title: live ?? t.title,
    artist: live ? t.title : t.artist,
    album: t.album ?? '',
    artwork: art ? [{ src: art, sizes: '500x500' }] : [],
  });
}

if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  ms.setActionHandler('play', () => engine.play());
  ms.setActionHandler('pause', () => engine.pause());
  ms.setActionHandler('nexttrack', () => usePlayer.getState().next());
  ms.setActionHandler('previoustrack', () => usePlayer.getState().prev());
  ms.setActionHandler('seekto', (d) => d.seekTime != null && engine.seek(d.seekTime));
}
