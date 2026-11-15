import { createHash, createHmac, createPublicKey, randomBytes, verify, constants, type JsonWebKey, type KeyObject } from 'node:crypto';
import type { SsoIdentity } from './sso.ts';
import { hmac, safeEqual } from './crypto.ts';
import { HttpError } from './http.ts';

/**
 * Sign in with OpenID Connect (docs/HUB.md "Sign in with OIDC"). The Hub is an ordinary confidential OIDC client
 * of tinyauth (or any OIDC provider): authorization code flow with PKCE (S256), a `state` bound to the browser
 * by a cookie, a `nonce` in the ID token, the ID token's signature checked against the provider's JWKS, and
 * the client secret sent only to the token endpoint.
 *
 * The result is the same {@link SsoIdentity} the proxy headers give (sso.ts), kept for a few minutes in a signed
 * cookie (`wl_sso`). Every single sign-on page (/auth/sso/link, /auth/sso/connect, /auth/sso/web and
 * /auth/sso/session) reads it, so linking, family sign-ins, the profile picker, PINs and Stay signed in work the
 * same whichever way tinyauth was asked. Apps on other devices sign in with a pairing code whose link the person
 * opens in their phone's or computer's own browser; the browser does the OIDC part.
 *
 * The person is named by `preferred_username` (configurable), not `sub`: tinyauth's `sub` changes with the client
 * ID, while the username is what forward-auth's `Remote-User` already linked people by.
 */

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface OidcSettings {
  oidcIssuer: string;
  oidcClientId: string;
  oidcClientSecret: string;
  oidcScopes: string;
  oidcUsernameClaim: string;
}

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  jwks_uri?: string;
  token_endpoint_auth_methods_supported?: string[];
  code_challenge_methods_supported?: string[];
  id_token_signing_alg_values_supported?: string[];
}

interface Pending {
  issuer: string;
  clientId: string;
  nonce: string;
  verifier: string;
  next: string;
  expires: number;
}

/** How long the browser has to get through the provider's login. */
const PENDING_TTL_MS = 10 * 60_000;
/** How long the Hub remembers who OIDC signed in, for the pages that follow (approve a device, link an account). */
export const IDENTITY_TTL_S = 15 * 60;
const DISCOVERY_TTL_MS = 10 * 60_000;
const MAX_PENDING = 2000;
const CLOCK_SKEW_S = 120;

export const STATE_COOKIE = 'wl_oidc_state';
export const IDENTITY_COOKIE = 'wl_sso';

/** Where a sign-in may return to: the Hub's own single sign-on pages or the app. Never another site. */
export function safeNext(next: unknown): string {
  if (typeof next !== 'string' || next.length > 500) return '/auth/sso/web';
  if (!/^\/(?!\/)/.test(next) || /[\\\s]/.test(next)) return '/auth/sso/web';
  if (next === '/' || next.startsWith('/?') || next.startsWith('/auth/sso/')) return next;
  return '/auth/sso/web';
}

const b64url = (b: Buffer) => b.toString('base64url');

export class Oidc {
  private discovery = new Map<string, { at: number; d: Discovery }>();
  private keys = new Map<string, { at: number; keys: JsonWebKey[] }>();
  private pending = new Map<string, Pending>();

  private fetchFn: Fetch;

  constructor(fetchFn: Fetch = (url, init) => fetch(url, init)) {
    this.fetchFn = fetchFn;
  }

