/**
 * The talking DJ: every few songs, a short spoken link ("That was Dreams… here's something from 1977…") read
 * over the start of the next song with the music turned down. The Hub's AI DJ writes the words
 * (POST /api/dj/patter, counted against the DJ allowance). Who reads them depends on the Hub (Settings → AI DJ →
 * Talking DJ voice): its own voice, Kokoro or OpenAI (POST /api/dj/speak returns an MP3), or this device's
 * text-to-speech voice. Each person can pick a Hub voice, or keep this device's. The words, and the audio, for
 * the next song are fetched while this one is ending. If the Hub's voice fails, the device voice reads it.
 *
 * Which voice reads a line is decided once the Hub has said what voice it has (`hubVoiceInfo`), never from a
 * cold cache: DJ mode's very first intro used to go to the device voice (Windows' default, or nothing at all on
 * Android) because the answer hadn't arrived yet. The DJ's audio plays through the player's own running audio
 * context when there is one, and DJ buttons call `unlockDjAudio` on the tap, so phones (whose WebView won't
 * start audio without a tap) can play a line that arrives seconds later.
 */
import type { HubDjVoiceInfo } from '../sources/hub';
import type { Track } from '../sources/types';
import { engine } from '../player/engine';
import { hubClient } from '../store/hub';
import { usePlayer } from '../store/player';
import { useSettings } from '../store/settings';
import { featureOn } from './features';

const key = (t: Track) => `${t.sourceId}:${t.id}`;
const song = (t: Track) => ({ title: t.title, artist: t.artist || undefined, album: t.album || undefined });

export const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;

/** The last problem, for Settings (allowance used up, DJ not on for you…). */
export let djVoiceProblem = '';

/** Songs DJ mode introduces itself (lib/djStation.ts): no extra line before them. */
export const stationTalks = new Set<string>();

/** Songs played since the DJ last talked. */
let since = 0;
interface Line { text: string; audio: Promise<Blob | null> | null }
const lines = new Map<string, Promise<Line | null>>();

// ---- the Hub's voice ----

let info: { at: number; value: HubDjVoiceInfo | null } | null = null;
let infoLoading: Promise<HubDjVoiceInfo | null> | null = null;

/** The Hub's voices (cached ten minutes); null when there's no Hub or it can't say. */
export function hubVoiceInfo(fresh = false): Promise<HubDjVoiceInfo | null> {
  if (!fresh && info && Date.now() - info.at < 10 * 60_000) return Promise.resolve(info.value);
  const hub = hubClient();
  // no Hub (yet): don't remember "no voice", so signing in later is picked up straight away
  if (!hub) return Promise.resolve(null);
  if (!infoLoading) {
    infoLoading = hub.djVoice().then(
      (value) => {
        info = { at: Date.now(), value };
        infoLoading = null;
        return value;
      },
      () => {
        // a failed ask is retried after a minute, not ten
        info = { at: Date.now() - 9 * 60_000, value: info?.value ?? null };
        infoLoading = null;
        return info.value;
      },
    );
  }
  return infoLoading;
}

/** Whether `v` (the Hub's answer) means this device reads lines with the Hub's voice. */
function usesHubVoice(v: HubDjVoiceInfo | null): boolean {
  return !!v && v.engine !== 'device' && !useSettings.getState().djVoice.useDevice;
}

/** Whether this device reads lines with the Hub's voice (from the last answer; asks again in the background). */
function hubVoiceOn(): boolean {
  void hubVoiceInfo();
  return usesHubVoice(info?.value ?? null);
}

/** The same, waiting for the Hub's answer when it isn't in yet (at most a few seconds). */
async function hubVoiceOnSoon(): Promise<boolean> {
  if (info && Date.now() - info.at < 10 * 60_000) return usesHubVoice(info.value);
  const v = await Promise.race([hubVoiceInfo(), new Promise<null>((r) => setTimeout(() => r(null), 6000))]);
  return usesHubVoice(v ?? info?.value ?? null);
}

