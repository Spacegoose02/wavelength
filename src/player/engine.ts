/**
 * Three <audio> elements. Two "decks" are routed through Web Audio (for the visualizer, EQ, ReplayGain and
 * crossfades) and need CORS; a plain one is for servers/radio streams that don't send CORS headers. We try a
 * deck first and fall back per-host, remembering hosts that failed.
 *
 * The deck that isn't playing preloads the next song (`preload`), so the next song starts the moment this one
 * ends (gapless), or fades in over the end of this one (`crossfade`). Songs on the plain element never overlap.
 */
import { EQ_BANDS, type EqSettings } from './eq';

type Listener = (e: Event, el: HTMLAudioElement) => void;

function deck() {
  const a = new Audio();
  a.crossOrigin = 'anonymous';
  a.preload = 'auto';
  return a;
}
const decks = [deck(), deck()];
const plain = new Audio();
plain.preload = 'auto';
const all = [...decks, plain];

const noCorsHosts = new Set<string>();
let current: HTMLAudioElement = decks[0];
let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let preamp: GainNode | null = null;
let bands: BiquadFilterNode[] = [];
/** per deck: ReplayGain for its song, and the crossfade */
const deckGain = new Map<HTMLAudioElement, GainNode>();
let eqState: EqSettings | null = null;
let loadToken = 0;
let fallbackPending = false;
/** ReplayGain (player/replayGain.ts) for the song playing */
let levelValue = 1;
/** the volume slider; the plain element also carries ReplayGain cuts in its volume (it can't boost) */
let volume = 1;
/** what the idle deck holds, ready to play */
let preloaded: { url: string; el: HTMLAudioElement } | undefined;
/** the deck still fading out after a crossfade, and a preload waiting for it to finish */
let fading: HTMLAudioElement | undefined;
let pendingPreload: string | undefined;
const listeners = new Map<string, Listener[]>();

