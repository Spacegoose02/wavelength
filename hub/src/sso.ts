import type { FastifyRequest } from 'fastify';
import type { Config, SsoConfig } from './config.ts';
import { safeEqual, seal, unseal } from './crypto.ts';
import type { Db } from './db.ts';
import { clientIp, HttpError } from './http.ts';
import { identityFromCookie } from './oidc.ts';

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

/**
 * Who signed in for this request: tinyauth's proxy headers (forward-auth, above), or the short-lived identity
 * cookie the Hub sets after an OIDC sign-in (oidc.ts). Either one feeds the same linking, families and pickers.
 */
export function requestIdentity(req: FastifyRequest, sso: SsoSettings, secretKey: Buffer): SsoIdentity | null {
  return ssoIdentity(req, sso) ?? (sso.oidc ? identityFromCookie(secretKey, req.headers.cookie) : null);
}

export const isSsoAdmin = (id: SsoIdentity, sso: SsoConfig) =>
  sso.admins.includes(id.username) || (!!sso.adminGroup && id.groups.includes(sso.adminGroup));

// ---- settings: the container's environment, then what admins saved in the app ----

const KEY = 'sso';
export const SSO_FIELDS = [
  'enabled', 'trustedProxies', 'proxySecret', 'autoCreate', 'admins', 'adminGroup', 'name',
  'oidc', 'oidcIssuer', 'oidcClientId', 'oidcClientSecret', 'oidcScopes', 'oidcUsernameClaim',
] as const satisfies readonly (keyof SsoConfig)[];
type SsoField = (typeof SSO_FIELDS)[number];

export const DEFAULT_OIDC_SCOPES = 'openid profile email groups';
export const DEFAULT_USERNAME_CLAIM = 'preferred_username';
/** The client secret is saved sealed, tied to this row and field. */
const SECRET_AAD = 'hub_settings:sso:oidcClientSecret';

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
  /** Why proxy sign-in (forward-auth) is off although `enabled` is set, if it is. */
  problem: string;
  /** Why OIDC sign-in is off although `oidc` is set, if it is. */
  oidcProblem: string;
  /** Any single sign-on is on: proxy headers, OIDC or both. */
  active: boolean;
}

type SsoConfigSource = Pick<Config, 'sso' | 'ssoEnv' | 'secretKey'>;

/**
 * The single sign-on settings in force. An environment variable wins (and locks its field); otherwise what an
 * admin saved; otherwise the default. Without a proxy secret or trusted proxy addresses proxy sign-in stays
 * off, because anyone who can reach the Hub's port could otherwise send `Remote-User: admin`. OIDC stays off
 * until it has an issuer, a client ID and a client secret.
 */
export function ssoSettings(db: Db, config: SsoConfigSource): SsoSettings {
  return compute(config, saved(db));
}

function compute(config: SsoConfigSource, mine: Partial<SsoConfig>): SsoSettings {
  const locked = (config.ssoEnv ?? []).filter((k): k is SsoField => (SSO_FIELDS as readonly string[]).includes(k));
  const pick = <K extends SsoField>(k: K, ok: (v: unknown) => boolean): SsoConfig[K] =>
    (!locked.includes(k) && ok(mine[k]) ? mine[k] : config.sso[k]) as SsoConfig[K];
  const strings = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string');
  const text = (v: unknown) => typeof v === 'string';
  let secret = config.sso.oidcClientSecret ?? '';
  if (!locked.includes('oidcClientSecret') && typeof mine.oidcClientSecret === 'string' && mine.oidcClientSecret) {
    try {
      secret = unseal(config.secretKey, mine.oidcClientSecret, SECRET_AAD);
    } catch {
      secret = ''; // sealed with another secret key (a restored backup): set it again
    }
  }
  const s = {
    enabled: pick('enabled', (v) => typeof v === 'boolean'),
    trustedProxies: pick('trustedProxies', strings),
    proxySecret: pick('proxySecret', text),
    autoCreate: pick('autoCreate', (v) => typeof v === 'boolean'),
    admins: pick('admins', strings),
    adminGroup: pick('adminGroup', text),
    name: pick('name', (v) => typeof v === 'string' && !!v.trim()) || 'tinyauth',
    oidc: !!pick('oidc', (v) => typeof v === 'boolean'),
    oidcIssuer: pick('oidcIssuer', text) ?? '',
    oidcClientId: pick('oidcClientId', text) ?? '',
    oidcClientSecret: secret,
    oidcScopes: pick('oidcScopes', (v) => typeof v === 'string' && !!v.trim()) || DEFAULT_OIDC_SCOPES,
    oidcUsernameClaim: pick('oidcUsernameClaim', (v) => typeof v === 'string' && !!v.trim()) || DEFAULT_USERNAME_CLAIM,
  };
  const problem = s.enabled && !s.trustedProxies.length && !s.proxySecret ? 'Set a proxy secret (or trusted proxy addresses) before single sign-on can work.' : '';
  const oidcProblem = !s.oidc ? ''
    : !s.oidcIssuer ? 'Enter the issuer URL (your tinyauth address) before OIDC sign-in can work.'
    : !s.oidcClientId ? 'Enter the client ID before OIDC sign-in can work.'
    : !s.oidcClientSecret ? 'Enter the client secret before OIDC sign-in can work.'
    : '';
  const enabled = s.enabled && !problem;
  const oidc = s.oidc && !oidcProblem;
  return { ...s, enabled, oidc, locked, problem, oidcProblem, active: enabled || oidc };
}

