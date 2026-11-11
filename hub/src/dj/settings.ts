import { seal, unseal } from '../crypto.ts';
import { familyKeyFor } from '../families.ts';
import type { Db } from '../db.ts';
import { HttpError } from '../http.ts';
import { featureOn } from '../features.ts';
import type { User } from '../users.ts';

/**
 * AI DJ settings (docs/AI-DJ.md): kept by the Hub and changed only by admins. The provider's API key is sealed
 * like the other server logins (crypto.ts) and never leaves the Hub: devices talk to the Hub, and the Hub
 * talks to the AI provider.
 */

const KEY = 'dj.settings';
const AAD = 'hub-setting:dj.apiKey';
const OPENAI_AAD = 'hub-setting:dj.openaiKey';
const OLLAMA_AAD = 'hub-setting:dj.ollamaKey';

/**
 * Who reads the talking DJ's lines aloud (dj/voice.ts). `device`: each device's own text-to-speech voices, as
 * before. `kokoro`: Kokoro, a free voice model in its own container next to the Hub (Kokoro-FastAPI). `openai`:
 * OpenAI's voices, with a key kept here like the Anthropic one, billed per character.
 */
export const VOICE_ENGINES = ['device', 'kokoro', 'openai'] as const;
export type VoiceEngine = (typeof VOICE_ENGINES)[number];
export const OPENAI_VOICE_MODELS = ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'] as const;
export const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar'] as const;
export interface VoiceSettings {
  engine: VoiceEngine;
  /** Kokoro-FastAPI's address, as the Hub reaches it. */
  kokoroUrl: string;
  /** The voice people get unless they pick another (Settings → Playback). */
  kokoroVoice: string;
  openaiModel: (typeof OPENAI_VOICE_MODELS)[number];
  openaiVoice: string;
  /** USD per million characters read (OpenAI: about $15 for gpt-4o-mini-tts and tts-1). */
  openaiPrice: number;
  /**
   * Who understands spoken requests to the DJ (dj/voice.ts transcribe). `device`: the device's own speech
   * recognition, where it has one. `whisper`: a Whisper server next to the Hub that speaks OpenAI's API
   * (speaches, faster-whisper-server). `openai`: OpenAI's transcription, with the same key as the voice.
   */
  listen: (typeof LISTEN_ENGINES)[number];
  whisperUrl: string;
  whisperModel: string;
}
export const LISTEN_ENGINES = ['device', 'whisper', 'openai'] as const;
/** OpenAI's gpt-4o-mini-transcribe: USD per minute of audio. */
export const OPENAI_LISTEN_PRICE = 0.003;
export const VOICE_DEFAULTS: VoiceSettings = {
  engine: 'device',
  kokoroUrl: 'http://kokoro:8880',
  kokoroVoice: 'am_michael',
  openaiModel: 'gpt-4o-mini-tts',
  openaiVoice: 'ash',
  openaiPrice: 15,
  listen: 'device',
  whisperUrl: 'http://whisper:8000',
  whisperModel: 'Systran/faster-whisper-small',
};

export const PROVIDERS = ['anthropic', 'ollama'] as const;
export type Provider = (typeof PROVIDERS)[number];
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];

/** USD per million tokens. */
export interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ModelInfo {
  id: string;
  label: string;
  blurb: string;
  price: Price;
}

/**
 * The models offered in the settings, with Anthropic's list prices (October 2026). Admins can change the prices
 * (and add any other model id) in the settings, so costs stay right when prices change.
 */
export const MODELS: ModelInfo[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', blurb: 'Smartest picks and best at long tasks. Costs the most.', price: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 } },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', blurb: 'Nearly as good, about half the price.', price: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 } },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', blurb: 'Fast and very cheap; fine for simple asks.', price: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 } },
];
export const DEFAULT_MODEL = 'claude-opus-5-5';

