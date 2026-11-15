import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import { DUMMY_HASH, hashPassword, hmac, newToken, normalizeUserCode, safeEqual, sha256, verifyPassword } from '../crypto.ts';
import { tx } from '../db.ts';
import { createDevice, revokeDevice } from '../devices.ts';
import { passTotp } from '../totp.ts';
import { clientIp, html, HttpError, signedIn, str } from '../http.ts';
import { linkPage, message, setupPage, ssoConfirmPage, ssoConnectPage, ssoLinkConfirmPage } from '../pages.ts';
import { decidePairing, decidePairingForFamily, pendingPairing, pollPairing, POLL_INTERVAL_S, startPairing } from '../pairing.ts';
import { getFamily } from '../families.ts';
import { checkFamilyPassword, getFamilyLogin, checkFamilyToken, familyLoginBySso, pickable, pickPayload, ssoIsFamilyLogin, usernameIsFamilyLogin, type FamilyLogin } from '../familyLogins.ts';
import { permissionsFor } from '../roles.ts';
import { isSsoAdmin, ssoIdentity, ssoSettings, type SsoIdentity } from '../sso.ts';
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
  const sso = () => ssoSettings(db, config);
  const familyName = (l: FamilyLogin) => {
    const f = getFamily(db, l.familyId);
    return f ? `the ${f.name} family` : 'your family';
  };
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
    // two-step sign-in (totp.ts): the password was right, now the code (`otp`; `code` is the pairing code)
    const otp = str(req.body, 'otp', 20);
    if (!passTotp(db, config.secretKey, u.id, otp || undefined)) {
      if (otp) audit(db, { actorId: u.id, action: 'auth.login_failed', target: u.username, detail: { twoFactor: true }, ip: clientIp(req) });
      throw new HttpError(401, otp ? 'That code didn’t work. Use the newest one from your authenticator app, or a recovery code' : 'Enter the 6-digit code from your authenticator app', { twoFactor: true });
    }
    limits.login.clear(key);
    return u;
  }

  /** The Wavelength user for a tinyauth identity: linked, auto-created, or none. */
  function ssoUser(id: SsoIdentity, ip: string): User | null {
    const admin = isSsoAdmin(id, sso());
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
      // A named SSO admin who already has an admin profile under the same username: that's them, not a new "boss2".
      // (Only an admin profile, so this never gives anyone more than they had.)
      const same = admin ? getUserForLogin(db, id.username.replace(/[^a-z0-9._-]/g, '')) : undefined;
      if (same && same.role === 'admin' && !same.ssoSubject && !same.disabled) {
        audit(db, { action: 'user.sso_linked', target: same.username, detail: { ssoSubject: id.username, method: 'admin-name' }, ip });
        return updateUser(db, same.id, { ssoSubject: id.username }) ?? null;
      }
      // The very first person through SSO on an empty Hub can't be checked by anyone, so they must be a named admin.
      if (!(sso().autoCreate && countUsers(db) > 0) && !admin) return null;
      let username = id.username.replace(/[^a-z0-9._-]/g, '').slice(0, 28) || 'user';
      if (!USERNAME_RE.test(username)) username = `u${username}`.slice(0, 28);
      for (let n = 2; getUserForLogin(db, username); n++) username = `${username.replace(/\d+$/, '')}${n}`;
      const u = createUser(db, { username, displayName: id.name || id.username, role: admin ? 'admin' : 'member', ssoSubject: id.username });
      audit(db, { actorId: u.id, action: 'user.created_by_sso', target: u.username, detail: { role: u.role }, ip });
      return u;
    });
  }

  app.get('/api/health', async () => {
    const s = sso();
    return { ok: true, name: 'wavelength-hub', version: config.version, setupNeeded: countUsers(db) === 0, sso: s.enabled, ...(s.enabled && { ssoName: s.name }) };
  });

  /** A family sign-in's username and password (familyLogins.ts), checked like a profile's. */
  async function checkFamily(req: FastifyRequest, username: string, password: string): Promise<FamilyLogin> {
    const key = `${clientIp(req)}|${username.toLowerCase()}`;
    limits.login.hit(key);
    const l = await checkFamilyPassword(db, username, password, DUMMY_HASH);
    if (!l) {
      audit(db, { action: 'auth.login_failed', target: username.toLowerCase(), detail: { family: true }, ip: clientIp(req) });
      throw new HttpError(401, 'Wrong username or password');
    }
    limits.login.clear(key);
    return l;
  }

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
      return html(reply, message('Ready', 'Your admin account is ready. Sign in from the Wavelength app: Settings → Account.'));
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
    const username = str(req.body, 'username', 64);
    if (usernameIsFamilyLogin(db, username)) {
      const l = await checkFamily(req, username, str(req.body, 'password', 200));
      audit(db, { action: 'auth.family_login', target: username.toLowerCase(), detail: { method: 'password', platform: deviceInfo(req.body).platform }, ip: clientIp(req) });
      return pickPayload(db, config.secretKey, l);
    }
    const u = await checkPassword(req, username, str(req.body, 'password', 200));
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

  // ---- family sign-ins: pick a profile (familyLogins.ts) ----

  function familyFromToken(body: unknown): FamilyLogin {
    const l = checkFamilyToken(db, config.secretKey, (body as { familyToken?: unknown } | null)?.familyToken);
    if (!l) throw new HttpError(401, 'This family sign-in has ended. Sign in again');
    return l;
  }

  /** `{ familyToken }` → the family's profiles again (the picker on a device that didn't stay signed in). */
  app.post('/auth/family', async (req) => pickPayload(db, config.secretKey, familyFromToken(req.body)));

  /** `{ familyToken, userId, pin?, deviceName, platform }` → a session for the picked profile on this device. */
  app.post('/auth/pick', async (req) => {
    const l = familyFromToken(req.body);
    const userId = Number((req.body as { userId?: unknown }).userId);
    const p = pickable(db, l.familyId).find((x) => x.id === userId);
    if (!p) throw new HttpError(403, 'That profile can’t be picked with this sign-in');
    if (p.needsPin) {
      const key = `pick:${clientIp(req)}:${l.id}:${userId}`;
      limits.login.hit(key);
      const row = db.prepare('SELECT switch_pin FROM users WHERE id = ?').get(userId) as { switch_pin: string | null };
      const pin = (req.body as { pin?: unknown }).pin;
      if (!(typeof pin === 'string' && row.switch_pin && (await verifyPassword(pin, row.switch_pin)))) {
        audit(db, { action: 'auth.pick_failed', target: p.user.username, ip: clientIp(req) });
        throw new HttpError(401, pin ? 'That PIN isn’t right' : `Enter ${p.displayName}’s PIN`, { pin: true });
      }
      limits.login.clear(key);
    }
    const d = deviceInfo(req.body);
    const { device, token } = createDevice(db, p.user.id, d.name, d.platform);
    audit(db, { actorId: p.user.id, action: 'auth.login', target: d.name, detail: { method: 'family', familyLogin: l.id, platform: d.platform }, ip: clientIp(req) });
    return session(token, p.user, device);
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
    if (r.status === 'family') {
      const l = getFamilyLogin(db, r.familyLoginId);
      if (!l) return reply.code(403).send({ status: 'denied', error: 'That family sign-in was removed' });
      return pickPayload(db, config.secretKey, l);
    }
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
    return html(reply, linkPage({ code, device: p && { name: p.deviceName, platform: p.platform }, sso: sso().enabled, error: code && !p ? 'That code is wrong or has expired' : '' }));
  });

  app.post('/link', async (req, reply) => {
    const code = normalizeUserCode(str(req.body, 'code', 20));
    const show = (error: string, status: number) => html(reply, linkPage({ code, sso: sso().enabled, error }), status);
    let u: User;
    const username = str(req.body, 'username', 64);
    try {
      if (usernameIsFamilyLogin(db, username)) {
        const l = await checkFamily(req, username, str(req.body, 'password', 200));
        const p = pendingPairing(db, code);
        if (!p || !decidePairingForFamily(db, p.id, l.id, true)) return show('That code is wrong or has expired', 400);
        audit(db, { action: 'device.approved', target: p.deviceName, detail: { method: 'password', familyLogin: l.id }, ip: clientIp(req) });
        return html(reply, message('Signed in', `${p.deviceName} is signed in for your family. Pick who's listening on it. You can close this page.`));
      }
      u = await checkPassword(req, username, str(req.body, 'password', 200));
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

  function ssoIdentityOr401(req: FastifyRequest): SsoIdentity {
    const id = ssoIdentity(req, sso());
    if (!id) throw new HttpError(401, sso().enabled ? 'Single sign-on did not identify you. Check the proxy setup in docs/HUB.md.' : 'Single sign-on is not turned on for this Hub.');
    return id;
  }

  /** Who tinyauth signed in: a profile, or a family sign-in (familyLogins.ts) that picks one on the device. */
  function ssoWho(req: FastifyRequest): { user: User; family?: undefined } | { family: FamilyLogin; user?: undefined } {
    const id = ssoIdentityOr401(req);
    if (!getUserBySso(db, id.username)) {
      const family = familyLoginBySso(db, id.username);
      if (family) return { family };
    }
    return { user: ssoContextFor(req, id) };
  }

  function ssoContextFor(req: FastifyRequest, id: SsoIdentity) {
    const u = ssoUser(id, clientIp(req));
    if (!u) {
      if (getUserBySso(db, id.username)) throw new HttpError(403, 'Your Wavelength account is turned off. Ask your admin.');
      throw new NotLinked(id);
    }
    return u;
  }

  /** Link an SSO identity to an account, refusing if either side is already linked elsewhere. */
  function linkSso(u: User, id: SsoIdentity, ip: string, method: string) {
    tx(db, () => {
      if (ssoIsFamilyLogin(db, id.username)) throw new HttpError(409, `Single sign-on “${id.username}” is a family sign-in. An admin can change that in Settings → Families.`);
      const other = getUserBySso(db, id.username);
      if (other && other.id !== u.id) throw new HttpError(409, `Single sign-on “${id.username}” is already linked to another Wavelength account.`);
      const fresh = getUser(db, u.id)!;
      if (fresh.ssoSubject && fresh.ssoSubject !== id.username) throw new HttpError(409, `${fresh.displayName} is already linked to single sign-on “${fresh.ssoSubject}”. Unlink it in the app first.`);
      updateUser(db, u.id, { ssoSubject: id.username });
    });
    audit(db, { actorId: u.id, action: 'user.sso_linked', target: u.username, detail: { ssoSubject: id.username, method }, ip });
  }

  app.get('/auth/sso/link', async (req, reply) => {
    const code = normalizeUserCode(str(req.query, 'code', 20));
    try {
      const who = ssoWho(req);
      const p = pendingPairing(db, code);
      if (!p) return html(reply, linkPage({ code, sso: true, error: 'That code is wrong or has expired' }), 400);
      const device = { name: p.deviceName, platform: p.platform };
      if (who.family) return html(reply, ssoConfirmPage({ code, device, who: familyName(who.family), csrf: csrfFor(p.id, -who.family.id), family: true }));
      return html(reply, ssoConfirmPage({ code, device, who: who.user.displayName, csrf: csrfFor(p.id, who.user.id) }));
    } catch (e) {
      if (e instanceof NotLinked) return html(reply, ssoConnectPage({ who: e.id.username, code }));
      if (e instanceof HttpError) return html(reply, message('Sign-in problem', e.message, true), e.statusCode);
      throw e;
    }
  });

  app.post('/auth/sso/link', async (req, reply) => {
    try {
      const who = ssoWho(req);
      const p = pendingPairing(db, normalizeUserCode(str(req.body, 'code', 20)));
      if (!p) throw new HttpError(400, 'That code is wrong or has expired');
      const approve = str(req.body, 'decision', 10) === 'approve';
      if (who.family) {
        if (!safeEqual(str(req.body, 'csrf', 100), csrfFor(p.id, -who.family.id))) throw new HttpError(403, 'This page is out of date. Open the link again');
        decidePairingForFamily(db, p.id, who.family.id, approve);
        audit(db, { action: approve ? 'device.approved' : 'device.denied', target: p.deviceName, detail: { method: 'sso', familyLogin: who.family.id }, ip: clientIp(req) });
        return html(reply, approve ? message('Signed in', `${p.deviceName} is signed in for ${familyName(who.family)}. Pick who's listening on it. You can close this page.`) : message('Denied', `${p.deviceName} was not signed in.`));
      }
      const u = who.user;
      if (!safeEqual(str(req.body, 'csrf', 100), csrfFor(p.id, u.id))) throw new HttpError(403, 'This page is out of date. Open the link again');
      decidePairing(db, p.id, u.id, approve);
      audit(db, { actorId: u.id, action: approve ? 'device.approved' : 'device.denied', target: p.deviceName, detail: { method: 'sso' }, ip: clientIp(req) });
      return html(reply, approve ? message('Signed in', `${p.deviceName} is signed in as ${u.displayName}. You can close this page.`) : message('Denied', `${p.deviceName} was not signed in.`));
    } catch (e) {
      if (e instanceof NotLinked) return html(reply, ssoConnectPage({ who: e.id.username, code: normalizeUserCode(str(req.body, 'code', 20)) }), 403);
      if (e instanceof HttpError) return html(reply, message('Sign-in problem', e.message, true), e.statusCode);
      throw e;
    }
  });

  // ---- the web page signs in from tinyauth by itself ----

  /**
   * The app in a browser, already through tinyauth: a session (or the family's profile picker) straight from the
   * identity headers. JSON only, with a header a cross-site form can't send, so another site can't sign you in.
   */
  app.post('/auth/sso/session', async (req) => {
    if (req.headers['x-wavelength-web'] !== '1') throw new HttpError(400, 'Send X-Wavelength-Web: 1');
    const id = ssoIdentity(req, sso());
    if (!id) throw new HttpError(401, sso().enabled ? 'Single sign-on did not identify you' : 'Single sign-on is not turned on for this Hub', { sso: false });
    let who: ReturnType<typeof ssoWho>;
    try {
      who = ssoWho(req);
    } catch (e) {
      if (e instanceof NotLinked) throw new HttpError(403, `Single sign-on knows you as “${e.id.username}”, but that isn't linked to a Wavelength profile yet. Sign in with your Hub password once, or ask your admin.`, { notLinked: e.id.username });
      throw e;
    }
    const d = deviceInfo(req.body);
    if (who.family) {
      audit(db, { action: 'auth.family_login', target: who.family.ssoSubject ?? '', detail: { method: 'sso', platform: d.platform }, ip: clientIp(req) });
      return pickPayload(db, config.secretKey, who.family);
    }
    const { device, token } = createDevice(db, who.user.id, d.name, d.platform);
    audit(db, { actorId: who.user.id, action: 'auth.login', target: d.name, detail: { method: 'sso', platform: d.platform }, ip: clientIp(req) });
    return session(token, who.user, device);
  });

  /**
   * A plain browser visit through tinyauth (it sends people to its login first, then back here), then on to the
   * app, which signs in with POST /auth/sso/session. For proxies that only guard /auth/sso/.
   */
  app.get('/auth/sso/web', async (req, reply) => {
    try {
      ssoWho(req);
      return reply.redirect('/?sso=1');
    } catch (e) {
      if (e instanceof NotLinked) return html(reply, ssoConnectPage({ who: e.id.username, code: '', web: true }));
      if (e instanceof HttpError) return html(reply, message('Sign-in problem', e.message, true), e.statusCode);
      throw e;
    }
  });

  // ---- linking single sign-on to an existing (password) account ----

  /** From the app's Account screen: a one-time link to open in a browser where tinyauth signs you in. */
  app.post('/api/me/sso-link', async (req) => {
    const { user } = signedIn(req);
    if (!sso().enabled) throw new HttpError(409, 'Single sign-on is not turned on for this Hub');
    db.prepare('DELETE FROM sso_links WHERE expires_at < ? OR user_id = ?').run(Date.now(), user.id);
    const link = newToken('wll_');
    db.prepare('INSERT INTO sso_links (code_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(link), user.id, Date.now() + SSO_LINK_TTL_MS);
    return { url: `${config.publicUrl}/auth/sso/connect?link=${encodeURIComponent(link)}`, expiresIn: SSO_LINK_TTL_MS / 1000 };
  });

  /** Unlink single sign-on. Only for accounts that can still sign in with a password afterwards. */
  app.delete('/api/me/sso', async (req) => {
    const { user } = signedIn(req);
    if (!user.ssoSubject) return { user };
    if (!user.hasPassword) throw new HttpError(400, 'Your account has no Hub password, so unlinking single sign-on would lock you out. Ask your admin to set a password first');
    const u = updateUser(db, user.id, { ssoSubject: null });
    audit(db, { actorId: user.id, action: 'user.sso_unlinked', target: user.username, detail: { ssoSubject: user.ssoSubject }, ip: clientIp(req) });
    return { user: u };
  });

  const linkOwner = (link: string) =>
    db.prepare('SELECT user_id FROM sso_links WHERE code_hash = ? AND expires_at > ?').get(sha256(link), Date.now()) as { user_id: number } | undefined;
  const linkCsrf = (link: string, subject: string) => hmac(config.secretKey, `sso-connect:${sha256(link)}:${subject}`);

  app.get('/auth/sso/connect', async (req, reply) => {
    try {
      const id = ssoIdentityOr401(req);
      const link = str(req.query, 'link', 100);
      const owner = link && linkOwner(link);
      if (!owner) throw new HttpError(400, 'This link has expired or was already used. Start again from the app: Settings → Account.');
      const u = getUser(db, owner.user_id)!;
      return html(reply, ssoLinkConfirmPage({ who: id.username, account: u.displayName, link, csrf: linkCsrf(link, id.username) }));
    } catch (e) {
      if (e instanceof HttpError) return html(reply, message('Link problem', e.message, true), e.statusCode);
      throw e;
    }
  });

  /**
   * Two ways in: `link` + `csrf` (opened from the app while signed in), or `username` + `password`
   * (tinyauth knows you but no account is linked yet). Either way the identity comes from tinyauth.
   */
  app.post('/auth/sso/connect', async (req, reply) => {
    const code = normalizeUserCode(str(req.body, 'code', 20));
    let id: SsoIdentity | undefined;
    try {
      id = ssoIdentityOr401(req);
      const ip = clientIp(req);
      const link = str(req.body, 'link', 100);
      let u: User;
      if (link) {
        if (!safeEqual(str(req.body, 'csrf', 100), linkCsrf(link, id.username))) throw new HttpError(403, 'This page is out of date. Open the link again');
        if (str(req.body, 'decision', 10) !== 'link') return html(reply, message('Not linked', 'Nothing was changed.'));
        const owner = tx(db, () => {
          const o = linkOwner(link);
          db.prepare('DELETE FROM sso_links WHERE code_hash = ?').run(sha256(link));
          return o;
        });
        if (!owner) throw new HttpError(400, 'This link has expired or was already used. Start again from the app: Settings → Account.');
        u = getUser(db, owner.user_id)!;
        if (u.disabled) throw new HttpError(403, 'Your Wavelength account is turned off. Ask your admin.');
        linkSso(u, id, ip, 'app');
      } else {
        u = await checkPassword(req, str(req.body, 'username', 64), str(req.body, 'password', 200));
        linkSso(u, id, ip, 'password');
      }
      // carry on signing in the device that sent them here, if any
      const p = code ? pendingPairing(db, code) : undefined;
      if (p) return html(reply, ssoConfirmPage({ code, device: { name: p.deviceName, platform: p.platform }, who: u.displayName, csrf: csrfFor(p.id, u.id) }));
      if (str(req.body, 'web', 5) === '1') return reply.redirect('/?sso=1');
      return html(reply, message('Linked', `Single sign-on “${id.username}” is now linked to ${u.displayName}. You can close this page.`));
    } catch (e) {
      if (e instanceof HttpError && id && !str(req.body, 'link', 100) && e.statusCode === 401) return html(reply, ssoConnectPage({ who: id.username, code, error: e.message }), 401);
      if (e instanceof HttpError) return html(reply, message('Link problem', e.message, true), e.statusCode);
      throw e;
    }
  });
}

const SSO_LINK_TTL_MS = 10 * 60_000;

/** tinyauth identified the person, but no Wavelength account is linked to that identity. */
class NotLinked extends Error {
  id: SsoIdentity;
  constructor(id: SsoIdentity) {
    super('not linked');
    this.id = id;
  }
}