/** What the admin screen gets: everything but the client secret, which is never shown again once saved. */
export function ssoSettingsForAdmin(s: SsoSettings, publicUrl: string) {
  const { oidcClientSecret, ...rest } = s;
  return { ...rest, oidcClientSecretSet: !!oidcClientSecret, oidcRedirectUri: `${publicUrl}/auth/oidc/callback` };
}

/** Admins change the settings the environment doesn't fix. Only the fields sent change. */
export function putSsoSettings(db: Db, config: SsoConfigSource, patch: unknown): SsoSettings {
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
      case 'oidc':
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
      case 'oidcIssuer': {
        if (typeof v !== 'string' || v.length > 300) throw new HttpError(400, 'The issuer is a URL, like https://auth.example.com');
        const issuer = v.trim().replace(/\/+$/, '');
        if (issuer) {
          let u: URL;
          try {
            u = new URL(issuer);
          } catch {
            throw new HttpError(400, 'The issuer is a URL, like https://auth.example.com');
          }
          if (!/^https?:$/.test(u.protocol) || u.search || u.hash || u.username) throw new HttpError(400, 'The issuer is a plain https:// address, like https://auth.example.com');
        }
        next.oidcIssuer = issuer;
        break;
      }
      case 'oidcClientId':
        if (typeof v !== 'string' || v.length > 200) throw new HttpError(400, 'The client ID is text, up to 200 characters');
        next.oidcClientId = v.trim();
        break;
      case 'oidcClientSecret':
        // null or '' clears it; it's sealed at rest and never sent back
        if (v !== null && (typeof v !== 'string' || v.length > 500)) throw new HttpError(400, 'The client secret is text, up to 500 characters');
        next.oidcClientSecret = typeof v === 'string' && v.trim() ? seal(config.secretKey, v.trim(), SECRET_AAD) : '';
        break;
      case 'oidcScopes': {
        if (typeof v !== 'string' || v.length > 300) throw new HttpError(400, 'Scopes are a space-separated list');
        const scopes = [...new Set(v.split(/[\s,]+/).filter(Boolean))];
        if (scopes.some((x) => !/^[\x21\x23-\x5b\x5d-\x7e]+$/.test(x))) throw new HttpError(400, 'Scopes are a space-separated list, like openid profile email groups');
        if (scopes.length && !scopes.includes('openid')) throw new HttpError(400, 'The scopes need openid');
        next.oidcScopes = scopes.join(' ');
        break;
      }
      case 'oidcUsernameClaim':
        if (typeof v !== 'string' || (v.trim() && !/^[\w.:-]{1,60}$/.test(v.trim()))) throw new HttpError(400, 'The username claim is a claim name, like preferred_username');
        next.oidcUsernameClaim = v.trim();
        break;
    }
  }
  // Don't save a change that leaves a sign-in turned on but unable to work (it would quietly stay off).
  const after = compute(config, next);
  if (after.problem && !cur.problem) throw new HttpError(400, 'Set a proxy secret (or trusted proxy addresses) before turning single sign-on on');
  if (after.oidcProblem && !cur.oidcProblem) throw new HttpError(400, after.oidcProblem.replace(' before OIDC sign-in can work.', ' before turning OIDC sign-in on.'));
  db.prepare('INSERT INTO hub_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(KEY, JSON.stringify(next));
  return compute(config, next);
}
