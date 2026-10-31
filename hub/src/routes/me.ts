import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import { hashPassword, verifyPassword } from '../crypto.ts';
import { getDevice, listDevices, revokeDevice } from '../devices.ts';
import { clientIp, HttpError, signedIn, str } from '../http.ts';
import { getPrefs, putPrefs } from '../prefs.ts';
import { getUserForLogin, updateUser } from '../users.ts';
import { beginTotp, disableTotp, enableTotp, passTotp, recoveryLeft, totpEnabled } from '../totp.ts';
import { MIN_PASSWORD } from './auth.ts';

/** The signed-in person's own account, devices and synced preferences. */
export function meRoutes(app: FastifyInstance, { db, limits, config }: Ctx) {
  app.get('/api/me', async (req) => {
    const { user, device, permissions } = signedIn(req);
    return { user, device, permissions, twoFactor: totpEnabled(db, user.id) };
  });

  app.patch('/api/me', async (req) => {
    const { user } = signedIn(req);
    const displayName = str(req.body, 'displayName', 60);
    if (!displayName) throw new HttpError(400, 'Display name is required');
    return { user: updateUser(db, user.id, { displayName }) };
  });

  /** Change your own Hub password. Needs the current one, so a stolen device token can't take the account over. */
  app.put('/api/me/password', async (req) => {
    const { user } = signedIn(req);
    limits.login.hit(`${clientIp(req)}|${user.username}`);
    const row = getUserForLogin(db, user.username)!;
    if (!row.passwordHash) throw new HttpError(400, 'Your account signs in with single sign-on. Ask your admin to set a Hub password');
    if (!(await verifyPassword(str(req.body, 'currentPassword', 200), row.passwordHash))) throw new HttpError(401, 'Current password is wrong');
    const next = str(req.body, 'newPassword', 200);
    if (next.length < MIN_PASSWORD) throw new HttpError(400, `Passwords need at least ${MIN_PASSWORD} characters`);
    updateUser(db, user.id, { passwordHash: await hashPassword(next) });
    audit(db, { actorId: user.id, action: 'user.password_changed', target: user.username, ip: clientIp(req) });
    return { ok: true };
  });

  // ---- two-step sign-in (totp.ts) ----

  /** The password again, so a stolen device token can't turn two-step sign-in on or off. */
  const recheck = async (req: Parameters<typeof signedIn>[0]) => {
    const { user } = signedIn(req);
    limits.login.hit(`${clientIp(req)}|${user.username}`);
    const row = getUserForLogin(db, user.username)!;
    if (!row.passwordHash) throw new HttpError(400, 'Your account signs in with single sign-on, which has its own two-step sign-in');
    if (!(await verifyPassword(str(req.body, 'password', 200), row.passwordHash))) throw new HttpError(401, 'Password is wrong');
    return user;
  };

  app.get('/api/me/2fa', async (req) => {
    const { user } = signedIn(req);
    return { enabled: totpEnabled(db, user.id), recoveryLeft: recoveryLeft(db, user.id) };
  });

  /** Step 1: `{ password }` → a new secret and its otpauth:// link (for a QR code). Not in force until step 2. */
  app.post('/api/me/2fa/setup', async (req) => {
    const user = await recheck(req);
    if (totpEnabled(db, user.id)) throw new HttpError(409, 'Two-step sign-in is already on. Turn it off first to move it to a new app');
    return beginTotp(db, config.secretKey, user.id, user.username);
  });

  /** Step 2: `{ code }` from the app → on, with ten recovery codes shown this once. */
  app.post('/api/me/2fa/enable', async (req) => {
    const { user } = signedIn(req);
    limits.login.hit(`${clientIp(req)}|${user.username}`);
    const codes = enableTotp(db, config.secretKey, user.id, str(req.body, 'code', 20));
    if (!codes) throw new HttpError(400, 'That code didn’t match. Check the time on your phone, and use the newest code');
    audit(db, { actorId: user.id, action: 'user.2fa_on', target: user.username, ip: clientIp(req) });
    return { recoveryCodes: codes };
  });

  /** `{ password, otp }` (a current code or a recovery code) → off. */
  app.delete('/api/me/2fa', async (req) => {
    const user = await recheck(req);
    if (!passTotp(db, config.secretKey, user.id, str(req.body, 'otp', 20) || undefined)) throw new HttpError(401, 'That code didn’t work', { twoFactor: true });
    disableTotp(db, user.id);
    audit(db, { actorId: user.id, action: 'user.2fa_off', target: user.username, ip: clientIp(req) });
    return { ok: true };
  });

  app.get('/api/me/devices', async (req) => {
    const { user, device } = signedIn(req);
    return { devices: listDevices(db, user.id).map((d) => ({ ...d, current: d.id === device.id })) };
  });

  app.delete<{ Params: { id: string } }>('/api/me/devices/:id', async (req) => {
    const { user } = signedIn(req);
    const d = getDevice(db, Number(req.params.id));
    if (!d || d.userId !== user.id) throw new HttpError(404, 'No such device');
    revokeDevice(db, d.id);
    audit(db, { actorId: user.id, action: 'device.revoked', target: d.name, ip: clientIp(req) });
    return { ok: true };
  });

  app.get('/api/me/prefs', async (req) => ({ prefs: getPrefs(db, signedIn(req).user.id) }));

  app.put('/api/me/prefs', async (req) => {
    const { user } = signedIn(req);
    const result = putPrefs(db, user.id, (req.body as { changes?: unknown } | null)?.changes);
    return { ...result, prefs: getPrefs(db, user.id) };
  });
}
