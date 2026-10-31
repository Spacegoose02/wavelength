import { trackArt } from '../lib/artwork';
import { kidSafe } from '../lib/kids';
import { create } from 'zustand';
import { engine } from '../player/engine';
import { getJson } from '../lib/http';
import { parseNowPlaying, parseNowPlayingCover, streamTitle } from '../sources/radio';
import { sourceFor } from '../sources/registry';
import type { Track } from '../sources/types';
import { useSettings } from './settings';
import { useLibrary } from './library';
import { offlinePlaybackUrl, trackKey, useOffline } from './offline';
import { isAndroid } from '../lib/platform';
import { replayGainFactor } from '../player/replayGain';

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
  if (s.playback !== prev.playback) applyLevel(usePlayer.getState().current());
});

/** ReplayGain for a song (music only: radio, books and podcasts play as they are). */
function applyLevel(t: Track | undefined) {
  const { replayGain, replayGainPreamp } = useSettings.getState().playback;
  engine.setLevel(t?.kind === 'track' ? replayGainFactor(t.replayGain, replayGain, replayGainPreamp) : 1);
}

/** Sleep timer "end of this song" (lib/sleep.ts): stop when the current song ends instead of going on. */
let stopAfterTrack: (() => void) | undefined;
export const setStopAfterTrack = (fn?: () => void) => {
  stopAfterTrack = fn;
};

const sourceOf = (t: Track) => {
  const cfg = useSettings.getState().sources.find((s) => s.id === t.sourceId);
  return cfg ? sourceFor(cfg) : undefined;
};

/**
 * While this device is a guest in a listening party (lib/together.ts), the person's own queue and transport
 * actions go to the host instead. Returns true when it took the action.
 */
export type PlayerIntercept = (op: 'enqueue' | 'playNext' | 'next' | 'prev' | 'toggle' | 'seek' | 'ended', arg?: Track[] | number) => boolean;
let intercept: PlayerIntercept | undefined;
export const setPlayerIntercept = (fn?: PlayerIntercept) => {
  intercept = fn;
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
    if (intercept?.('enqueue', all)) return;
    const tracks = kidSafe(all);
    if (!tracks.length) return;
    const wasEmpty = get().queue.length === 0;
    set((s) => ({ queue: [...s.queue, ...tracks], index: wasEmpty ? 0 : s.index }));
    if (wasEmpty) loadCurrent();
  },
  playNext(all) {
    if (intercept?.('playNext', all)) return;
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
    if (intercept?.('toggle')) return;
    if (engine.el.paused) engine.play();
    else engine.pause();
  },
  next() {
    if (intercept?.('next')) return;
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
    if (intercept?.('prev')) return;
    if (engine.el.currentTime > 4) return engine.seek(0);
    const { index } = get();
    if (index > 0) {
      set({ index: index - 1 });
      loadCurrent();
    } else engine.seek(0);
  },
  seek: (t) => void (intercept?.('seek', t) || engine.seek(t)),
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

/** Fresh state for a song that's starting: position, now-playing info, ReplayGain. Returns its load token. */
function begin(t: Track, startAt: number) {
  scrobbled = false;
  listened = 0;
  usePlayer.setState({ position: startAt, duration: t.duration ?? 0, error: undefined, liveTitle: undefined, liveCover: undefined, buffering: true });
  updateMediaSession(t);
  watchNowPlaying(t);
  applyLevel(t);
  aheadFor = undefined;
  return ++loadSeq;
}

