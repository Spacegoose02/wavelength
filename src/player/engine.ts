/**
 * Two <audio> elements: one routed through Web Audio (for the visualizer) which needs CORS,
 * and a plain one for servers/radio streams that don't send CORS headers. We try the
 * visualized path first and fall back per-host, remembering hosts that failed.
 */
type Listener = (e: Event, el: HTMLAudioElement) => void;

const visual = new Audio();
visual.crossOrigin = 'anonymous';
visual.preload = 'auto';
const plain = new Audio();
plain.preload = 'auto';

const noCorsHosts = new Set<string>();
let current: HTMLAudioElement = visual;
let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let loadToken = 0;
let fallbackPending = false;
const listeners = new Map<string, Listener[]>();

function host(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function ensureGraph() {
  if (ctx) return;
  ctx = new AudioContext();
  const src = ctx.createMediaElementSource(visual);
  analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.78;
  src.connect(analyser);
  analyser.connect(ctx.destination);
}

for (const el of [visual, plain]) {
  for (const type of ['timeupdate', 'durationchange', 'play', 'pause', 'ended', 'error', 'waiting', 'playing']) {
    el.addEventListener(type, (e) => {
      if (el !== current) return;
      if (type === 'error' && el === visual && fallbackPending) return;
      listeners.get(type)?.forEach((fn) => fn(e, el));
    });
  }
}

export const engine = {
  get el() {
    return current;
  },
  analyser() {
    return current === visual ? analyser : null;
  },
  on(type: string, fn: Listener) {
    listeners.set(type, [...(listeners.get(type) ?? []), fn]);
  },
  async load(url: string, startAt = 0, autoplay = true): Promise<void> {
    const token = ++loadToken;
    const volume = current.volume;
    current.pause();
    const usePlain = noCorsHosts.has(host(url));
    const el = usePlain ? plain : visual;
    const other = usePlain ? visual : plain;
    other.removeAttribute('src');
    other.load();
    current = el;
    el.volume = volume;
    el.src = url;
    if (startAt > 0) el.currentTime = startAt;

    if (!usePlain) {
      ensureGraph();
      fallbackPending = true;
      const ok = await new Promise<boolean>((resolve) => {
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
      fallbackPending = false;
      if (token !== loadToken) return;
      if (!ok) {
        noCorsHosts.add(host(url));
        return engine.load(url, startAt, autoplay);
      }
    }
    if (startAt > 0 && Math.abs(el.currentTime - startAt) > 1) el.currentTime = startAt;
    if (autoplay) await engine.play();
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
    current.pause();
  },
  seek(t: number) {
    if (Number.isFinite(t)) current.currentTime = t;
  },
  setVolume(v: number) {
    visual.volume = plain.volume = v;
  },
  stop() {
    current.pause();
    current.removeAttribute('src');
    current.load();
  },
};
