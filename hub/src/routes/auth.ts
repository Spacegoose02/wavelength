import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import { DUMMY_HASH, hashPassword, hmac, normalizeUserCode, safeEqual, verifyPassword } from '../crypto.ts';
import { tx } from '../db.ts';
import { createDevice, revokeDevice } from '../devices.ts';
import { clientIp, html, HttpError, signedIn, str } from '../http.ts';
import { linkPage, message, setupPage, ssoConfirmPage } from '../pages.ts';
import { decidePairing, pendingPairing, pollPairing, POLL_INTERVAL_S, startPairing } from '../pairing.ts';
import { permissionsFor } from '../roles.ts';
import { isSsoAdmin, ssoIdentity, type SsoIdentity } from '../sso.ts';
import { countUsers, createUser, getUser, getUserBySso, getUserForLogin, updateUser, USERNAME_RE, type User } from '../users.ts';

export const MIN_PASSWORD = 10;

/** What the app gets back after any successful sign-in. */
export const session = (token: string, user: User, device: { id: number; name: string }) => ({
  token,
  user,
  permissions: permissionsFor(user),
  device,
});

export function authRoutes(app: FastifyInstance, { db, config, limits }: Ctx) {
  const deviceInfo = (body: unknown) => ({
    name: str(body, 'deviceName', 60) || 'Wavelength',
    platform: str(body, 'platform', 30) || 'unknown',
  });

  /** Check a Hub password. Same timing whether or not the user exists. */
  async function checkPassword(req: FastifyRequest, username: string, password: string): Promise<User> {
    const key = `${clientIp(req)}|${username.toLowerCase()}`;
    limits.login.hit(key);
    const u = getUserForLogin(db, username);
    const ok = await verifyPassword(password, u?.passwordHash ?? DUMMY_HASH);
    if (!u || !ok || u.disabled) {
      audit(db, { action: 'auth.login_failed', target: username.toLowerCase(), ip: clientIp(req) });
      throw new HttpError(401, 'Wrong username or password');
    }
    limits.login.clear(key);
    return u;
  }

  /** The Wavelength user for a tinyauth identity: linked, auto-created, or none. */
  function ssoUser(id: SsoIdentity, ip: string): User | null {
    const admin = isSsoAdmin(id, config.sso);
    return tx(db, () => {
      const found = getUserBySso(db, id.username);
      if (found) {
        if (found.disabled) return null;
        if (admin && found.role !== 'admin') {
          audit(db, { action: 'user.promoted_by_sso', target: found.username, ip });
          return updateUser(db, found.id, { role: 'admin' }) ?? null;
        }
        return found;
      }
      // The very first person through SSO on an empty Hub can't be checked by anyone, so they must be a named admin.
      if (!(config.sso.autoCreate && countUsers(db) > 0) && !admin) return null;
      let username = id.username.replace(/[^a-z0-9._-]/g, '').slice(0, 28) || 'user';
      if (!USERNAME_RE.test(username)) username = `u${username}`.slice(0, 28);
      for (let n = 2; getUserForLogin(db, username); n++) username = `${username.replace(/\d+$/, '')}${n}`;
      const u = createUser(db, { username, displayName: id.name || id.username, role: admin ? 'admin' : 'member', ssoSubject: id.username });
      audit(db, { actorId: u.id, action: 'user.created_by_sso', target: u.username, detail: { role: u.role }, ip });
      return u;
    });
  }

  app.get('/api/health', async () => ({ ok: true, name: 'wavelength-hub', version: config.version, setupNeeded: countUsers(db) === 0, sso: config.sso.enabled }));

  // ---- first run ----

  async function setup(body: unknown, ip: string) {
    const username = str(body, 'username', 32).toLowerCase();
    const password = str(body, 'password', 200);
    if (!USERNAME_RE.test(username)) throw new HttpError(400, 'Usernames are 1–32 letters, numbers, dots, dashes or underscores');
    if (password.length < MIN_PASSWORD) throw new HttpError(400, `Passwords need at least ${MIN_PASSWORD} characters`);
    const passwordHash = await hashPassword(password);
    return tx(db, () => {
      if (countUsers(db) > 0) throw new HttpError(409, 'This Hub is already set up');
      const u = createUser(db, { username, displayName: str(body, 'displayName', 60), role: 'admin', passwordHash });
      audit(db, { actorId: u.id, action: 'hub.setup', target: u.username, ip });
      return u;
    });
  }

  app.get('/setup', async (_req, reply) => (countUsers(db) ? reply.redirect('/link') : html(reply, setupPage())));
  app.post('/setup', async (req, reply) => {
    try {
      await setup(req.body, clientIp(req));
      return html(reply, message('Ready', 'Your admin account is ready. Sign in from the Wavelength app: Settings → Wavelength Hub.'));
    } catch (e) {
      if (e instanceof HttpError && e.statusCode === 409) return reply.redirect('/link');
      if (e instanceof HttpError) return html(reply, setupPage(e.message), e.statusCode);
      throw e;
    }
  });
  /** JSON version, so the app can set up a fresh Hub without a browser. */
  app.post('/auth/setup', async (req) => {
    const u = await setup(req.body, clientIp(req));
    const { device, token } = createDevice(db, u.id, deviceInfo(req.body).name, deviceInfo(req.body).platform);
    return session(token, u, device);
  });

  // ---- direct password sign-in (no browser) ----

  app.post('/auth/login', async (req) => {
    const u = await checkPassword(req, str(req.body, 'username', 64), str(req.body, 'password', 200));
    const d = deviceInfo(req.body);
    const { device, token } = createDevice(db, u.id, d.name, d.platform);
    audit(db, { actorId: u.id, action: 'auth.login', target: d.name, detail: { method: 'password', platform: d.platform }, ip: clientIp(req) });
    return session(token, u, device);
  });

  app.post('/auth/logout', async (req) => {
    const { user, device } = signedIn(req);
    revokeDevice(db, device.id);
    audit(db, { actorId: user.id, action: 'auth.logout', target: device.name, ip: clientIp(req) });
    return { ok: true };
  });

  // ---- device pairing ----

  app.post('/auth/device', async (req) => {
    limits.pairing.hit(clientIp(req));
    if (countUsers(db) === 0) throw new HttpError(409, 'Set up this Hub first: open /setup in a browser');
    const d = deviceInfo(req.body);
    const p = startPairing(db, d.name, d.platform);
    const url = `${config.publicUrl}/link`;
    return {
      deviceCode: p.deviceCode,
      userCode: p.userCode,
      verificationUrl: url,
      verificationUrlComplete: `${url}?code=${encodeURIComponent(p.userCode)}`,
      expiresIn: Math.round((p.expiresAt - Date.now()) / 1000),
      interval: POLL_INTERVAL_S,
    };
  });

  app.post('/auth/device/token', async (req, reply) => {
    limits.poll.hit(clientIp(req));
    const r = pollPairing(db, str(req.body, 'deviceCode', 100));
    if (r.status !== 'approved') {
      if (r.status === 'pending') return reply.code(202).send({ status: 'pending' });
      if (r.status === 'denied') return reply.code(403).send({ status: 'denied', error: 'Sign-in was denied' });
      return reply.code(410).send({ status: 'expired', error: 'The code expired. Start again' });
    }
    const u = getUser(db, r.userId)!;
    audit(db, { actorId: u.id, action: 'auth.login', target: r.device.name, detail: { method: 'pairing', platform: r.device.platform }, ip: clientIp(req) });
    return session(r.token, u, r.device);
  });

  /** Approve with a Hub password (works without tinyauth). */
  app.get('/link', async (req, reply) => {
    if (countUsers(db) === 0) return reply.redirect('/setup');
    const code = normalizeUserCode(str(req.query, 'code', 20));
    const p = code ? pendingPairing(db, code) : undefined;
    return html(reply, linkPage({ code, device: p && { name: p.deviceName, platform: p.platform }, sso: config.sso.enabled, error: code && !p ? 'That code is wrong or has expired' : '' }));
  });

  app.post('/link', async (req, reply) => {
    const code = normalizeUserCode(str(req.body, 'code', 20));
    const show = (error: string, status: number) => html(reply, linkPage({ code, sso: config.sso.enabled, error }), status);
    let u: User;
    try {
      u = await checkPassword(req, str(req.body, 'username', 64), str(req.body, 'password', 200));
    } catch (e) {
      if (e instanceof HttpError) return show(e.message, e.statusCode);
      throw e;
    }
    const p = pendingPairing(db, code);
    if (!p || !decidePairing(db, p.id, u.id, true)) return show('That code is wrong or has expired', 400);
    audit(db, { actorId: u.id, action: 'device.approved', target: p.deviceName, detail: { method: 'password' }, ip: clientIp(req) });
    return html(reply, message('Signed in', `${p.deviceName} is signed in as ${u.displayName}. You can close this page.`));
  });

  /** Approve with tinyauth. Only this path sits behind tinyauth in the proxy (docs/HUB.md). */
  const csrfFor = (pairingId: number, userId: number) => hmac(config.secretKey, `sso-link:${pairingId}:${userId}`);

  function ssoContext(req: FastifyRequest) {
    const id = ssoIdentity(req, config.sso);
    if (!id) throw new HttpError(401, config.sso.enabled ? 'Single sign-on did not identify you. Check the proxy setup in docs/HUB.md.' : 'Single sign-on is not turned on for this Hub.');
    const u = ssoUser(id, clientIp(req));
    if (!u) throw new HttpError(403, `There's no Wavelength account for “${id.username}” yet. Ask your admin to add you.`);
    return u;
  }

  app.get('/auth/sso/link', async (req, reply) => {
    try {
      const u = ssoContext(req);
      const code = normalizeUserCode(str(req.query, 'code', 20));
      const p = pendingPairing(db, code);
      if (!p) return html(reply, linkPage({ code, sso: true, error: 'That code is wrong or has expired' }), 400);
      return html(reply, ssoConfirmPage({ code, device: { name: p.deviceName, platform: p.platform }, who: u.displayName, csrf: csrfFor(p.id, u.id) }));
    } catch (e) {
      if (e instanceof HttpError) return html(reply, message('Sign-in problem', e.message, true), e.statusCode);
      throw e;
    }
  });

  app.post('/auth/sso/link', async (req, reply) => {
    try {
      const u = ssoContext(req);
      const p = pendingPairing(db, normalizeUserCode(str(req.body, 'code', 20)));
      if (!p) throw new HttpError(400, 'That code is wrong or has expired');
      if (!safeEqual(str(req.body, 'csrf', 100), csrfFor(p.id, u.id))) throw new HttpError(403, 'This page is out of date. Open the link again');
      const approve = str(req.body, 'decision', 10) === 'approve';
      decidePairing(db, p.id, u.id, approve);
      audit(db, { actorId: u.id, action: approve ? 'device.approved' : 'device.denied', target: p.deviceName, detail: { method: 'sso' }, ip: clientIp(req) });
      return html(reply, approve ? message('Signed in', `${p.deviceName} is signed in as ${u.displayName}. You can close this page.`) : message('Denied', `${p.deviceName} was not signed in.`));
    } catch (e) {
      if (e instanceof HttpError) return html(reply, message('Sign-in problem', e.message, true), e.statusCode);
      throw e;
    }
  });
}