async function loadCurrent(startAt = 0) {
  const t = usePlayer.getState().current();
  if (!t) return;
  const token = begin(t, startAt);
  try {
    // Loaded ahead on the idle deck while the last song played: starts with no gap
    if (ahead?.key === trackKey(t)) {
      const { url } = ahead;
      ahead = undefined;
      releaseLocalBlob();
      await engine.load(url, startAt);
      if (t.kind === 'track') sourceOf(t)?.scrobble?.(t, false).catch(() => {});
      return;
    }
    ahead = undefined;
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

// ---- gapless and crossfade ------------------------------------------------

/** The next song, loaded ahead on the idle deck (engine.preload): which song and its stream URL. */
let ahead: { key: string; url: string } | undefined;
/** the song we last started preparing ahead, so it's only done once */
let aheadFor: string | undefined;
const AHEAD_SECONDS = 20;

/** Index of the song after the current one, as next() would pick it. */
function nextIndex(): number | undefined {
  const { queue, index, repeat } = usePlayer.getState();
  if (repeat === 'one') return undefined;
  if (index + 1 < queue.length) return index + 1;
  return repeat === 'all' && queue.length > 1 ? 0 : undefined;
}

/**
 * Near the end of a song: get the next one's stream ready on the idle deck. Music only, not while a listening
 * party or the sleep timer is in charge, and not for downloaded songs on Android (they load whole into memory).
 */
async function prepareAhead(cur: Track) {
  const i = nextIndex();
  const next = i === undefined ? undefined : usePlayer.getState().queue[i];
  if (!next || cur.kind !== 'track' || next.kind !== 'track' || intercept || stopAfterTrack) return;
  const key = trackKey(next);
  if (aheadFor === key) return;
  aheadFor = key;
  try {
    if (useOffline.getState().tracks[key]) {
      if (isAndroid) return;
      const local = await offlinePlaybackUrl(next);
      if (local) {
        engine.preload(local);
        ahead = { key, url: local };
      }
      return;
    }
    const ready = ((await sourceOf(next)?.prepare?.(next)) ?? { track: next }).track;
    if (!ready.streamUrl || usePlayer.getState().queue[i!] !== next) return;
    if (ready !== next) usePlayer.setState((s) => ({ queue: s.queue.map((q, j) => (j === i ? ready : q)) }));
    engine.preload(ready.streamUrl);
    ahead = { key, url: ready.streamUrl };
  } catch {
    /* it just loads normally when its turn comes */
  }
}

/** Crossfade into the preloaded next song when the current one is `remaining` seconds from its end. */
function maybeCrossfade(remaining: number) {
  const seconds = useSettings.getState().playback.crossfade;
  if (!seconds || !ahead || remaining > seconds || stopAfterTrack || intercept) return;
  const i = nextIndex();
  const next = i === undefined ? undefined : usePlayer.getState().queue[i];
  if (!next || trackKey(next) !== ahead.key) return;
  const { replayGain, replayGainPreamp } = useSettings.getState().playback;
  const url = ahead.url;
  if (!engine.crossfade(url, Math.max(1, remaining), replayGainFactor(next.replayGain, replayGain, replayGainPreamp))) return;
  ahead = undefined;
  usePlayer.setState({ index: i! });
  begin(next, 0);
  usePlayer.setState({ buffering: false });
  sourceOf(next)?.scrobble?.(next, false).catch(() => {});
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
  if (t.kind === 'track' && dur > 0) {
    const remaining = dur - now;
    if (remaining < AHEAD_SECONDS) void prepareAhead(t);
    maybeCrossfade(remaining);
  }
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
  if (stopAfterTrack) {
    const done = stopAfterTrack;
    stopAfterTrack = undefined;
    return done();
  }
  if (intercept?.('ended')) return;
  const st = usePlayer.getState();
  if (st.repeat === 'one') {
    engine.seek(0);
    engine.play();
  } else st.next();
});

/**
 * Radio: every 15 s, the station's now-playing page (SUB/WAVE, AzuraCast, Icecast `status-json.xsl`…) and,
 * when that gives nothing, the title inside the stream itself (ICY metadata, sources/radio.ts streamTitle).
 * Whichever answers first is used from then on.
 */
function watchNowPlaying(t: Track) {
  window.clearInterval(nowPlayingTimer);
  if (t.kind !== 'radio') return;
  let use: 'page' | 'stream' | undefined;
  const noPage = !t.nowPlayingUrl;
  let noStream = !t.streamUrl;
  if (noPage && noStream) return;
  const fromPage = async () => {
    try {
      const json = await getJson(t.nowPlayingUrl!);
      return { title: parseNowPlaying(json, t.streamUrl), cover: parseNowPlayingCover(json, t.nowPlayingUrl!) };
    } catch {
      return undefined; // no such page, or not reachable right now
    }
  };
  const fromStream = async () => {
    try {
      const title = await streamTitle(t.streamUrl!);
      if (title === null) noStream = true;
      return { title: title || undefined, cover: undefined };
    } catch {
      return undefined; // couldn't reach it this time; try again next poll
    }
  };
  const poll = async () => {
    let got: { title?: string; cover?: string } | undefined;
    if (use !== 'stream' && !noPage) {
      got = await fromPage();
      if (got?.title) use = 'page';
    }
    if (!got?.title && use !== 'page' && !noStream) {
      got = await fromStream();
      if (got?.title) use = 'stream';
    }
    if (noPage && noStream) window.clearInterval(timer);
    if (!got) return; // couldn't reach the station this time: keep the last title
    // some stations send their own name as the "song"
    const title = got.title && got.title.toLowerCase() !== t.title.toLowerCase() ? got.title : undefined;
    if (usePlayer.getState().current() === t) {
      usePlayer.setState({ liveTitle: title, liveCover: got.cover });
      if (title) updateMediaSession(t, title, got.cover);
    }
  };
  const timer = window.setInterval(poll, 15_000);
  nowPlayingTimer = timer;
  poll();
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