export interface DjSettings {
  /** The household-wide switch. Off: nobody can use the DJ, whatever their own switch says. */
  enabled: boolean;
  provider: Provider;
  model: string;
  /** How hard the model thinks: lower is cheaper and faster. */
  effort: Effort;
  /** Empty = the provider's own address. For a proxy or gateway that speaks the same API. */
  baseUrl: string;
  /** Let Anthropic retry a declined answer on another model (server-side fallback). */
  fallback: boolean;
  /** Price overrides by model id; models without one use MODELS. */
  prices: Record<string, Price>;
  /** For the whole household per calendar month, USD. null = none. */
  householdLimit: number | null;
  /** New accounts' own monthly limit when they're switched on, USD. null = none. */
  defaultUserLimit: number | null;
  /** Most web searches in one model call. */
  webMaxSearches: number;
  /** USD per 1,000 web searches (Anthropic: $10). */
  webSearchPrice: number;
  /** The talking DJ's voice. */
  voice: VoiceSettings;
  /** Your own Ollama server (provider.ts `ollamaProvider`), e.g. http://192.168.1.20:11434. */
  ollamaUrl: string;
  /** The Ollama model, as `ollama list` names it. */
  ollamaModel: string;
  /** Ollama's context window for the DJ, in tokens (num_ctx). */
  ollamaContext: number;
  /** Who writes the short lines (the talking DJ, DJ mode): the chat's provider, or Ollama for free. */
  quickProvider: 'same' | 'ollama';
}

interface Stored extends DjSettings {
  apiKey?: string; // sealed
  openaiKey?: string; // sealed
  ollamaKey?: string; // sealed: ollama.com's web search, for the DJ on Ollama
}

export const DEFAULTS: DjSettings = {
  enabled: false,
  provider: 'anthropic',
  model: DEFAULT_MODEL,
  effort: 'medium',
  baseUrl: '',
  fallback: true,
  prices: {},
  householdLimit: null,
  defaultUserLimit: 5,
  webMaxSearches: 3,
  webSearchPrice: 10,
  voice: VOICE_DEFAULTS,
  ollamaUrl: '',
  ollamaModel: 'qwen3.5:9b',
  ollamaContext: 16384,
  quickProvider: 'same',
};

function readStored(db: Db): Stored {
  const row = db.prepare('SELECT value FROM hub_settings WHERE key = ?').get(KEY) as { value: string } | undefined;
  if (!row) return { ...DEFAULTS };
  try {
    const saved = JSON.parse(row.value) as Partial<Stored>;
    return { ...DEFAULTS, ...saved, voice: { ...VOICE_DEFAULTS, ...saved.voice } };
  } catch {
    return { ...DEFAULTS };
  }
}