  private async getJson(url: string, init?: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
    let res: Response;
    try {
      res = await this.fetchFn(url, { ...init, signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json', ...(init?.headers as Record<string, string>) } });
    } catch (e) {
      throw new HttpError(502, `Couldn't reach the sign-in provider at ${new URL(url).origin}: ${(e as Error).message}`);
    }
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      throw new HttpError(502, `The sign-in provider answered ${new URL(url).pathname} with something that isn't JSON (HTTP ${res.status})`);
    }
    return { status: res.status, body };
  }

  /** The provider's endpoints, from `<issuer>/.well-known/openid-configuration`. */
  async discover(issuer: string, fresh = false): Promise<Discovery> {
    const hit = this.discovery.get(issuer);
    if (hit && !fresh && Date.now() - hit.at < DISCOVERY_TTL_MS) return hit.d;
    const { status, body } = await this.getJson(`${issuer}/.well-known/openid-configuration`);
    if (status !== 200) throw new HttpError(502, `The sign-in provider has no OpenID configuration at ${issuer}/.well-known/openid-configuration (HTTP ${status}). Check the issuer URL.`);
    const d = body as unknown as Discovery;
    if (typeof d.authorization_endpoint !== 'string' || typeof d.token_endpoint !== 'string') throw new HttpError(502, 'The provider’s OpenID configuration has no authorization or token endpoint');
    // the issuer it states must be the one configured, or tokens it signs would never match (OIDC Discovery §4.3)
    if (typeof d.issuer !== 'string' || d.issuer.replace(/\/+$/, '') !== issuer) throw new HttpError(502, `The provider says its issuer is “${String(d.issuer)}”, not “${issuer}”. Use that as the issuer URL.`);
    this.discovery.set(issuer, { at: Date.now(), d });
    return d;
  }

  /** Start a sign-in: the provider URL to send the browser to, and the state to bind to it with a cookie. */
  async begin(s: OidcSettings, redirectUri: string, next: string): Promise<{ url: string; state: string }> {
    const d = await this.discover(s.oidcIssuer);
    this.prune();
    const state = b64url(randomBytes(24));
    const nonce = b64url(randomBytes(24));
    const verifier = b64url(randomBytes(48));
    this.pending.set(state, { issuer: s.oidcIssuer, clientId: s.oidcClientId, nonce, verifier, next: safeNext(next), expires: Date.now() + PENDING_TTL_MS });
    const u = new URL(d.authorization_endpoint);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', s.oidcClientId);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('scope', s.oidcScopes);
    u.searchParams.set('state', state);
    u.searchParams.set('nonce', nonce);
    u.searchParams.set('code_challenge', b64url(createHash('sha256').update(verifier).digest()));
    u.searchParams.set('code_challenge_method', 'S256');
    return { url: u.toString(), state };
  }

  /**
   * Finish a sign-in at the callback: check `state` against the browser's cookie, trade the code for tokens,
   * check the ID token, and read who it is.
   */
  async finish(s: OidcSettings, redirectUri: string, query: Record<string, unknown>, cookieState: string | undefined): Promise<{ identity: SsoIdentity; next: string }> {
    const state = typeof query.state === 'string' ? query.state : '';
    const p = state ? this.pending.get(state) : undefined;
    if (!p || !cookieState || !safeEqual(cookieState, state)) throw new HttpError(400, 'This sign-in has expired or was started in another browser. Start again.');
    this.pending.delete(state); // one use
    if (p.expires < Date.now()) throw new HttpError(400, 'This sign-in took too long. Start again.');
    if (p.issuer !== s.oidcIssuer || p.clientId !== s.oidcClientId) throw new HttpError(400, 'The sign-in settings changed while you were signing in. Start again.');
    if (typeof query.error === 'string') {
      const why = typeof query.error_description === 'string' ? query.error_description : query.error;
      throw new HttpError(query.error === 'access_denied' ? 403 : 400, `The sign-in provider said no: ${String(why).slice(0, 200)}`);
    }
    const code = typeof query.code === 'string' ? query.code : '';
    if (!code) throw new HttpError(400, 'The sign-in provider sent no code back');
    const d = await this.discover(s.oidcIssuer);

    // the code for tokens; the secret goes only here
    const form = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: p.verifier });
    const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
    const methods = d.token_endpoint_auth_methods_supported;
    if (!methods || methods.includes('client_secret_basic')) {
      // RFC 6749 §2.3.1: form-encode each half before Basic
      const enc = (x: string) => encodeURIComponent(x).replace(/%20/g, '+');
      headers.authorization = `Basic ${Buffer.from(`${enc(s.oidcClientId)}:${enc(s.oidcClientSecret)}`).toString('base64')}`;
    } else {
      form.set('client_id', s.oidcClientId);
      form.set('client_secret', s.oidcClientSecret);
    }
    const tok = await this.getJson(d.token_endpoint, { method: 'POST', headers, body: form.toString() });
    if (tok.status !== 200) {
      const err = typeof tok.body.error === 'string' ? tok.body.error : `HTTP ${tok.status}`;
      const hint = err === 'invalid_client' ? ' Check the client ID and secret.' : err === 'invalid_grant' ? ' Check the redirect URI registered with the provider.' : '';
      throw new HttpError(502, `The sign-in provider refused the sign-in (${err}).${hint}`);
    }
    const idToken = tok.body.id_token;
    if (typeof idToken !== 'string') throw new HttpError(502, 'The sign-in provider sent no ID token. Is openid in the scopes?');
    const claims = await this.checkIdToken(d, s, idToken, p.nonce);

