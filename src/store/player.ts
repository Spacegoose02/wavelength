import { trackArt } from '../lib/artwork';
import { kidSafe } from '../lib/kids';
import { create } from 'zustand';
import { engine } from '../player/engine';
import { getJson } from '../lib/http';
import { parseNowPlaying, parseNowPlayingCover, streamTitle } from '../sources/radio';
import { sourceFor } from '../sources/registry';
import { deezerLookup, previewExpired } from '../sources/charts';
import type { Track } from '../sources/types';
import { useSettings } from './settings';
import { useLibrary } from './library';
import { offlinePlaybackUrl, trackKey, useOffline } from './offline';
import { isAndroid } from '../lib/platform';
import { replayGainFactor } from '../player/replayGain';
import { planTransition, toNextBeat, type SoundInfo, type Transition } from '../player/automix';
import { featuresFor } from '../lib/sonic';
import { featureOn } from '../lib/features';

export type Repeat = 'off' | 'all' | 'one';

/**
 * Who started the queue that's playing: you (a song, album or playlist you picked, anywhere in the app), the AI DJ
 * chat (`dj`, lib/dj.ts) or DJ mode (`station`, lib/djStation.ts). DJ Trash Panda only talks over, and only keeps
 * going on, music it started: a queue you start yourself ends any DJ session (docs/AI-DJ.md "Who's in charge").
 */
export type QueueBy = 'you' | 'dj' | 'station';

