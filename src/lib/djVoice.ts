/**
 * The talking DJ: every few songs, a short spoken link ("That was Dreams… here's something from 1977…") read
 * over the start of the next song with the music turned down. The Hub's AI DJ writes the words
 * (POST /api/dj/patter, counted against the DJ allowance). Who reads them depends on the Hub (Settings → AI DJ →
 * Talking DJ voice): its own voice, Kokoro or OpenAI (POST /api/dj/speak returns an MP3), or this device's
 * text-to-speech voice. Each person can pick a Hub voice, or keep this device's. The words, and the audio, for
 * the next song are fetched while this one is ending. If the Hub's voice fails, the device voice reads it.
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
  if (!infoLoading) {
    const hub = hubClient();
    infoLoading = (hub ? hub.djVoice().catch(() => null) : Promise.resolve(null)).then((value) => {
      info = { at: Date.now(), value };
      infoLoading = null;
      return value;
    });
  }
  return infoLoading;
}

/** Whether this device reads lines with the Hub's voice (from the last answer; asks again in the background). */
function hubVoiceOn(): boolean {
  void hubVoiceInfo();
  const s = useSettings.getState().djVoice;
  return !!info?.value && info.value.engine !== 'device' && !s.useDevice;
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

function ready() {
  const s = useSettings.getState().djVoice;
  return s.on && (canSpeak || hubVoiceOn()) && !!hubClient() && featureOn('djVoice');
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
      .then((r) => { djVoiceProblem = ''; return { text: r.text, audio: hubVoiceOn() ? hubAudio(r.text) : null }; })
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
  if (hubVoiceOn() || audio) {
    const blob = await (audio ?? hubAudio(text));
    if (blob) return play(blob);
  }
  return sayOnDevice(text);
}

/** Play the Hub's MP3 over the ducked music. */
function play(blob: Blob): Promise<void> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const a = new Audio(url);
    a.volume = Math.max(0, Math.min(1, usePlayer.getState().volume ?? 1));
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
    engine.duck(0.25, 0.6);
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
    engine.duck(0.25, 0.6);
    speechSynthesis.speak(u);
    // some engines never fire onend; give up after a generous guess at the length
    setTimeout(end, 4000 + text.length * 120);
  });
}

export function startDjVoice() {
  let current: string | undefined;
  let prefetched: string | undefined;
  usePlayer.subscribe((st) => {
    const t = st.queue[st.index];
    if (!t) return;
    const k = key(t);
    if (k !== current) {
      current = k;
      prefetched = undefined;
      const line = lines.get(k);
      if (line && ready() && t.kind === 'track') {
        since = 0;
        void line.then(async (l) => {
          if (!l) return;
          // the Hub's audio is usually ready by now; wait for it a little
          if (l.audio) await l.audio;
          // still on that song, near its start
          const p = usePlayer.getState();
          if (p.queue[p.index] && key(p.queue[p.index]) === k && p.position < 20) void say(l.text, l.audio);
        });
      } else since++;
      return;
    }
    // near the end of this song: write the link for the next one now, so it's ready the moment it starts
    const next = st.queue[st.index + 1];
    const left = (st.duration || t.duration || 0) - st.position;
    if (next && next.kind === 'track' && t.kind === 'track' && prefetched !== key(next) && st.playing && left > 0 && left < 45 && due() && ready()) {
      prefetched = key(next);
      void fetchLine(t, next);
    }
  });
}
