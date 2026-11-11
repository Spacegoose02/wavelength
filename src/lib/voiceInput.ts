/**
 * Voice requests to the AI DJ (docs/AI-DJ.md "Ask out loud"): press the microphone, say what you want, and the
 * words go in the DJ chat or DJ mode's request box. Either the device understands them itself (the browser's
 * speech recognition, where it has one: Chrome, Edge, Safari), or, when a Hub admin has set it up under
 * Settings → AI DJ → Voice requests, the app records up to 15 seconds and the Hub's Whisper (or OpenAI) writes
 * them down.
 */
import { hubClient } from '../store/hub';

export type ListenEngine = 'device' | 'whisper' | 'openai';
const MAX_SECONDS = 15;

type Recognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
const RecognitionCtor = (): (new () => Recognition) | undefined => {
  const w = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : {};
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => Recognition) | undefined;
};

let engineCache: { at: number; engine: ListenEngine } | undefined;
/** Where requests are understood: the Hub's choice (cached for a minute), or the device without a Hub. */
export async function listenEngine(): Promise<ListenEngine> {
  if (engineCache && Date.now() - engineCache.at < 60_000) return engineCache.engine;
  const c = hubClient();
  const engine = c ? await c.djListenEngine().then((r) => r.engine).catch(() => 'device' as const) : 'device';
  engineCache = { at: Date.now(), engine };
  return engine;
}

/** Whether this device can take spoken requests at all (for showing the microphone). */
export const canRecord = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
export const canRecognise = () => !!RecognitionCtor();

export interface Listening {
  /** resolves with the words (empty when nothing was heard) */
  done: Promise<string>;
  /** stop listening now and use what was said */
  stop(): void;
  /** stop without using it */
  cancel(): void;
}

const NOT_HERE = 'This device can’t understand speech by itself. A Hub admin can turn on Whisper or OpenAI under Settings → AI DJ → Voice requests.';

/** Start listening. Throws when this device can't. */
export async function startListening(): Promise<Listening> {
  const engine = await listenEngine();
  if (engine === 'device') {
    const R = RecognitionCtor();
    if (!R) throw new Error(NOT_HERE);
    return recognise(R);
  }
  if (!canRecord()) throw new Error('This device can’t record from a microphone.');
  return record();
}

function recognise(R: new () => Recognition): Listening {
  const r = new R();
  r.lang = navigator.language || 'en-US';
  r.interimResults = false;
  r.maxAlternatives = 1;
  let text = '';
  let cancelled = false;
  const done = new Promise<string>((resolve, reject) => {
    r.onresult = (e) => {
      text = Array.from(e.results).map((x) => x[0]?.transcript ?? '').join(' ').trim();
    };
    r.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      reject(new Error(e.error === 'not-allowed' ? 'Wavelength isn’t allowed to use the microphone' : e.error === 'network' ? NOT_HERE : `Couldn’t listen (${e.error})`));
    };
    r.onend = () => resolve(cancelled ? '' : text);
  });
  r.start();
  return { done, stop: () => r.stop(), cancel: () => { cancelled = true; r.abort(); } };
}

/** The best recording format this device has (Apple's WebView only records MP4). */
function mimeType(): string | undefined {
  for (const t of ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm']) if (MediaRecorder.isTypeSupported?.(t)) return t;
  return undefined;
}

async function record(): Promise<Listening> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch {
    throw new Error('Wavelength isn’t allowed to use the microphone');
  }
  const type = mimeType();
  const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks: Blob[] = [];
  const started = Date.now();
  let cancelled = false;
  const done = new Promise<string>((resolve, reject) => {
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      for (const t of stream.getTracks()) t.stop();
      if (cancelled) return resolve('');
      const seconds = (Date.now() - started) / 1000;
      if (seconds < 0.6) return resolve('');
      const c = hubClient();
      if (!c) return reject(new Error('Sign in to your Hub to ask out loud'));
      c.djListen(new Blob(chunks, { type: rec.mimeType || type || 'audio/webm' }), seconds).then(resolve, (e) => reject(e instanceof Error ? e : new Error(String(e))));
    };
  });
  rec.start();
  const limit = window.setTimeout(() => rec.state === 'recording' && rec.stop(), MAX_SECONDS * 1000);
  const stop = () => {
    window.clearTimeout(limit);
    if (rec.state === 'recording') rec.stop();
  };
  return { done, stop, cancel: () => { cancelled = true; stop(); } };
}
