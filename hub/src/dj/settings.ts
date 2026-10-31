import { seal, unseal } from '../crypto.ts';
import type { Db } from '../db.ts';
import { HttpError } from '../http.ts';
import type { User } from '../users.ts';

/**
 * AI DJ settings (docs/AI-DJ.md): kept by the Hub and changed only by admins. The provider's API key is sealed
 * like the other server logins (crypto.ts) and never leaves the Hub: devices talk to the Hub, and the Hub
 * talks to the AI provider.
 */

const KEY = 'dj.settings';
const AAD = 'hub-setting:dj.apiKey';

export const PROVIDERS = ['anthropic'] as const;
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
}

interface Stored extends DjSettings {
  apiKey?: string; // sealed
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
};

function readStored(db: Db): Stored {
  const row = db.prepare('SELECT value FROM hub_settings WHERE key = ?').get(KEY) as { value: string } | undefined;
  if (!row) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...(JSON.parse(row.value) as Partial<Stored>) };
  } catch {
    return { ...DEFAULTS };
  }
}

function writeStored(db: Db, s: Stored) {
  db.prepare('INSERT INTO hub_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(KEY, JSON.stringify(s));
}

export function getSettings(db: Db): DjSettings {
  const { apiKey: _k, ...s } = readStored(db);
  return s;
}

/** The API key, or null when there is none or it was sealed with a different secret key. */
export function getApiKey(db: Db, secretKey: Buffer): string | null {
  const sealed = readStored(db).apiKey;
  if (!sealed) return null;
  try {
    return unseal(secretKey, sealed, AAD);
  } catch {
    return null;
  }
}

/** What admins see about the key: whether there is one and its last four characters. Never the key. */
export function keyInfo(db: Db, secretKey: Buffer): { set: boolean; hint: string | null; unreadable: boolean } {
  const sealed = readStored(db).apiKey;
  if (!sealed) return { set: false, hint: null, unreadable: false };
  const key = getApiKey(db, secretKey);
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
  if (b.prices !== undefined) {
    if (!b.prices || typeof b.prices !== 'object') throw new HttpError(400, 'Prices must be an object');
    const prices: Record<string, Price> = {};
    for (const [id, p] of Object.entries(b.prices as Record<string, unknown>).slice(0, 50)) if (/^[a-zA-Z0-9._:@/-]{1,100}$/.test(id)) prices[id] = readPrice(p);
    next.prices = prices;
  }
  if (b.apiKey !== undefined) {
    const k = typeof b.apiKey === 'string' ? b.apiKey.trim() : '';
    if (k.length > 500) throw new HttpError(400, 'That API key is too long');
    if (k) next.apiKey = seal(secretKey, k, AAD);
    else delete next.apiKey;
    changed.push('apiKey');
  }
  for (const k of Object.keys(DEFAULTS) as (keyof DjSettings)[]) if (JSON.stringify(cur[k]) !== JSON.stringify(next[k])) changed.push(k);
  writeStored(db, next);
  return { settings: getSettings(db), changed };
}

export function priceOf(s: DjSettings, model: string): Price | null {
  return s.prices[model] ?? MODELS.find((m) => m.id === model)?.price ?? null;
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** Estimated USD for one call. Unknown models (no price set) count as free, and the admin page says so. */
export function costOf(p: Price | null, u: TokenUsage): number {
  if (!p) return 0;
  return (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1e6;
}

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
  db.prepare(`INSERT INTO dj_usage (user_id, at, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost, conversation_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(userId, Date.now(), model, u.input, u.output, u.cacheRead, u.cacheWrite, cost, conversationId);
}

/** Why this person can't use the DJ right now, or null when they can. */
export function blockedReason(db: Db, secretKey: Buffer, user: User): string | null {
  const s = getSettings(db);
  if (!s.enabled) return 'The AI DJ is turned off on this Hub';
  if (!getAccess(db, user.id).enabled) return 'The AI DJ isn’t turned on for your account. Ask your admin';
  if (!getApiKey(db, secretKey)) return 'The AI DJ isn’t set up yet: the Hub has no API key';
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
