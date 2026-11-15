import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import { hashPassword } from '../crypto.ts';
import { tx } from '../db.ts';
import { createFamilyLogin, deleteFamilyLogin, getFamilyLogin, listFamilyLogins, updateFamilyLogin } from '../familyLogins.ts';
import { clientIp, HttpError, need, str } from '../http.ts';
import { putSsoSettings, ssoSettings, ssoSettingsForAdmin } from '../sso.ts';
import { countActiveAdmins, getUser, mergeUsers, USERNAME_RE } from '../users.ts';
import { MIN_PASSWORD } from './auth.ts';

/**
 * How people sign in, for admins (docs/HUB.md "Single sign-on" and "Family sign-ins"):
 * - `/api/admin/sso`: the single sign-on settings (sso.ts). Ones the container's environment sets are `locked`.
 * - `/api/admin/family-logins`: sign-ins that belong to a whole family and pick a profile (familyLogins.ts).
 * - `/api/admin/users/:id/merge`: fold a duplicate profile into another (users.ts mergeUsers).
 */
export function signInRoutes(app: FastifyInstance, { db, config, oidc }: Ctx) {
  app.get('/api/admin/sso', async (req) => {
    need(req, 'users.manage');
    return { sso: ssoSettingsForAdmin(ssoSettings(db, config), config.publicUrl), publicUrl: config.publicUrl };
  });

  app.put('/api/admin/sso', async (req) => {
    const { user } = need(req, 'users.manage');
    const patch = (req.body as { sso?: unknown } | null)?.sso;
    const sso = putSsoSettings(db, config, patch);
    // never log the secret itself
    const changed = Object.keys(patch as object).map((k) => (k === 'proxySecret' || k === 'oidcClientSecret' ? `${k} (changed)` : k));
    audit(db, { actorId: user.id, action: 'sso.changed', target: changed.join(', ').slice(0, 200), ip: clientIp(req) });
    return { sso: ssoSettingsForAdmin(sso, config.publicUrl), publicUrl: config.publicUrl };
  });

  /**
   * Check the OIDC provider: its discovery document, as the Hub sees it. `{ issuer? }` checks that address
   * instead of the saved one, before saving.
   */
  app.post('/api/admin/sso/oidc/check', async (req) => {
    need(req, 'users.manage');
    const given = str(req.body, 'issuer', 300).trim().replace(/\/+$/, '');
    const issuer = given || ssoSettings(db, config).oidcIssuer;
    if (!issuer) throw new HttpError(400, 'Enter the issuer URL first');
    if (!/^https?:\/\/[^/?#\s]+(\/[^?#\s]*)?$/.test(issuer)) throw new HttpError(400, 'The issuer is a URL, like https://auth.example.com');
    const d = await oidc.discover(issuer, true);
    return {
      ok: true,
      issuer: d.issuer,
      authorizationEndpoint: d.authorization_endpoint,
      tokenEndpoint: d.token_endpoint,
      userinfoEndpoint: d.userinfo_endpoint ?? null,
      pkce: d.code_challenge_methods_supported?.includes('S256') ?? null,
      scopes: (d as { scopes_supported?: string[] }).scopes_supported ?? null,
      redirectUri: `${config.publicUrl}/auth/oidc/callback`,
    };
  });

  /** A fresh proxy secret to paste into the proxy and save here. Not saved until PUT. */
  app.post('/api/admin/sso/secret', async (req) => {
    need(req, 'users.manage');
    return { secret: randomBytes(32).toString('hex') };
  });

  // ---- family sign-ins ----

  async function readLogin(body: unknown, creating: boolean) {
    const b = (body ?? {}) as Record<string, unknown>;
    const p: { username?: string | null; passwordHash?: string | null; ssoSubject?: string | null; signOutEverywhere?: boolean } = {};
    if (b.username !== undefined || creating) {
      const u = b.username ? str(b, 'username', 32).toLowerCase() : null;
      if (u && !USERNAME_RE.test(u)) throw new HttpError(400, 'Usernames are 1–32 letters, numbers, dots, dashes or underscores');
      p.username = u;
    }
    if (typeof b.password === 'string' && b.password) {
      if (b.password.length < MIN_PASSWORD) throw new HttpError(400, `Passwords need at least ${MIN_PASSWORD} characters`);
      p.passwordHash = await hashPassword(str(b, 'password', 200));
    } else if (b.password === null || (p.username === null && !creating)) p.passwordHash = null;
    if (b.ssoSubject !== undefined || creating) p.ssoSubject = b.ssoSubject ? str(b, 'ssoSubject', 100).toLowerCase() || null : null;
    if (b.signOutEverywhere === true) p.signOutEverywhere = true;
    return p;
  }

  app.get('/api/admin/family-logins', async (req) => {
    need(req, 'users.manage');
    return { logins: listFamilyLogins(db) };
  });

  app.post('/api/admin/family-logins', async (req) => {
    const { user } = need(req, 'users.manage');
    const familyId = Number((req.body as { familyId?: unknown } | null)?.familyId);
    const p = await readLogin(req.body, true);
    const login = tx(db, () => createFamilyLogin(db, { familyId, username: p.username ?? null, passwordHash: p.passwordHash ?? null, ssoSubject: p.ssoSubject ?? null }));
    audit(db, { actorId: user.id, action: 'family_login.created', target: login.username ?? login.ssoSubject ?? '', detail: { familyId, sso: !!login.ssoSubject }, ip: clientIp(req) });
    return { login };
  });

  app.patch<{ Params: { id: string } }>('/api/admin/family-logins/:id', async (req) => {
    const { user } = need(req, 'users.manage');
    const id = Number(req.params.id);
    if (!getFamilyLogin(db, id)) throw new HttpError(404, 'No such family sign-in');
    const p = await readLogin(req.body, false);
    const login = tx(db, () => updateFamilyLogin(db, id, p));
    const { passwordHash, ...changed } = p;
    audit(db, { actorId: user.id, action: 'family_login.updated', target: login.username ?? login.ssoSubject ?? '', detail: { ...changed, ...(passwordHash !== undefined && { password: passwordHash ? 'changed' : 'removed' }) }, ip: clientIp(req) });
    return { login };
  });

  app.delete<{ Params: { id: string } }>('/api/admin/family-logins/:id', async (req) => {
    const { user } = need(req, 'users.manage');
    const login = deleteFamilyLogin(db, Number(req.params.id));
    audit(db, { actorId: user.id, action: 'family_login.deleted', target: login.username ?? login.ssoSubject ?? '', ip: clientIp(req) });
    return { ok: true };
  });

  // ---- merging profiles ----

  /** `{ into }`: move everything this profile has to `into`, then delete it. */
  app.post<{ Params: { id: string } }>('/api/admin/users/:id/merge', async (req) => {
    const { user: actor } = need(req, 'users.manage');
    const fromId = Number(req.params.id);
    const intoId = Number((req.body as { into?: unknown } | null)?.into);
    const from = getUser(db, fromId);
    const into = getUser(db, intoId);
    if (!from || !into) throw new HttpError(404, 'No such user');
    if (from.id === actor.id) throw new HttpError(400, 'You can’t merge away the profile you’re signed in with. Merge it from another admin, or the other way round');
    const merged = tx(db, () => {
      if (from.role === 'admin' && !from.disabled && into.role !== 'admin' && countActiveAdmins(db) <= 1) throw new HttpError(409, 'This is the last admin. Make someone else an admin first');
      return mergeUsers(db, fromId, intoId);
    });
    audit(db, { actorId: actor.id, action: 'user.merged', target: into.username, detail: { from: from.username, sso: from.ssoSubject }, ip: clientIp(req) });
    return { user: merged };
  });
}
