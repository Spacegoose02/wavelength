/**
 * The talking DJ: every few songs, a short spoken link ("That was Dreams… here's something from 1977…") read
 * over the start of the next song with the music turned down. The Hub's AI DJ writes the words
 * (POST /api/dj/patter, counted against the DJ allowance) and this device's text-to-speech voice reads them,
 * so nothing extra needs setting up. The words for the next song are fetched while this one is ending.
 */
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
const lines = new Map<string, Promise<string | null>>();

function ready() {
  const s = useSettings.getState().djVoice;
  return s.on && canSpeak && !!hubClient() && featureOn('djVoice');
}

/** Whether the song after `t` gets a link. */
const due = () => since + 1 >= Math.max(1, useSettings.getState().djVoice.every);

function fetchLine(prev: Track | undefined, next: Track): Promise<string | null> {
  const k = key(next);
  let p = lines.get(k);
  if (!p) {
    const s = useSettings.getState().djVoice;
    p = hubClient()!
      .djPatter({ previous: prev ? song(prev) : undefined, next: song(next), name: s.name || undefined, style: s.style })
      .then((r) => { djVoiceProblem = ''; return r.text; })
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

/** Read `text` aloud over the music, ducked. Resolves when done. */
export function say(text: string): Promise<void> {
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
        void line.then((text) => {
          // still on that song, near its start
          const p = usePlayer.getState();
          if (text && p.queue[p.index] && key(p.queue[p.index]) === k && p.position < 20) void say(text);
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