/** The Hub reads `text`: an MP3, or null when it can't. */
function hubAudio(text: string): Promise<Blob | null> {
  const s = useSettings.getState().djVoice;
  const hub = hubClient();
  if (!hub) return Promise.resolve(null);
  return hub
    .djSpeak({ text, voice: s.hubVoice || undefined, speed: s.rate, style: s.style })
    .then((b) => { djVoiceProblem = ''; return b; })
    .catch((e: unknown) => { djVoiceProblem = `The Hub’s voice didn’t work: ${String((e as Error)?.message ?? e)}`; return null; });
}

/** Whether DJ mode is on air with talking on (lib/djStation.ts sets this, so the two files don't import each other). */
let stationTalking = () => false;
export function setStationTalking(fn: () => boolean) {
  stationTalking = fn;
}

/**
 * Whether the DJ talks between songs now: the Talking DJ (Settings → Playback) is on, or DJ mode is on air with
 * "The DJ talks" on, which talks between its songs too without the Talking DJ setting.
 */
function ready() {
  const s = useSettings.getState().djVoice;
  const station = stationTalking() && featureOn('djMode');
  return (station || (s.on && featureOn('djVoice'))) && (canSpeak || hubVoiceOn()) && !!hubClient();
}

/** Whether the song after `t` gets a link. */
const due = () => since + 1 >= Math.max(1, useSettings.getState().djVoice.every);

function fetchLine(prev: Track | undefined, next: Track): Promise<Line | null> {
  const k = key(next);
  let p = lines.get(k);
  if (!p) {
    const s = useSettings.getState().djVoice;
    p = hubClient()!
      .djPatter({ previous: prev ? song(prev) : undefined, next: song(next), name: s.name || undefined, style: s.style })
      .then(async (r) => { djVoiceProblem = ''; return { text: r.text, audio: (await hubVoiceOnSoon()) ? hubAudio(r.text) : null }; })
      .catch((e: unknown) => { djVoiceProblem = String((e as Error)?.message ?? e); return null; });
    lines.set(k, p);
    // keep the cache small
    for (const old of [...lines.keys()].slice(0, Math.max(0, lines.size - 6))) lines.delete(old);
  }
  return p;
}

export function voices(): SpeechSynthesisVoice[] {
  return canSpeak ? speechSynthesis.getVoices() : [];
}

/** Read `text` aloud over the music, ducked: in the Hub's voice when it has one, else this device's. Resolves when done. */
export async function say(text: string, audio?: Promise<Blob | null> | null): Promise<void> {
  if (audio || (await hubVoiceOnSoon())) {
    const blob = await (audio ?? hubAudio(text));
    if (blob) return play(blob);
  }
  return sayOnDevice(text);
}

/** How loud the DJ is next to the music (Settings → Playback → Talking DJ): 1 = as loud as the music. */
const loudness = () => Math.max(0.5, Math.min(2.5, useSettings.getState().djVoice.loudness ?? 1.6));
/** The music's level while the DJ talks: lower when the DJ is set louder. */
const duckLevel = () => Math.max(0.08, Math.min(0.4, 0.3 / loudness()));

let audioCtx: AudioContext | null = null;

/**
 * Call from a tap (the DJ button, a segment chip): makes the DJ's own audio context and starts it while the tap
 * still counts, playing a moment of silence, so a line that arrives later can play. Phones' WebViews (and
 * browsers before you've touched the page) keep audio made outside a tap silent. Also asks the Hub which voice
 * it has, so the first line already knows.
 */
export function unlockDjAudio() {
  void hubVoiceInfo();
  try {
    audioCtx ??= new AudioContext();
    if (audioCtx.state === 'suspended') void audioCtx.resume().catch(() => undefined);
    const src = audioCtx.createBufferSource();
    src.buffer = audioCtx.createBuffer(1, 1, 22050);
    src.connect(audioCtx.destination);
    src.start();
  } catch {
    // no Web Audio: the <audio> fallback is used
  }
}