    // userinfo often carries what the ID token leaves out (groups, email)
    if (d.userinfo_endpoint && typeof tok.body.access_token === 'string') {
      try {
        const ui = await this.getJson(d.userinfo_endpoint, { headers: { authorization: `Bearer ${tok.body.access_token}` } });
        if (ui.status === 200 && ui.body.sub === claims.sub) for (const [k, v] of Object.entries(ui.body)) if (claims[k] === undefined) claims[k] = v;
      } catch {
        /* the ID token is enough */
      }
    }
    return { identity: identityFromClaims(claims, s.oidcUsernameClaim), next: p.next };
  }

  /** OIDC Core §3.1.3.7: signature, issuer, audience, expiry, nonce. */
  private async checkIdToken(d: Discovery, s: OidcSettings, jwt: string, nonce: string): Promise<Record<string, unknown>> {
    const parts = jwt.split('.');
    if (parts.length !== 3) throw new HttpError(502, 'The ID token is not a JWT');
    let header: { alg?: string; kid?: string };
    let claims: Record<string, unknown>;
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
      throw new HttpError(502, 'The ID token could not be read');
    }
    const data = Buffer.from(`${parts[0]}.${parts[1]}`);
    const sig = Buffer.from(parts[2], 'base64url');
    const alg = header.alg ?? '';
    let ok: boolean;
    if (/^HS(256|384|512)$/.test(alg)) {
      ok = safeEqual(createHmac(`sha${alg.slice(2)}`, s.oidcClientSecret).update(data).digest('base64url'), parts[2]);
    } else {
      const key = await this.key(d, header.kid, alg);
      ok = verifyJws(alg, data, sig, key);
    }
    if (!ok) throw new HttpError(502, 'The ID token’s signature did not check out');
    const now = Math.floor(Date.now() / 1000);
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== d.issuer) throw new HttpError(502, 'The ID token is from another issuer');
    if (!aud.includes(s.oidcClientId)) throw new HttpError(502, 'The ID token is for another client');
    if (aud.length > 1 && claims.azp !== undefined && claims.azp !== s.oidcClientId) throw new HttpError(502, 'The ID token is for another client');
    if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_S < now) throw new HttpError(502, 'The ID token has expired. Is the Hub’s clock right?');
    if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_S > now) throw new HttpError(502, 'The ID token is from the future. Is the Hub’s clock right?');
    if (typeof claims.nonce !== 'string' || !safeEqual(claims.nonce, nonce)) throw new HttpError(502, 'The ID token does not belong to this sign-in');
    if (typeof claims.sub !== 'string' || !claims.sub) throw new HttpError(502, 'The ID token names nobody');
    return claims;
  }

  /** The provider's signing key for `kid`, fetching its JWKS again once if the key is new (rotation). */
  private async key(d: Discovery, kid: string | undefined, alg: string): Promise<KeyObject> {
    if (!d.jwks_uri) throw new HttpError(502, 'The provider publishes no signing keys (jwks_uri)');
    const find = (keys: JsonWebKey[]) => {
      const usable = keys.filter((k) => (!k.use || k.use === 'sig') && (!k.alg || k.alg === alg));
      return kid ? usable.find((k) => k.kid === kid) : usable.length === 1 ? usable[0] : usable.find((k) => k.kty === (alg.startsWith('ES') ? 'EC' : alg === 'EdDSA' ? 'OKP' : 'RSA'));
    };
    for (const fresh of [false, true]) {
      const hit = this.keys.get(d.jwks_uri);
      let keys = hit && !fresh && Date.now() - hit.at < DISCOVERY_TTL_MS ? hit.keys : undefined;
      if (!keys) {
        const r = await this.getJson(d.jwks_uri);
        keys = Array.isArray(r.body.keys) ? (r.body.keys as JsonWebKey[]) : [];
        this.keys.set(d.jwks_uri, { at: Date.now(), keys });
      }
      const k = find(keys);
      if (k) {
        try {
          return createPublicKey({ key: k, format: 'jwk' });
        } catch {
          throw new HttpError(502, 'The provider’s signing key could not be read');
        }
      }
      if (hit && Date.now() - hit.at < 10_000) break; // just fetched: don't hammer it
    }
    throw new HttpError(502, 'The ID token was signed with a key the provider does not publish');
  }

  private prune() {
    const now = Date.now();
    for (const [k, v] of this.pending) if (v.expires < now) this.pending.delete(k);
    while (this.pending.size >= MAX_PENDING) this.pending.delete(this.pending.keys().next().value as string);
  }
}