function writeStored(db: Db, s: Stored) {
  db.prepare('INSERT INTO hub_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(KEY, JSON.stringify(s));
}

export function getSettings(db: Db): DjSettings {
  const { apiKey: _k, openaiKey: _o, ollamaKey: _ol, ...s } = readStored(db);
  return s;
}

type KeyName = 'apiKey' | 'openaiKey' | 'ollamaKey';
const aadOf = (which: KeyName) => (which === 'apiKey' ? AAD : which === 'openaiKey' ? OPENAI_AAD : OLLAMA_AAD);

const SHARED_NAME = { apiKey: 'anthropic', openaiKey: 'openai', ollamaKey: 'ollama' } as const;

/**
 * The API key (or the OpenAI voice key), or null when there is none or it was sealed with a different secret key.
 * With `userId`, that person's family's own key (families.ts) wins over the Hub's.
 */
export function getApiKey(db: Db, secretKey: Buffer, which: KeyName = 'apiKey', userId?: number | null): string | null {
  const own = familyKeyFor(db, secretKey, userId, SHARED_NAME[which]);
  if (own) return own;
  const sealed = readStored(db)[which];
  if (!sealed) return null;
  try {
    return unseal(secretKey, sealed, aadOf(which));
  } catch {
    return null;
  }
}

/** What admins see about a key: whether there is one and its last four characters. Never the key. */
export function keyInfo(db: Db, secretKey: Buffer, which: KeyName = 'apiKey'): { set: boolean; hint: string | null; unreadable: boolean } {
  const sealed = readStored(db)[which];
  if (!sealed) return { set: false, hint: null, unreadable: false };
  const key = getApiKey(db, secretKey, which);
  return { set: true, hint: key ? `…${key.slice(-4)}` : null, unreadable: !key };
}

const money = (v: unknown, what: string): number | null => {
  if (v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100_000) throw new HttpError(400, `${what} must be a dollar amount`);
  return Math.round(n * 100) / 100;
};

function readPrice(v: unknown): Price {
  const p = (v ?? {}) as Record<string, unknown>;
  const out = {} as Price;
  for (const k of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) {
    const n = Number(p[k]);
    if (!Number.isFinite(n) || n < 0 || n > 10_000) throw new HttpError(400, 'Prices are dollars per million tokens');
    out[k] = n;
  }
  return out;
}

/** Apply an admin's changes. `apiKey`: a new key, '' or null to remove it, missing to keep it. */
export function saveSettings(db: Db, secretKey: Buffer, body: unknown): { settings: DjSettings; changed: string[] } {
  const b = (body ?? {}) as Record<string, unknown>;
  const cur = readStored(db);
  const next: Stored = { ...cur };
  const changed: string[] = [];
  if (b.enabled !== undefined) next.enabled = b.enabled === true;
  if (b.provider !== undefined) {
    if (!(PROVIDERS as readonly unknown[]).includes(b.provider)) throw new HttpError(400, `Provider must be one of: ${PROVIDERS.join(', ')}`);
    next.provider = b.provider as Provider;
  }
  if (b.model !== undefined) {
    const m = typeof b.model === 'string' ? b.model.trim() : '';
    if (!/^[a-zA-Z0-9._:@/-]{1,100}$/.test(m)) throw new HttpError(400, 'Pick a model');
    next.model = m;
  }
  if (b.effort !== undefined) {
    if (!(EFFORTS as readonly unknown[]).includes(b.effort)) throw new HttpError(400, `Effort must be one of: ${EFFORTS.join(', ')}`);
    next.effort = b.effort as Effort;
  }
  if (b.baseUrl !== undefined) {
    const u = typeof b.baseUrl === 'string' ? b.baseUrl.trim().replace(/\/+$/, '') : '';
    if (u && !/^https?:\/\/\S+$/i.test(u)) throw new HttpError(400, 'The address must start with http:// or https://');
    next.baseUrl = u;
  }
  if (b.fallback !== undefined) next.fallback = b.fallback === true;
  if (b.householdLimit !== undefined) next.householdLimit = money(b.householdLimit, 'The household limit');
  if (b.defaultUserLimit !== undefined) next.defaultUserLimit = money(b.defaultUserLimit, 'The limit for new people');
  if (b.webMaxSearches !== undefined) {
    const n = Number(b.webMaxSearches);
    if (!Number.isInteger(n) || n < 1 || n > 10) throw new HttpError(400, 'Web searches per step must be 1 to 10');
    next.webMaxSearches = n;
  }
  if (b.webSearchPrice !== undefined) {
    const n = Number(b.webSearchPrice);
    if (!Number.isFinite(n) || n < 0 || n > 1000) throw new HttpError(400, 'The web search price is dollars per 1,000 searches');
    next.webSearchPrice = n;
  }
  if (b.prices !== undefined) {
    if (!b.prices || typeof b.prices !== 'object') throw new HttpError(400, 'Prices must be an object');
    const prices: Record<string, Price> = {};
    for (const [id, p] of Object.entries(b.prices as Record<string, unknown>).slice(0, 50)) if (/^[a-zA-Z0-9._:@/-]{1,100}$/.test(id)) prices[id] = readPrice(p);
    next.prices = prices;
  }
  for (const which of ['apiKey', 'openaiKey', 'ollamaKey'] as const) {
    if (b[which] === undefined) continue;
    const k = typeof b[which] === 'string' ? (b[which] as string).trim() : '';
    if (k.length > 500) throw new HttpError(400, 'That API key is too long');
    if (k) next[which] = seal(secretKey, k, aadOf(which));
    else delete next[which];
    changed.push(which);
  }
  if (b.voice !== undefined) next.voice = readVoice(b.voice, cur.voice);
  if (b.ollamaUrl !== undefined) {
    const u = typeof b.ollamaUrl === 'string' ? b.ollamaUrl.trim().replace(/\/+$/, '') : '';
    if (u && !/^https?:\/\/\S+$/i.test(u)) throw new HttpError(400, 'Ollama’s address must start with http:// or https://');
    next.ollamaUrl = u;
  }
  if (b.ollamaModel !== undefined) {
    const m = typeof b.ollamaModel === 'string' ? b.ollamaModel.trim() : '';
    if (!/^[a-zA-Z0-9._:/-]{1,120}$/.test(m)) throw new HttpError(400, 'Pick an Ollama model');
    next.ollamaModel = m;
  }
  if (b.ollamaContext !== undefined) {
    const n = Number(b.ollamaContext);
    if (!Number.isInteger(n) || n < 2048 || n > 262_144) throw new HttpError(400, 'Ollama’s context must be 2,048 to 262,144 tokens');
    next.ollamaContext = n;
  }
  if (b.quickProvider !== undefined) {
    if (b.quickProvider !== 'same' && b.quickProvider !== 'ollama') throw new HttpError(400, 'quickProvider must be same or ollama');
    next.quickProvider = b.quickProvider;
  }
  for (const k of Object.keys(DEFAULTS) as (keyof DjSettings)[]) if (JSON.stringify(cur[k]) !== JSON.stringify(next[k])) changed.push(k);
  writeStored(db, next);
  return { settings: getSettings(db), changed };
}

function readVoice(v: unknown, cur: VoiceSettings): VoiceSettings {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'voice must be an object');
  const b = v as Record<string, unknown>;
  const out = { ...cur };
  if (b.engine !== undefined) {
    if (!(VOICE_ENGINES as readonly unknown[]).includes(b.engine)) throw new HttpError(400, `The voice must be one of: ${VOICE_ENGINES.join(', ')}`);
    out.engine = b.engine as VoiceEngine;
  }
  if (b.kokoroUrl !== undefined) {
    const u = typeof b.kokoroUrl === 'string' ? b.kokoroUrl.trim().replace(/\/+$/, '') : '';
    if (!/^https?:\/\/\S+$/i.test(u)) throw new HttpError(400, 'Kokoro’s address must start with http:// or https://');
    out.kokoroUrl = u;
  }
  for (const k of ['kokoroVoice', 'openaiVoice'] as const) {
    if (b[k] === undefined) continue;
    if (!isVoiceName(b[k])) throw new HttpError(400, 'Pick a voice');
    out[k] = b[k] as string;
  }
  if (b.openaiModel !== undefined) {
    if (!(OPENAI_VOICE_MODELS as readonly unknown[]).includes(b.openaiModel)) throw new HttpError(400, `The OpenAI voice model must be one of: ${OPENAI_VOICE_MODELS.join(', ')}`);
    out.openaiModel = b.openaiModel as VoiceSettings['openaiModel'];
  }
  if (b.listen !== undefined) {
    if (!(LISTEN_ENGINES as readonly unknown[]).includes(b.listen)) throw new HttpError(400, `Listening must be one of: ${LISTEN_ENGINES.join(', ')}`);
    out.listen = b.listen as VoiceSettings['listen'];
  }
  if (b.whisperUrl !== undefined) {
    const u = typeof b.whisperUrl === 'string' ? b.whisperUrl.trim().replace(/\/+$/, '') : '';
    if (!/^https?:\/\/\S+$/i.test(u)) throw new HttpError(400, 'Whisper’s address must start with http:// or https://');
    out.whisperUrl = u;
  }
  if (b.whisperModel !== undefined) {
    const m = typeof b.whisperModel === 'string' ? b.whisperModel.trim() : '';
    if (!/^[\w./:-]{1,120}$/.test(m)) throw new HttpError(400, 'Pick a Whisper model, like Systran/faster-whisper-small');
    out.whisperModel = m;
  }
  if (b.openaiPrice !== undefined) {
    const n = Number(b.openaiPrice);
    if (!Number.isFinite(n) || n < 0 || n > 1000) throw new HttpError(400, 'The voice price is dollars per million characters');
    out.openaiPrice = n;
  }
  return out;
}