/** A running audio context for the DJ: the player's own when it's playing through one, else the DJ's. */
async function djContext(): Promise<AudioContext> {
  const playing = engine.audioContext();
  if (playing) return playing;
  audioCtx ??= new AudioContext();
  if (audioCtx.state !== 'running') {
    // outside a tap resume() can wait forever on a phone: give up after a moment and use <audio>
    await Promise.race([audioCtx.resume(), new Promise((r) => setTimeout(r, 1500))]);
    if ((audioCtx.state as AudioContextState) !== 'running') throw new Error('audio context not running');
  }
  return audioCtx;
}

/**
 * Play the Hub's MP3 over the ducked music, through Web Audio so it can be louder than the music's own volume
 * (an <audio> element stops at 100%), with a compressor so a boost doesn't clip.
 */
async function play(blob: Blob): Promise<void> {
  const gain = loudness() * Math.max(0.05, usePlayer.getState().volume ?? 1);
  try {
    const ctx = await djContext();
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    return await new Promise<void>((resolve) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = gain;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.ratio.value = 6;
      src.connect(g).connect(comp).connect(ctx.destination);
      let done = false;
      const end = () => {
        if (done) return;
        done = true;
        engine.duck(1, 1.2);
        resolve();
      };
      src.onended = end;
      engine.duck(duckLevel(), 0.6);
      src.start();
      setTimeout(end, (buf.duration + 5) * 1000);
    });
  } catch {
    return playElement(blob, Math.min(1, gain));
  }
}

/** Without Web Audio: a plain <audio> element, at most at full volume. */
function playElement(blob: Blob, volume: number): Promise<void> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const a = new Audio(url);
    a.volume = Math.max(0, volume);
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      engine.duck(1, 1.2);
      URL.revokeObjectURL(url);
      resolve();
    };
    a.onended = end;
    a.onerror = end;
    engine.duck(duckLevel(), 0.6);
    a.play().catch(end);
    // a stuck element mustn't keep the music down
    setTimeout(end, 30_000);
  });
}

function sayOnDevice(text: string): Promise<void> {
  if (!canSpeak) return Promise.resolve();
  const s = useSettings.getState().djVoice;
  return new Promise((resolve) => {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = voices().find((x) => x.name === s.voice);
    if (v) u.voice = v;
    u.rate = Math.max(0.7, Math.min(1.4, s.rate || 1));
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      engine.duck(1, 1.2);
      resolve();
    };
    u.onend = end;
    u.onerror = end;
    u.volume = 1;
    engine.duck(duckLevel(), 0.6);
    speechSynthesis.speak(u);
    // some engines never fire onend; give up after a generous guess at the length
    setTimeout(end, 4000 + text.length * 120);
  });
}

export function startDjVoice() {
  // ask the Hub which voice it has now, so the first line doesn't wait on it
  void hubVoiceInfo();
  let current: string | undefined;
  let prefetched: string | undefined;
  usePlayer.subscribe((st) => {
    const t = st.queue[st.index];
    if (!t) return;
    const k = key(t);
    if (k !== current) {
      current = k;
      prefetched = undefined;
      if (stationTalks.has(k)) {
        stationTalks.delete(k);
        since = 0;
        return;
      }
      const line = lines.get(k);
      if (line && ready() && t.kind === 'track') {
        since = 0;
        void line.then(async (l) => {
          if (!l) return;
          // the Hub's audio is usually ready by now; wait for it a little
          if (l.audio) await l.audio;
          // still on that song, near its start
          const p = usePlayer.getState();
          if (p.queue[p.index] && key(p.queue[p.index]) === k && p.position < 30) void say(l.text, l.audio);
        });
      } else since++;
      return;
    }
    // near the end of this song: write the link for the next one now, so it's ready the moment it starts
    // (75 s ahead, as a local model plus Kokoro can take most of a minute; a line still not ready 30 s into the
    // song is dropped)
    const next = st.queue[st.index + 1];
    const left = (st.duration || t.duration || 0) - st.position;
    if (next && next.kind === 'track' && t.kind === 'track' && !stationTalks.has(key(next)) && prefetched !== key(next) && st.playing && left > 0 && left < 75 && due() && ready()) {
      prefetched = key(next);
      void fetchLine(t, next);
    }
  });
}
