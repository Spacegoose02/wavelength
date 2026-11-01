import type { Db } from '../db.ts';
import { HttpError } from '../http.ts';
import type { User } from '../users.ts';
import { checkBudget, getApiKey, getSettings, isVoiceName, OPENAI_VOICES, recordUsage, type VoiceSettings } from './settings.ts';

/**
 * The talking DJ's voice (docs/AI-DJ.md "Voices"). The AI DJ writes a line (agent.ts `patter`); when an admin
 * picked a Hub voice, the app sends the line here and gets back an MP3 to play over the ducked music.
 *
 * - Kokoro: Kokoro-FastAPI in its own container (ghcr.io/remsky/kokoro-fastapi-cpu). It speaks OpenAI's
 *   /v1/audio/speech, so both engines share one call. Free; nothing leaves the house.
 * - OpenAI: api.openai.com with the key kept on the Hub. Billed per character, recorded with the DJ's other costs
 *   so it counts toward everyone's limits.
 */

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** OpenAI's tts-1 models know fewer voices than gpt-4o-mini-tts. */
const TTS1_VOICES = ['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'];

const STYLE: Record<string, string> = {
  chill: 'You are a warm, relaxed late-night radio DJ. Speak smoothly and unhurried, with a smile in your voice.',
  hype: 'You are a high-energy radio DJ hyping up the crowd. Punchy, upbeat and excited, with big energy on names.',
  trivia: 'You are a friendly radio DJ sharing a fun fact. Curious and lively, like you can’t wait to tell it.',
};

export interface VoiceInfo {
  engine: VoiceSettings['engine'];
  /** Voices people can pick from (empty for `device`, or when Kokoro can't be reached). */
  voices: string[];
  /** The admin's pick, used when someone hasn't chosen. */
  default: string;
  /** Why the list is empty, e.g. Kokoro isn't running. */
  error?: string;
}

export class DjVoice {
  private kokoroVoices: { url: string; at: number; voices: string[] } | null = null;

  private db: Db;
  private secretKey: Buffer;
  private fetcher: Fetch;

  constructor(db: Db, secretKey: Buffer, fetcher: Fetch = (url, init) => fetch(url, init)) {
    this.db = db;
    this.secretKey = secretKey;
    this.fetcher = fetcher;
  }

  /** What the app shows in Settings → Playback → Talking DJ. */
  async info(): Promise<VoiceInfo> {
    const v = getSettings(this.db).voice;
    if (v.engine === 'openai') {
      return { engine: 'openai', voices: v.openaiModel.startsWith('tts-1') ? TTS1_VOICES : [...OPENAI_VOICES], default: v.openaiVoice };
    }
    if (v.engine === 'kokoro') {
      try {
        return { engine: 'kokoro', voices: await this.kokoroList(v.kokoroUrl), default: v.kokoroVoice };
      } catch (e) {
        return { engine: 'kokoro', voices: [], default: v.kokoroVoice, error: (e as Error).message };
      }
    }
    return { engine: 'device', voices: [], default: '' };
  }

  private async kokoroList(url: string): Promise<string[]> {
    const c = this.kokoroVoices;
    if (c && c.url === url && Date.now() - c.at < 10 * 60_000) return c.voices;
    const res = await this.call(`${url}/v1/audio/voices`, { method: 'GET' }, 'Kokoro', 8000);
    const body = (await res.json().catch(() => ({}))) as { voices?: unknown };
    // newer Kokoro-FastAPI: [{ id, name, … }]; older: plain names
    const voices = (Array.isArray(body.voices) ? body.voices : [])
      .map((x) => (x && typeof x === 'object' ? (x as { id?: unknown }).id : x))
      .filter(isVoiceName)
      .sort();
    this.kokoroVoices = { url, at: Date.now(), voices };
    return voices;
  }

  /**
   * Read `text` aloud. `voice` is the listener's pick (falls back to the admin's), `speed` 0.7–1.4, `style` the
   * talking DJ's (chill / hype / trivia; only gpt-4o-mini-tts acts on it). `user` null = an admin's test.
   */
  async speak(user: User | null, b: unknown): Promise<{ audio: Buffer; type: string }> {
    const o = (b ?? {}) as Record<string, unknown>;
    const text = typeof o.text === 'string' ? o.text.replace(/\s+/g, ' ').trim() : '';
    if (!text) throw new HttpError(400, 'Nothing to say');
    if (text.length > 600) throw new HttpError(400, 'That’s too long to read out (600 characters at most)');
    const speed = Math.max(0.7, Math.min(1.4, Number(o.speed) || 1));
    const style = typeof o.style === 'string' && STYLE[o.style] ? o.style : 'chill';
    const v = getSettings(this.db).voice;

    if (v.engine === 'kokoro') {
      const voice = isVoiceName(o.voice) ? o.voice : v.kokoroVoice;
      const res = await this.call(`${v.kokoroUrl}/v1/audio/speech`, json({ model: 'kokoro', input: text, voice, response_format: 'mp3', speed, stream: false }), 'Kokoro', 60_000);
      return { audio: Buffer.from(await res.arrayBuffer()), type: 'audio/mpeg' };
    }

    if (v.engine === 'openai') {
      const key = getApiKey(this.db, this.secretKey, 'openaiKey');
      if (!key) throw new HttpError(409, 'The OpenAI voice isn’t set up yet: the Hub has no OpenAI key');
      if (user) checkBudget(this.db, user.id);
      const allowed = v.openaiModel.startsWith('tts-1') ? TTS1_VOICES : (OPENAI_VOICES as readonly string[]);
      const voice = typeof o.voice === 'string' && allowed.includes(o.voice) ? o.voice : v.openaiVoice;
      const res = await this.call('https://api.openai.com/v1/audio/speech', json({
        model: v.openaiModel,
        input: text,
        voice,
        response_format: 'mp3',
        speed,
        ...(v.openaiModel === 'gpt-4o-mini-tts' && { instructions: STYLE[style] }),
      }, { authorization: `Bearer ${key}` }), 'OpenAI', 60_000);
      const audio = Buffer.from(await res.arrayBuffer());
      const cost = (text.length * v.openaiPrice) / 1e6;
      if (user) recordUsage(this.db, user.id, null, `openai:${v.openaiModel}`, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, cost);
      return { audio, type: 'audio/mpeg' };
    }

    throw new HttpError(409, 'The Hub has no DJ voice: each device reads it with its own');
  }

  private async call(url: string, init: RequestInit, who: string, ms: number): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetcher(url, { ...init, signal: AbortSignal.timeout(ms) });
    } catch (e) {
      const why = (e as Error)?.name === 'TimeoutError' ? 'took too long' : `can’t be reached at ${new URL(url).origin}`;
      throw new HttpError(502, `${who} ${why}${who === 'Kokoro' ? '. Is its container running?' : ''}`);
    }
    if (!res.ok) {
      // OpenAI: { error: { message } }; Kokoro-FastAPI: { detail: { message } } or { detail: '…' }
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } | string; detail?: { message?: string } | string } | null;
      const msg = typeof body?.error === 'string' ? body.error : body?.error?.message ?? (typeof body?.detail === 'string' ? body.detail : body?.detail?.message ?? '');
      throw new HttpError(502, `${who} said ${res.status}${msg ? `: ${String(msg).slice(0, 200)}` : ''}`);
    }
    return res;
  }
}

const json = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
