import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit, listAudit } from '../audit.ts';
import { hashPassword } from '../crypto.ts';
import { tx } from '../db.ts';
import { getDevice, listDevices, revokeDevice, revokeUserDevices } from '../devices.ts';
import { clientIp, HttpError, need, str } from '../http.ts';
import { isRole, permissionsFor } from '../roles.ts';
import { countActiveAdmins, createUser, deleteUser, getUser, getUserBySso, getUserForLogin, listUsers, updateUser, USERNAME_RE, type User, type UserPatch } from '../users.ts';
import { MIN_PASSWORD } from './auth.ts';

/**
 * Admin-only routes. Every handler starts with `need(req, …)`, which answers 401/403 before anything
 * happens; test/admin.test.ts checks that members and kids are refused on each of them.
 */
export function adminRoutes(app: FastifyInstance, { db }: Ctx) {
  const withDevices = (u: User) => {
    const devices = listDevices(db, u.id);
    return { ...u, permissions: permissionsFor(u), devices: devices.length, lastSeenAt: devices[0]?.lastSeenAt ?? null };
  };

  /** Refuse a change that would leave the Hub with no active admin. */
  function keepAnAdmin(target: User, after: { role?: string; disabled?: boolean; deleted?: boolean }) {
    const losesAdmin = target.role === 'admin' && !target.disabled && (after.deleted || after.disabled === true || (after.role !== undefined && after.role !== 'admin'));
    if (losesAdmin && countActiveAdmins(db) <= 1) throw new HttpError(409, 'This is the last admin. Make someone else an admin first');
  }

  async function readPatch(body: unknown, creating: boolean): Promise<UserPatch> {
    const b = (body ?? {}) as Record<string, unknown>;
    const p: UserPatch = {};
    if (b.displayName !== undefined) p.displayName = str(b, 'displayName', 60);
    if (b.role !== undefined || creating) {
      if (!isRole(b.role)) throw new HttpError(400, 'Role must be admin, member or kid');
      p.role = b.role;
    }
    if (b.password !== undefined && b.password !== null) {
      const pw = str(b, 'password', 200);
      if (pw.length < MIN_PASSWORD) throw new HttpError(400, `Passwords need at least ${MIN_PASSWORD} characters`);
      p.passwordHash = await hashPassword(pw);
    }
    if (b.password === null) p.passwordHash = null;
    if (b.ssoSubject !== undefined) p.ssoSubject = b.ssoSubject === null ? null : str(b, 'ssoSubject', 100).toLowerCase() || null;
    if (b.autodownload !== undefined) p.autodownload = b.autodownload === true;
    if (b.disabled !== undefined) p.disabled = b.disabled === true;
    return p;
  }

  app.get('/api/admin/users', async (req) => {
    need(req, 'users.manage');
    return { users: listUsers(db).map(withDevices) };
  });

  app.post('/api/admin/users', async (req) => {
    const { user: actor } = need(req, 'users.manage');
    const username = str(req.body, 'username', 32).toLowerCase();
    if (!USERNAME_RE.test(username)) throw new HttpError(400, 'Usernames are 1–32 letters, numbers, dots, dashes or underscores');
    const p = await readPatch(req.body, true);
    if (!p.passwordHash && !p.ssoSubject) throw new HttpError(400, 'Give the user a password, an SSO username, or both');
    const u = tx(db, () => {
      if (getUserForLogin(db, username)) throw new HttpError(409, 'That username is taken');
      if (p.ssoSubject && getUserBySso(db, p.ssoSubject)) throw new HttpError(409, 'That SSO username is already linked to someone');
      return createUser(db, { username, ...p, role: p.role! });
    });
    audit(db, { actorId: actor.id, action: 'user.created', target: u.username, detail: { role: u.role, sso: !!u.ssoSubject }, ip: clientIp(req) });
    return { user: withDevices(u) };
  });

  app.patch<{ Params: { id: string } }>('/api/admin/users/:id', async (req) => {
    const { user: actor } = need(req, 'users.manage');
    const target = getUser(db, Number(req.params.id));
    if (!target) throw new HttpError(404, 'No such user');
    const p = await readPatch(req.body, false);
    const u = tx(db, () => {
      keepAnAdmin(target, p);
      if (p.ssoSubject) {
        const other = getUserBySso(db, p.ssoSubject);
        if (other && other.id !== target.id) throw new HttpError(409, 'That SSO username is already linked to someone');
      }
      if (p.passwordHash === null && !(p.ssoSubject ?? target.ssoSubject)) throw new HttpError(400, 'A user without SSO needs a password');
      const out = updateUser(db, target.id, p)!;
      if (p.disabled) revokeUserDevices(db, target.id);
      return out;
    });
    // Never log the password itself, only that it changed.
    const { passwordHash, ...changed } = p;
    audit(db, { actorId: actor.id, action: 'user.updated', target: u.username, detail: { ...changed, ...(passwordHash !== undefined && { password: passwordHash ? 'changed' : 'removed' }) }, ip: clientIp(req) });
    return { user: withDevices(u) };
  });

  app.delete<{ Params: { id: string } }>('/api/admin/users/:id', async (req) => {
    const { user: actor } = need(req, 'users.manage');
    const target = getUser(db, Number(req.params.id));
    if (!target) throw new HttpError(404, 'No such user');
    tx(db, () => {
      keepAnAdmin(target, { deleted: true });
      deleteUser(db, target.id);
    });
    audit(db, { actorId: actor.id, action: 'user.deleted', target: target.username, ip: clientIp(req) });
    return { ok: true };
  });

  app.get('/api/admin/devices', async (req) => {
    need(req, 'users.manage');
    const users = new Map(listUsers(db).map((u) => [u.id, u]));
    return { devices: listDevices(db).map((d) => ({ ...d, username: users.get(d.userId)?.username, displayName: users.get(d.userId)?.displayName })) };
  });

  app.delete<{ Params: { id: string } }>('/api/admin/devices/:id', async (req) => {
    const { user: actor } = need(req, 'users.manage');
    const d = getDevice(db, Number(req.params.id));
    if (!d) throw new HttpError(404, 'No such device');
    revokeDevice(db, d.id);
    audit(db, { actorId: actor.id, action: 'device.revoked', target: d.name, detail: { userId: d.userId }, ip: clientIp(req) });
    return { ok: true };
  });

  app.get('/api/admin/audit', async (req) => {
    need(req, 'audit.view');
    const q = (req.query ?? {}) as Record<string, string>;
    const limit = Math.min(Math.max(Number(q.limit) || 100, 1), 500);
    return { entries: listAudit(db, limit, q.before ? Number(q.before) : undefined) };
  });
}