function verifyJws(alg: string, data: Buffer, sig: Buffer, key: KeyObject): boolean {
  const m = /^(RS|PS|ES)(256|384|512)$/.exec(alg);
  try {
    if (alg === 'EdDSA') return verify(null, data, key, sig);
    if (!m) return false;
    const hash = `sha${m[2]}`;
    if (m[1] === 'RS') return verify(hash, data, key, sig);
    if (m[1] === 'PS') return verify(hash, data, { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: Number(m[2]) / 8 }, sig);
    return verify(hash, data, { key, dsaEncoding: 'ieee-p1363' }, sig);
  } catch {
    return false;
  }
}

/** Claims → the identity the rest of single sign-on uses (the same shape as tinyauth's proxy headers). */
export function identityFromClaims(c: Record<string, unknown>, usernameClaim: string): SsoIdentity {
  const raw = c[usernameClaim];
  const username = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!username) throw new HttpError(502, `The sign-in provider didn't send ${usernameClaim}. Add the profile scope, or pick another username claim in Settings → Single sign-on.`);
  if (username.length > 100) throw new HttpError(502, 'That username is too long');
  const g = c.groups;
  const groups = (Array.isArray(g) ? g : typeof g === 'string' ? g.split(',') : []).filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean).slice(0, 50);
  return {
    username,
    name: typeof c.name === 'string' ? c.name.slice(0, 100) : '',
    email: typeof c.email === 'string' ? c.email.slice(0, 200) : '',
    groups,
  };
}

// ---- the identity cookie: who OIDC signed in, for the next few minutes ----

const cookieMac = (secret: Buffer, payload: string) => hmac(secret, `oidc-identity:${payload}`);

export function identityCookieValue(secret: Buffer, id: SsoIdentity, now = Date.now()): string {
  const payload = b64url(Buffer.from(JSON.stringify({ u: id.username, n: id.name, e: id.email, g: id.groups, x: Math.floor(now / 1000) + IDENTITY_TTL_S })));
  return `${payload}.${cookieMac(secret, payload)}`;
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export function identityFromCookie(secret: Buffer, header: string | undefined): SsoIdentity | null {
  const v = readCookie(header, IDENTITY_COOKIE);
  const m = v ? /^([\w-]+)\.([\w-]+)$/.exec(v) : null;
  if (!m || !safeEqual(m[2], cookieMac(secret, m[1]))) return null;
  try {
    const o = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')) as { u: string; n: string; e: string; g: string[]; x: number };
    if (typeof o.x !== 'number' || o.x < Date.now() / 1000 || typeof o.u !== 'string' || !o.u) return null;
    return { username: o.u, name: o.n ?? '', email: o.e ?? '', groups: Array.isArray(o.g) ? o.g : [] };
  } catch {
    return null;
  }
}

/** A Set-Cookie value. `Secure` when the Hub's public address is https. */
export function cookie(name: string, value: string, o: { path: string; maxAge: number; secure: boolean }): string {
  return `${name}=${encodeURIComponent(value)}; Path=${o.path}; Max-Age=${o.maxAge}; HttpOnly; SameSite=Lax${o.secure ? '; Secure' : ''}`;
}