function host(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const isDeck = (el: HTMLAudioElement) => el !== plain;
const idleDeck = () => (current === decks[0] ? decks[1] : decks[0]);

function ensureGraph() {
  if (ctx) return;
  ctx = new AudioContext();
  analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.78;
  // each deck → its gain (ReplayGain × crossfade) → preamp → 10 EQ bands → analyser (so the visualizer shows the
  // EQ'd sound) → speakers. With the EQ off every gain is 0 dB, which leaves the signal untouched.
  const c = ctx;
  preamp = c.createGain();
  bands = EQ_BANDS.map((hz, i) => {
    const f = c.createBiquadFilter();
    f.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
    f.frequency.value = hz;
    f.Q.value = 1.41;
    return f;
  });
  [preamp, ...bands, analyser, c.destination].reduce((a: AudioNode, b) => (a.connect(b), b));
  for (const d of decks) {
    const g = c.createGain();
    g.gain.value = d === current ? levelValue : 0;
    c.createMediaElementSource(d).connect(g).connect(preamp);
    deckGain.set(d, g);
  }
  applyEq();
}

function applyEq() {
  if (!ctx || !preamp) return;
  const on = !!eqState?.enabled;
  const now = ctx.currentTime;
  // short ramps so dragging a slider doesn't click
  preamp.gain.setTargetAtTime(on ? Math.pow(10, eqState!.preamp / 20) : 1, now, 0.02);
  bands.forEach((f, i) => f.gain.setTargetAtTime(on ? eqState!.gains[i] ?? 0 : 0, now, 0.02));
}

/** Set a deck's gain now (cancelling any fade on it). */
function setGain(el: HTMLAudioElement, value: number) {
  const g = deckGain.get(el);
  if (!ctx || !g) return;
  g.gain.cancelScheduledValues(ctx.currentTime);
  g.gain.setTargetAtTime(value, ctx.currentTime, 0.02);
}

function reset(el: HTMLAudioElement) {
  el.pause();
  el.removeAttribute('src');
  el.load();
  if (preloaded?.el === el) preloaded = undefined;
}

for (const el of all) {
  for (const type of ['timeupdate', 'durationchange', 'play', 'pause', 'ended', 'error', 'waiting', 'playing', 'seeked']) {
    el.addEventListener(type, (e) => {
      if (el !== current) return;
      if (type === 'error' && isDeck(el) && fallbackPending) return;
      listeners.get(type)?.forEach((fn) => fn(e, el));
    });
  }
  // a preload that fails (CORS, gone) is simply not used
  el.addEventListener('error', () => {
    if (preloaded?.el === el && el !== current) preloaded = undefined;
  });
}

const effectiveVolume = (el: HTMLAudioElement) => (el === plain ? volume * Math.min(1, levelValue) : volume);
function applyVolume() {
  for (const el of all) el.volume = effectiveVolume(el);
}

const waitReady = (el: HTMLAudioElement) =>
  new Promise<boolean>((resolve) => {
    if (el.readyState >= 3) return resolve(true);
    const done = (v: boolean) => {
      el.removeEventListener('canplay', yes);
      el.removeEventListener('error', no);
      resolve(v);
    };
    const yes = () => done(true);
    const no = () => done(false);
    el.addEventListener('canplay', yes, { once: true });
    el.addEventListener('error', no, { once: true });
  });

/**
 * A deck couldn't load `url`: CORS, or the song itself is broken (gone, corrupt, the server erred). Try the plain
 * element, and only remember the host as having no CORS when the plain element then manages it, so one broken
 * song doesn't turn off the EQ, visualizer, crossfade and gapless for the whole server.
 */
async function loadPlain(url: string, startAt: number, autoplay: boolean, token: number) {
  reset(current);
  current = plain;
  applyVolume();
  plain.src = url;
  if (startAt > 0) plain.currentTime = startAt;
  void waitReady(plain).then((ok) => {
    if (ok && token === loadToken) noCorsHosts.add(host(url));
  });
  if (token !== loadToken) return;
  if (autoplay) await engine.play();
}

/** Stop the deck still fading out after a crossfade (pause, seek, sleep timer), then do any preload it held up. */
function endFade() {
  const old = fading;
  if (!old) return;
  fading = undefined;
  if (old !== current) reset(old);
  const wanted = pendingPreload;
  pendingPreload = undefined;
  if (wanted) engine.preload(wanted);
}

export const engine = {
  get el() {
    return current;
  },
  analyser() {
    return isDeck(current) ? analyser : null;
  },
  on(type: string, fn: Listener) {
    listeners.set(type, [...(listeners.get(type) ?? []), fn]);
  },
  async load(url: string, startAt = 0, autoplay = true): Promise<void> {
    const token = ++loadToken;
    current.pause();
    fading = undefined;
    pendingPreload = undefined;
    // the next song is already loaded on the idle deck: switch to it straight away
    if (preloaded?.url === url && preloaded.el !== current) {
      const el = preloaded.el;
      preloaded = undefined;
      const old = current;
      current = el;
      reset(old);
      setGain(el, levelValue);
      applyVolume();
      if (startAt > 0) el.currentTime = startAt;
      if (autoplay) await engine.play();
      return;
    }
    const usePlain = noCorsHosts.has(host(url));
    const el = usePlain ? plain : isDeck(current) ? current : decks[0];
    for (const other of all) if (other !== el && other !== preloaded?.el) reset(other);
    if (preloaded?.el === el) preloaded = undefined;
    current = el;
    applyVolume();
    el.src = url;
    if (startAt > 0) el.currentTime = startAt;

    if (!usePlain) {
      ensureGraph();
      setGain(el, levelValue);
      fallbackPending = true;
      const ok = await waitReady(el);
      fallbackPending = false;
      if (token !== loadToken) return;
      if (!ok) return loadPlain(url, startAt, autoplay, token);
    }
    if (startAt > 0 && Math.abs(el.currentTime - startAt) > 1) el.currentTime = startAt;
    if (autoplay) await engine.play();
  },
  /** Load the next song on the idle deck so it can start without a gap. Hosts without CORS are skipped. */
  preload(url: string) {
    if (preloaded?.url === url || noCorsHosts.has(host(url)) || !isDeck(current)) return;
    ensureGraph();
    const el = idleDeck();
    if (el === fading) {
      pendingPreload = url;
      return;
    }
    reset(el);
    setGain(el, 0);
    el.src = url;
    el.load();
    preloaded = { url, el };
  },
  /** True when `url` is preloaded and buffered enough to fade in now. */
  canCrossfade(url: string) {
    return !!ctx && preloaded?.url === url && isDeck(current) && preloaded.el.readyState >= 3;
  },
  /**
   * Fade the preloaded `url` in over `seconds` while the current song fades out, then make it the current song.
   * `level` is the new song's ReplayGain. Returns false (and does nothing) when it isn't ready.
   */
  crossfade(url: string, seconds: number, level: number): boolean {
    if (!engine.canCrossfade(url) || !ctx) return false;
    const next = preloaded!.el;
    const old = current;
    preloaded = undefined;
    ++loadToken;
    const now = ctx.currentTime;
    const fadeIn = deckGain.get(next)!.gain;
    const fadeOut = deckGain.get(old)!.gain;
    fadeIn.cancelScheduledValues(now);
    fadeIn.setValueAtTime(0.0001, now);
    fadeIn.linearRampToValueAtTime(level, now + seconds);
    fadeOut.cancelScheduledValues(now);
    fadeOut.setValueAtTime(fadeOut.value, now);
    fadeOut.linearRampToValueAtTime(0, now + seconds);
    levelValue = level;
    current = next;
    fading = old;
    applyVolume();
    void next.play().catch(() => {});
    window.setTimeout(() => {
      if (fading === old) endFade();
    }, seconds * 1000 + 250);
    return true;
  },
  async play() {
    if (ctx?.state === 'suspended') await ctx.resume();
    try {
      await current.play();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') throw e;
    }
  },
  pause() {
    // a crossfade under way: the old song stops too, not just the new one
    endFade();
    current.pause();
  },
  seek(t: number) {
    if (!Number.isFinite(t)) return;
    endFade();
    current.currentTime = t;
  },
  /** Apply equalizer settings now, or as soon as the audio graph exists. */
  setEq(eq: EqSettings) {
    eqState = eq;
    applyEq();
  },
  /** False while playing through the plain (no-CORS) element, which the EQ can't reach. */
  eqAvailable() {
    return isDeck(current);
  },
  setVolume(v: number) {
    volume = v;
    applyVolume();
  },
  /** ReplayGain for the song about to play or playing (linear; 1 = unchanged). */
  setLevel(g: number) {
    levelValue = g;
    if (isDeck(current)) setGain(current, g);
    applyVolume();
  },
  /**
   * Fade the volume to silence over `seconds`, pause, and put the volume back (the sleep timer). Resolves when
   * paused; a new load or play in the meantime cancels the fade.
   */
  async fadeOut(seconds: number) {
    endFade();
    const token = loadToken;
    const el = current;
    const steps = Math.max(1, Math.round(seconds * 10));
    for (let i = steps - 1; i >= 0; i--) {
      if (token !== loadToken || el.paused) break;
      el.volume = effectiveVolume(el) * (i / steps);
      await new Promise((r) => setTimeout(r, 100));
    }
    if (token === loadToken) el.pause();
    applyVolume();
  },
  stop() {
    for (const el of all) reset(el);
  },
};