export interface PlayerState {
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
  /** Counts new queues (each playTracks), so the DJ can tell a queue you started from songs added to its own. */
  queueId: number;
  /** Who started the queue that's playing (`QueueBy`). */
  queueBy: QueueBy;
  /** The queue ran out: the last song finished (or couldn't play) and nothing came after it. */
  ranOut: boolean;
  /** No signal: the music server can't be reached, so saved songs are standing in (lib/deadZone.ts). */
  noSignal: boolean;
  current(): Track | undefined;
  playTracks(tracks: Track[], start?: number, startAt?: number, by?: QueueBy): void;
  enqueue(tracks: Track[]): void;
  playNext(tracks: Track[]): void;
  jump(i: number, startAt?: number): void;
  removeAt(i: number): void;
  toggle(): void;
  next(): void;
  prev(): void;
  seek(t: number): void;
  /** Jump `seconds` back (negative) or on, across an audiobook's files when it has several. */
  skipBy(seconds: number): void;
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

/** Audiobook and podcast speed (lib/spoken.ts plugs in here, since it imports this store); music plays at 1. */
let spokenSpeed: ((t: Track) => number) | undefined;
export const setSpokenSpeed = (fn?: (t: Track) => number) => {
  spokenSpeed = fn;
};

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
export type PlayerIntercept = (op: 'play' | 'enqueue' | 'playNext' | 'next' | 'prev' | 'toggle' | 'seek' | 'ended', arg?: Track[] | number) => boolean;
let intercept: PlayerIntercept | undefined;
export const setPlayerIntercept = (fn?: PlayerIntercept) => {
  intercept = fn;
};

/**
 * Dead zone cushion (lib/deadZone.ts) plugs in here, so this store doesn't import it (it imports this store).
 * `offline()`: the music server looked unreachable last time anyone checked. `check()`: look now (resolves true
 * when it's unreachable, and starts watching for the signal to come back). `standIn(t)`: a saved song to play in
 * place of `t` while there's no signal, or undefined when there's nothing left to play.
 */
export interface DeadZoneHook {
  offline(): boolean;
  check(): Promise<boolean>;
  standIn(instead?: Track): Track | undefined;
}
let deadZone: DeadZoneHook | undefined;
export const setDeadZoneHook = (h?: DeadZoneHook) => {
  deadZone = h;
};

/** Whether a song plays without the network: downloaded on this device (and not going to a speaker). */
const isSaved = (t: Track) => !engine.isRemote() && !!useOffline.getState().tracks[trackKey(t)];

/**
 * No signal and `t` isn't saved: put a saved song in front of it and play that instead. `t` stays where it was in
 * the queue, so once the signal is back it plays when the stand-in ends. Returns true when it did.
 */
function standInFor(t: Track | undefined, at: number): boolean {
  if (!deadZone || intercept || (t && (t.kind !== 'track' || isSaved(t)))) return false;
  const s = deadZone.standIn(t);
  if (!s) return false;
  usePlayer.setState((st) => {
    const queue = [...st.queue];
    queue.splice(at, 0, s);
    return { queue, index: at, noSignal: true };
  });
  failStreak = 0;
  void loadCurrent();
  return true;
}

export const usePlayer = create<PlayerState>()((set, get) => ({
  queue: [],
  index: -1,
  queueId: 0,
  queueBy: 'you',
  ranOut: false,
  noSignal: false,
  playing: false,
  buffering: false,
  position: 0,
  duration: 0,
  volume: savedVolume,
  shuffle: false,
  repeat: 'off',
  current: () => get().queue[get().index],

  playTracks(all, start = 0, startAt = 0, by = 'you') {
    // a listening-party guest playing something: it goes to the host rather than out of step with the party
    if (intercept?.('play', all.slice(start))) return;
    // kid profiles: drop what they may not play, keeping the chosen song's place when it stays
    const tracks = kidSafe(all);
    if (!tracks.length) return;
    if (tracks !== all) {
      const chosen = tracks.indexOf(all[start]);
      if (chosen >= 0) start = chosen;
      else if (get().shuffle) start = Math.floor(Math.random() * tracks.length); // Shuffle: not always the first song
      else {
        // the chosen song is hidden: start at the next one that isn't
        const kept = new Set(tracks);
        const after = all.slice(start).find((t) => kept.has(t));
        start = after ? tracks.indexOf(after) : 0;
      }
    }
    let queue = [...tracks];
    let index = start;
    if (get().shuffle && tracks.length > 1) {
      const first = queue.splice(start, 1)[0];
      queue = [first, ...shuffled(queue)];
      index = 0;
    }
    set((s) => ({ queue, index, queueId: s.queueId + 1, queueBy: by }));
    failStreak = 0;
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
  jump(i, startAt = 0) {
    if (i < 0 || i >= get().queue.length) return;
    set({ index: i });
    failStreak = 0;
    loadCurrent(startAt);
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
    // the queue ran out with no signal (DJ mode and song radio can't fetch more): keep going on saved songs
    else if (deadZone?.offline() && queue.length && standInFor(undefined, queue.length)) return;
    else {
      engine.pause();
      set({ ranOut: true });
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
  skipBy(seconds) {
    const t = get().current();
    if (!t || t.kind === 'radio') return;
    const pos = engine.el.currentTime;
    if (t.kind === 'book') return seekBook((t.bookOffset ?? 0) + pos + seconds);
    const dur = engine.el.duration || t.duration || 0;
    get().seek(Math.max(0, dur ? Math.min(dur - 1, pos + seconds) : pos + seconds));
  },
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
/** The song playing is coming over the network (not from a downloaded file). */
let fromStream = false;

function releaseLocalBlob() {
  if (localBlob) URL.revokeObjectURL(localBlob);
  localBlob = undefined;
}

/** Fresh state for a song that's starting: position, now-playing info, ReplayGain. Returns its load token. */
function begin(t: Track, startAt: number) {
  scrobbled = false;
  listened = 0;
  waitingForSignal = false;
  usePlayer.setState({ position: startAt, duration: t.duration ?? 0, error: undefined, liveTitle: undefined, liveCover: undefined, buffering: true, ranOut: false });
  armStallWatch(false);
  updateMediaSession(t);
  watchNowPlaying(t);
  applyLevel(t);
  engine.setSpeed(spokenSpeed?.(t) ?? 1);
  aheadFor = undefined;
  engine.setMeta({ title: t.title, artist: t.artist, album: t.album, cover: t.coverUrl, duration: t.duration });
  return ++loadSeq;
}

/** Load the current song again at `startAt` (casting moved playback to a speaker or back here). */
export function reloadCurrent(startAt: number, play: boolean) {
  ahead = undefined;
  void loadCurrent(startAt).then(() => {
    if (!play) engine.pause();
  });
}

/**
 * A 30s Deezer clip whose signed link has run out (Discover charts, the Weekly Mix and Release Radar keep links for
 * hours or days): ask Deezer for a fresh one, so it plays instead of failing with "Playback failed".
 */
async function freshPreview(t: Track): Promise<{ track: Track; startAt?: number }> {
  if (t.sourceId !== 'preview' || !t.streamUrl || !previewExpired(t.streamUrl)) return { track: t };
  const found = await deezerLookup({ title: t.title, artist: t.artist ?? '' }).catch(() => ({}) as { preview?: string });
  return { track: found.preview ? { ...t, streamUrl: found.preview } : t };
}

async function loadCurrent(startAt = 0) {
  const t = usePlayer.getState().current();
  if (!t) return;
  const token = begin(t, startAt);
  try {
    // Loaded ahead on the idle deck while the last song played: starts with no gap
    if (ahead?.key === trackKey(t)) {
      const { url, local } = ahead;
      ahead = undefined;
      releaseLocalBlob();
      fromStream = !local;
      await engine.load(url, startAt);
      if (t.kind === 'track') sourceOf(t)?.scrobble?.(t, false).catch(() => {});
      return;
    }
    ahead = undefined;
    // Downloaded on this device? Play the local file — no server, works offline. (Not to a speaker: it can't reach it.)
    const local = engine.isRemote() ? undefined : await offlinePlaybackUrl(t);
    if (token !== loadSeq) {
      if (local?.startsWith('blob:')) URL.revokeObjectURL(local);
      return;
    }
    if (local) {
      releaseLocalBlob();
      if (local.startsWith('blob:')) localBlob = local;
      fromStream = false;
      await engine.load(local, startAt);
      if (t.kind === 'track') sourceOf(t)?.scrobble?.(t, false).catch(() => {});
      return;
    }
    // No signal (lib/deadZone.ts): don't wait for a server we know is out of reach, play a saved song first
    if (deadZone?.offline() && standInFor(t, usePlayer.getState().index)) return;
    if (t.kind === 'track' && usePlayer.getState().noSignal && !deadZone?.offline()) usePlayer.setState({ noSignal: false });
    // a song that was cut off by a dead zone picks up where it stopped
    if (!startAt && resumeAt?.key === trackKey(t)) startAt = resumeAt.at;
    resumeAt = undefined;
    // Refresh tokens / open listening sessions (podcast episodes, saved Navidrome tracks…)
    const prepared = (await sourceOf(t)?.prepare?.(t)) ?? (await freshPreview(t));
    if (token !== loadSeq) return;
    const ready = prepared.track;
    if (ready !== t) {
      usePlayer.setState((s) => ({ queue: s.queue.map((q, i) => (i === s.index ? ready : q)) }));
    }
    if (!ready.streamUrl) throw new Error('No stream for this item');
    releaseLocalBlob();
    fromStream = true;
    await engine.load(ready.streamUrl, startAt || prepared.startAt || 0);
    if (ready.kind === 'track') sourceOf(ready)?.scrobble?.(ready, false).catch(() => {});
  } catch (e) {
    if (token === loadSeq) failed(String((e as Error).message ?? e));
  }
}

// ---- songs that won't play ------------------------------------------------

/** Songs in a row that failed to play; after MAX_FAILS the player stops instead of running through the queue. */
let failStreak = 0;
const MAX_FAILS = 3;
let skipTimer: number | undefined;

/**
 * A song couldn't load or play: say so, and move on to the next one after a moment (a missing song shouldn't
 * stop a whole album). Not while a listening party's host is in charge, and not past the end of the queue.
 */
function failed(message: string, stalled = false) {
  window.clearTimeout(skipTimer);
  armStallWatch(false);
  const t = usePlayer.getState().current();
  // The song was streaming, and the dead zone cushion has saved it since: carry on from the file
  if (t && t.kind === 'track' && fromStream && isSaved(t) && !intercept) {
    rememberSpot(t);
    fromStream = false;
    void loadCurrent(resumeAt?.at ?? 0);
    resumeAt = undefined;
    return;
  }
  // A streamed song failed: if it's because the signal went (lib/deadZone.ts), play saved songs instead of
  // skipping through a queue that can't load either
  if (deadZone && t && t.kind === 'track' && !isSaved(t) && !intercept) {
    const seq = loadSeq;
    usePlayer.setState({ buffering: true });
    void deadZone.check().then((off) => {
      if (seq !== loadSeq) return; // the person picked something else meanwhile
      if (off) {
        rememberSpot(t);
        if (standInFor(t, usePlayer.getState().index)) return;
        // nothing saved to play: wait for the signal rather than skip through songs that can't load either
        waitingForSignal = true;
        usePlayer.setState({ error: 'No signal · it carries on when the signal is back', buffering: false, playing: false, noSignal: true });
        return;
      }
      // the server answers, so it's only a slow connection: keep waiting rather than skip a song that works
      if (!off && stalled) return armStallWatch(true);
      skipOrStop(message);
    });
    return;
  }
  skipOrStop(message);
}

function skipOrStop(message: string) {
  const { index, queue, repeat } = usePlayer.getState();
  const more = index + 1 < queue.length || (repeat === 'all' && queue.length > 1);
  const skip = more && !intercept && ++failStreak < MAX_FAILS;
  usePlayer.setState({ error: skip ? `${message} · skipping to the next song` : message, buffering: false, playing: false, ...(!more && { ranOut: true }) });
  if (!skip) return;
  const seq = loadSeq;
  skipTimer = window.setTimeout(() => {
    // the person picked something else meanwhile
    if (seq === loadSeq) usePlayer.getState().next();
  }, 2000);
}

// ---- dead zones: a stream that stops coming ----------------------------------

/** Stopped because the signal went and nothing saved was left to play. */
let waitingForSignal = false;

/** The music server answers again (lib/deadZone.ts): clear the note, and carry on if the music had stopped. */
export function signalBack() {
  usePlayer.setState({ noSignal: false });
  if (!waitingForSignal) return;
  waitingForSignal = false;
  void loadCurrent();
}

/** Where a streamed song was when the signal went, so it carries on from there once it's back. */
let resumeAt: { key: string; at: number } | undefined;
const rememberSpot = (t: Track) => {
  const at = engine.el.currentTime;
  resumeAt = at > 5 ? { key: trackKey(t), at: Math.max(0, at - 2) } : undefined;
};

/**
 * A stream that's buffering for this long counts as failed. Losing signal often doesn't raise an error at
 * all: the `<audio>` element just waits, so without this the music would stop until the signal came back.
 */
export const STALL_SECONDS = 12;
let stallTimer: number | undefined;
function armStallWatch(on: boolean) {
  window.clearTimeout(stallTimer);
  stallTimer = undefined;
  if (!on || !deadZone) return;
  const t = usePlayer.getState().current();
  if (!t || t.kind !== 'track' || !fromStream) return;
  const seq = loadSeq;
  stallTimer = window.setTimeout(() => {
    stallTimer = undefined;
    if (seq === loadSeq && usePlayer.getState().buffering && !engine.el.paused) failed('The stream stopped', true);
  }, STALL_SECONDS * 1000);
}

// ---- gapless and crossfade ------------------------------------------------

/** The next song, loaded ahead on the idle deck (engine.preload): which song and its stream URL. */
let ahead: { key: string; url: string; local?: boolean; plan?: Transition } | undefined;
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
  // no signal: nothing to fetch, and the stand-in decision is made when its turn comes
  if (deadZone?.offline() && !useOffline.getState().tracks[key]) return;
  try {
    if (useOffline.getState().tracks[key]) {
      if (isAndroid) return;
      const local = await offlinePlaybackUrl(next);
      if (local) {
        engine.preload(local);
        ahead = { key, url: local, local: true };
        void planAhead(cur, next, key);
      }
      return;
    }
    const ready = ((await sourceOf(next)?.prepare?.(next)) ?? (await freshPreview(next))).track;
    if (!ready.streamUrl || usePlayer.getState().queue[i!] !== next) return;
    if (ready !== next) usePlayer.setState((s) => ({ queue: s.queue.map((q, j) => (j === i ? ready : q)) }));
    engine.preload(ready.streamUrl);
    ahead = { key, url: ready.streamUrl };
    void planAhead(cur, ready, key);
  } catch {
    /* it just loads normally when its turn comes */
  }
}

/** AutoMix on: work out how to blend into the song loaded ahead (player/automix.ts), with the Hub's analysis when there is one. */
async function planAhead(cur: Track, next: Track, key: string) {
  const pb = useSettings.getState().playback;
  if (!pb.automix || !featureOn('automix')) return;
  const [a, b] = await featuresFor([cur, next]).catch(() => [null, null]);
  const info = (f: typeof a): SoundInfo | null => (f ? { bpm: f.bpm, beatStrength: f.beatStrength, beatAt: f.offset + f.beatPhase, energy: f.energy } : null);
  if (ahead?.key === key) ahead.plan = planTransition(cur, next, info(a), info(b), pb.crossfade);
}

/** A beat-aligned blend waiting for its beat. */
let beatTimer: number | undefined;

/** Crossfade into the preloaded next song when the current one is `remaining` seconds from its end. */
function maybeCrossfade(remaining: number) {
  const plan = ahead?.plan;
  const seconds = plan ? plan.seconds : useSettings.getState().playback.crossfade;
  if (beatTimer !== undefined) return;
  // AutoMix with a beat: start on the beat of this song that comes just before the blend has to start
  if (plan?.beat && ahead && seconds && remaining <= seconds + plan.beat.period && remaining > seconds - 0.3 && !stopAfterTrack && !intercept) {
    const wait = toNextBeat(engine.el.currentTime, plan.beat);
    const key = ahead.key;
    beatTimer = window.setTimeout(() => {
      beatTimer = undefined;
      if (ahead?.key === key) startCrossfade(Math.max(1, engine.el.duration - engine.el.currentTime), plan.rate);
    }, wait * 1000);
    return;
  }
  if (!seconds || !ahead || remaining > seconds || stopAfterTrack || intercept) return;
  startCrossfade(remaining, plan?.rate ?? 1);
}

function startCrossfade(remaining: number, rate: number) {
  if (!ahead || stopAfterTrack || intercept) return;
  const i = nextIndex();
  const next = i === undefined ? undefined : usePlayer.getState().queue[i];
  if (!next || trackKey(next) !== ahead.key) return;
  const { replayGain, replayGainPreamp } = useSettings.getState().playback;
  const { url, local } = ahead;
  if (!engine.crossfade(url, Math.max(1, remaining), replayGainFactor(next.replayGain, replayGain, replayGainPreamp), rate)) return;
  ahead = undefined;
  fromStream = !local;
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
      navigator.mediaSession.setPositionState({ duration: dur, position: Math.min(now, dur), playbackRate: engine.speed() });
    } catch {
      /* ignore */
    }
  }
});
engine.on('durationchange', (_, el) => {
  if (Number.isFinite(el.duration)) usePlayer.setState({ duration: el.duration });
});
engine.on('play', () => usePlayer.setState({ playing: true }));
engine.on('playing', () => {
  failStreak = 0;
  armStallWatch(false);
  usePlayer.setState({ playing: true, buffering: false });
});
engine.on('waiting', () => {
  usePlayer.setState({ buffering: true });
  armStallWatch(true);
});
engine.on('pause', () => usePlayer.setState({ playing: false }));
engine.on('error', (_, el) => failed(`Playback failed (code ${el.error?.code ?? '?'})`));
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
  // lock screen and headphone skip buttons: audiobooks and podcasts jump 15 s back / 30 s on (lib/spoken.ts)
  try {
    ms.setActionHandler('seekbackward', (d) => usePlayer.getState().skipBy(-(d.seekOffset || 15)));
    ms.setActionHandler('seekforward', (d) => usePlayer.getState().skipBy(d.seekOffset || 30));
  } catch {
    /* not supported here */
  }
}

/**
 * Go to `abs` seconds into the audiobook that's playing (its parts are separate files in the queue, each with its
 * `bookOffset`): seek in this part, or load the part it falls in.
 */
export function seekBook(abs: number) {
  const { queue, index } = usePlayer.getState();
  const t = queue[index];
  if (!t) return;
  if (t.kind !== 'book') return usePlayer.getState().seek(Math.max(0, abs));
  const parts = queue.map((q, i) => ({ q, i })).filter(({ q }) => q.kind === 'book' && q.bookId === t.bookId);
  const total = t.bookDuration ?? parts.reduce((n, { q }) => Math.max(n, (q.bookOffset ?? 0) + (q.duration ?? 0)), 0);
  const at = Math.max(0, total ? Math.min(total - 1, abs) : abs);
  const part = [...parts].reverse().find(({ q }) => at >= (q.bookOffset ?? 0)) ?? parts[0];
  const within = at - (part.q.bookOffset ?? 0);
  if (part.i === index) usePlayer.getState().seek(within);
  else usePlayer.getState().jump(part.i, within);
}
