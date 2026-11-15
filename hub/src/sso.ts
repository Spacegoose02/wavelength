import type { FastifyRequest } from 'fastify';
import type { Config, SsoConfig } from './config.ts';
import { safeEqual } from './crypto.ts';
import type { Db } from './db.ts';
import { clientIp, HttpError } from './http.ts';

/** Who tinyauth says is signed in, read from the headers the proxy forwards. */
export interface SsoIdentity {
  username: string;
  name: string;
  email: string;
  groups: string[];
}

/**
 * The identity headers are only believed when the request comes from a trusted proxy address and/or
 * carries the shared proxy secret (whichever are configured; config.ts refuses to start with neither).
 * Otherwise anyone who can reach the Hub could send `Remote-User: admin`.
 */
export function ssoIdentity(req: FastifyRequest, sso: SsoConfig): SsoIdentity | null {
  if (!sso.enabled) return null;
  if (sso.trustedProxies.length && !sso.trustedProxies.includes(clientIp(req))) return null;
  if (sso.proxySecret) {
    const got = req.headers['x-wavelength-proxy-secret'];
    if (typeof got !== 'string' || !safeEqual(got, sso.proxySecret)) return null;
  }
  const h = (name: string) => {
    const v = req.headers[name];
    return (Array.isArray(v) ? v[0] : v ?? '').trim();
  };
  const username = h('remote-user').toLowerCase();
  if (!username) return null;
  return {
    username,
    name: h('remote-name'),
    email: h('remote-email'),
    groups: h('remote-groups').split(',').map((g) => g.trim()).filter(Boolean),
  };
}

export const isSsoAdmin = (id: SsoIdentity, sso: SsoConfig) =>
  sso.admins.includes(id.username) || (!!sso.adminGroup && id.groups.includes(sso.adminGroup));

// ---- settings: the container's environment, then what admins saved in the app ----

const KEY = 'sso';
export const SSO_FIELDS = ['enabled', 'trustedProxies', 'proxySecret', 'autoCreate', 'admins', 'adminGroup', 'name'] as const satisfies readonly (keyof SsoConfig)[];
type SsoField = (typeof SSO_FIELDS)[number];

/** What admins saved in Settings → Single sign-on (hub_settings 'sso'). Fields the environment sets are ignored. */
function saved(db: Db): Partial<SsoConfig> {
  const row = db.prepare('SELECT value FROM hub_settings WHERE key = ?').get(KEY) as { value: string } | undefined;
  try {
    return row ? (JSON.parse(row.value) as Partial<SsoConfig>) : {};
  } catch {
    return {};
  }
}

export interface SsoSettings extends Required<SsoConfig> {
  /** Settings the container's environment variables fix; the app shows them but can't change them. */
  locked: SsoField[];
  /** Why single sign-on is off although `enabled` is set, if it is. */
  problem: string;
}

/**
 * The single sign-on settings in force. An environment variable wins (and locks its field); otherwise what an
 * admin saved; otherwise the default. Without a proxy secret or trusted proxy addresses single sign-on stays
 * off, because anyone who can reach the Hub's port could otherwise send `Remote-User: admin`.
 */
export function ssoSettings(db: Db, config: Pick<Config, 'sso' | 'ssoEnv'>): SsoSettings {
  const locked = (config.ssoEnv ?? []).filter((k): k is SsoField => (SSO_FIELDS as readonly string[]).includes(k));
  const mine = saved(db);
  const pick = <K extends SsoField>(k: K, ok: (v: unknown) => boolean): SsoConfig[K] =>
    (!locked.includes(k) && ok(mine[k]) ? mine[k] : config.sso[k]) as SsoConfig[K];
  const strings = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string');
  const s = {
    enabled: pick('enabled', (v) => typeof v === 'boolean'),
    trustedProxies: pick('trustedProxies', strings),
    proxySecret: pick('proxySecret', (v) => typeof v === 'string'),
    autoCreate: pick('autoCreate', (v) => typeof v === 'boolean'),
    admins: pick('admins', strings),
    adminGroup: pick('adminGroup', (v) => typeof v === 'string'),
    name: pick('name', (v) => typeof v === 'string' && !!v.trim()) || 'tinyauth',
  };
  const problem = s.enabled && !s.trustedProxies.length && !s.proxySecret ? 'Set a proxy secret (or trusted proxy addresses) before single sign-on can work.' : '';
  return { ...s, enabled: s.enabled && !problem, locked, problem };
}

/** Admins change the settings the environment doesn't fix. Only the fields sent change. */
export function putSsoSettings(db: Db, config: Pick<Config, 'sso' | 'ssoEnv'>, patch: unknown): SsoSettings {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new HttpError(400, 'Send the single sign-on settings to change');
  const p = patch as Record<string, unknown>;
  const cur = ssoSettings(db, config);
  const next = saved(db);
  const list = (k: string, v: unknown, lower: boolean) => {
    const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : null;
    if (!raw || raw.length > 50 || raw.some((x) => typeof x !== 'string' || x.length > 100)) throw new HttpError(400, `${k} is a list of names`);
    return [...new Set((raw as string[]).map((x) => (lower ? x.trim().toLowerCase() : x.trim())).filter(Boolean))];
  };
  for (const [k, v] of Object.entries(p)) {
    if (!(SSO_FIELDS as readonly string[]).includes(k)) throw new HttpError(400, `Unknown setting: ${k.slice(0, 40)}`);
    if (cur.locked.includes(k as SsoField)) throw new HttpError(409, `${k} is set by the container's environment. Change it there.`);
    switch (k as SsoField) {
      case 'enabled':
      case 'autoCreate':
        if (typeof v !== 'boolean') throw new HttpError(400, `${k} must be true or false`);
        next[k as 'enabled'] = v;
        break;
      case 'trustedProxies':
        next.trustedProxies = list(k, v, false);
        if (next.trustedProxies.some((ip) => !/^[0-9a-f.:]+$/i.test(ip))) throw new HttpError(400, 'Trusted proxies are IP addresses, like 172.17.0.1');
        break;
      case 'admins':
        next.admins = list(k, v, true);
        break;
      case 'proxySecret':
        if (typeof v !== 'string' || v.length > 200) throw new HttpError(400, 'The proxy secret is text, up to 200 characters');
        if (v && v.trim().length < 16) throw new HttpError(400, 'Use a proxy secret of at least 16 characters (Generate makes one)');
        next.proxySecret = v.trim();
        break;
      case 'adminGroup':
      case 'name':
        if (typeof v !== 'string' || v.length > 60) throw new HttpError(400, `${k} is text, up to 60 characters`);
        next[k as 'name'] = v.trim();
        break;
    }
  }
  const after = Object.fromEntries(SSO_FIELDS.map((k) => [k, cur.locked.includes(k) || next[k] === undefined ? (k === 'enabled' ? cur.enabled || !!cur.problem : cur[k]) : next[k]])) as Required<SsoConfig>;
  if (after.enabled && !after.trustedProxies.length && !after.proxySecret) throw new HttpError(400, 'Set a proxy secret (or trusted proxy addresses) before turning single sign-on on');
  db.prepare('INSERT INTO hub_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(KEY, JSON.stringify(next));
  return ssoSettings(db, config);
}