/** Kokoro names voices like af_heart (and mixes like af_heart+am_adam); OpenAI like coral. */
export const isVoiceName = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_+.()-]{1,80}$/.test(v);

/** What a call to `model` costs per token: Ollama runs on your own server, so nothing. */
export function priceFor(s: DjSettings, model: string): Price | null {
  if (model.startsWith('ollama:')) return null;
  return priceOf(s, model) ?? priceOf(s, s.model);
}

export function priceOf(s: DjSettings, model: string): Price | null {
  return s.prices[model] ?? MODELS.find((m) => m.id === model)?.price ?? null;
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Web searches the provider ran in this call (billed per search, on top of tokens). */
  webSearches?: number;
}

/**
 * Estimated USD for one call. Unknown models (no price set) count their tokens as free, and the admin page says
 * so; web searches are always counted. Pages read with web fetch cost only their tokens.
 */
export function costOf(p: Price | null, u: TokenUsage, searchPrice = DEFAULTS.webSearchPrice): number {
  const searches = ((u.webSearches ?? 0) * searchPrice) / 1000;
  if (!p) return searches;
  return (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1e6 + searches;
}

/**
 * Whether this person's DJ may search the web and read pages (the provider's own web search and web fetch tools).
 * Switched in Settings → Features (`djWeb`, with its own kids switch); the cap and price are DJ settings.
 */
export const webFor = (db: Db, user: Pick<User, 'role'>) => featureOn(db, 'djWeb', user);

// ---- who may use it ----

export interface Access {
  enabled: boolean;
  monthlyLimit: number | null;
}

export function getAccess(db: Db, userId: number): Access {
  const r = db.prepare('SELECT enabled, monthly_limit FROM dj_access WHERE user_id = ?').get(userId) as { enabled: number; monthly_limit: number | null } | undefined;
  return { enabled: !!r?.enabled, monthlyLimit: r ? r.monthly_limit : null };
}

/** `monthlyLimit` missing keeps the current one (or the default for a first switch-on). */
export function setAccess(db: Db, userId: number, p: { enabled?: boolean; monthlyLimit?: unknown }): Access {
  const had = db.prepare('SELECT 1 FROM dj_access WHERE user_id = ?').get(userId);
  const cur = getAccess(db, userId);
  const enabled = p.enabled ?? cur.enabled;
  const monthlyLimit = p.monthlyLimit !== undefined ? money(p.monthlyLimit, 'The monthly limit') : had ? cur.monthlyLimit : getSettings(db).defaultUserLimit;
  db.prepare(`INSERT INTO dj_access (user_id, enabled, monthly_limit, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET enabled = excluded.enabled, monthly_limit = excluded.monthly_limit, updated_at = excluded.updated_at`)
    .run(userId, enabled ? 1 : 0, monthlyLimit, Date.now());
  return getAccess(db, userId);
}

/** The first moment of this calendar month, in the Hub's time zone. */
export function monthStart(now = Date.now()): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

export function spentSince(db: Db, since: number, userId?: number): number {
  const r = (userId === undefined
    ? db.prepare('SELECT COALESCE(SUM(cost), 0) AS c FROM dj_usage WHERE at >= ?').get(since)
    : db.prepare('SELECT COALESCE(SUM(cost), 0) AS c FROM dj_usage WHERE at >= ? AND user_id = ?').get(since, userId)) as { c: number };
  return r.c;
}

export function recordUsage(db: Db, userId: number, conversationId: number | null, model: string, u: TokenUsage, cost: number) {
  db.prepare(`INSERT INTO dj_usage (user_id, at, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, web_searches, cost, conversation_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(userId, Date.now(), model, u.input, u.output, u.cacheRead, u.cacheWrite, u.webSearches ?? 0, cost, conversationId);
}

/** Why this person can't use the DJ right now, or null when they can. */
export function blockedReason(db: Db, secretKey: Buffer, user: User): string | null {
  const s = getSettings(db);
  if (!s.enabled) return 'The AI DJ is turned off on this Hub';
  if (!getAccess(db, user.id).enabled) return 'The AI DJ isn’t turned on for your account. Ask your admin';
  if (s.provider === 'ollama' ? !s.ollamaUrl : !getApiKey(db, secretKey, 'apiKey', user.id)) {
    return s.provider === 'ollama' ? 'The AI DJ isn’t set up yet: the Hub has no Ollama address' : 'The AI DJ isn’t set up yet: the Hub has no API key';
  }
  return null;
}

/** Throws 402 when this person's or the household's monthly limit is used up. */
export function checkBudget(db: Db, userId: number) {
  const s = getSettings(db);
  const since = monthStart();
  const { monthlyLimit } = getAccess(db, userId);
  if (monthlyLimit !== null && spentSince(db, since, userId) >= monthlyLimit) {
    throw new HttpError(402, `You’ve used this month’s AI DJ allowance ($${monthlyLimit.toFixed(2)}). It starts again on the 1st, or ask your admin to raise it`);
  }
  if (s.householdLimit !== null && spentSince(db, since) >= s.householdLimit) {
    throw new HttpError(402, 'The household’s AI DJ allowance for this month is used up. Ask your admin to raise it');
  }
}
