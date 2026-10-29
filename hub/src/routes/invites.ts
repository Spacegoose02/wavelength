import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import { hashPassword, sha256 } from '../crypto.ts';
import { tx } from '../db.ts';
import { createDevice } from '../devices.ts';
import { clientIp, html, HttpError, need, str } from '../http.ts';
import { invitePage, message } from '../pages.ts';
import { isRole, type Role } from '../roles.ts';
import { createUser, getUserForLogin, USERNAME_RE, type User } from '../users.ts';
import { MIN_PASSWORD, session } from './auth.ts';

/**
 * Invite links (docs/USERS-AND-ADMIN.md Phase 6): an admin makes a link for a role, sends it however they
 * like, and the person opens it and picks their own username and password. Each link works once and
 * expires. Only a hash of the code is stored.
 */

const DAY = 24 * 3600_000;

interface InviteRow {
  id: number;
  role: Role;
  display_name: string;
  autodownload: number;
  created_by: number | null;
  created_at: number;
  expires_at: number;
  used_at: number | null;
  used_by: number | null;
}

export function inviteRoutes(app: FastifyInstance, { db, config, limits }: Ctx) {
  const live = (code: string) =>
    code
      ? (db.prepare('SELECT * FROM invites WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?').get(sha256(code), Date.now()) as InviteRow | undefined)
      : undefined;
  const link = (code: string) => `${config.publicUrl}/invite/${code}`;

  /** `{ role, displayName?, autodownload?, days? }` → the link, shown once. */
  app.post('/api/admin/invites', async (req) => {
    const { user } = need(req, 'users.manage');
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (!isRole(b.role)) throw new HttpError(400, 'Role must be admin, member or kid');
    const days = Math.min(Math.max(Math.round(Number(b.days) || 7), 1), 30);
    const code = randomBytes(18).toString('base64url');
    const now = Date.now();
    const auto = b.autodownload === true && b.role === 'member' ? 1 : 0;
    const res = db
      .prepare('INSERT INTO invites (code_hash, role, display_name, autodownload, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(sha256(code), b.role, str(b, 'displayName', 60), auto, user.id, now, now + days * DAY);
    audit(db, { actorId: user.id, action: 'invite.created', target: b.role, detail: { days }, ip: clientIp(req) });
    return { id: Number(res.lastInsertRowid), url: link(code), code, expiresAt: now + days * DAY };
  });

  app.get('/api/admin/invites', async (req) => {
    need(req, 'users.manage');
    const rows = db
      .prepare(`SELECT invites.*, a.username AS by_name, u.username AS used_name FROM invites
        LEFT JOIN users a ON a.id = invites.created_by LEFT JOIN users u ON u.id = invites.used_by
        WHERE invites.used_at IS NULL AND invites.expires_at > ? OR invites.used_at > ? ORDER BY invites.created_at DESC LIMIT 100`)
      .all(Date.now(), Date.now() - 30 * DAY) as unknown as (InviteRow & { by_name: string | null; used_name: string | null })[];
    return {
      invites: rows.map((r) => ({
        id: r.id,
        role: r.role,
        displayName: r.display_name,
        autodownload: !!r.autodownload,
        createdBy: r.by_name,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        usedAt: r.used_at,
        usedBy: r.used_name,
      })),
    };
  });

  app.delete<{ Params: { id: string } }>('/api/admin/invites/:id', async (req) => {
    const { user } = need(req, 'users.manage');
    const res = db.prepare('DELETE FROM invites WHERE id = ? AND used_at IS NULL').run(Number(req.params.id));
    if (!res.changes) throw new HttpError(404, 'No unused invite with that id');
    audit(db, { actorId: user.id, action: 'invite.cancelled', target: req.params.id, ip: clientIp(req) });
    return { ok: true };
  });

  /** Make the account and use the invite up, in one go so a link can't be used twice. */
  async function accept(code: string, body: unknown, ip: string): Promise<User> {
    limits.login.hit(`${ip}|invite`);
    const username = str(body, 'username', 32).toLowerCase();
    const password = str(body, 'password', 200);
    if (!live(code)) throw new HttpError(410, 'This invite has been used or has expired. Ask for a new one');
    if (!USERNAME_RE.test(username)) throw new HttpError(400, 'Usernames are 1–32 letters, numbers, dots, dashes or underscores');
    if (password.length < MIN_PASSWORD) throw new HttpError(400, `Passwords need at least ${MIN_PASSWORD} characters`);
    const passwordHash = await hashPassword(password);
    return tx(db, () => {
      const inv = live(code);
      if (!inv) throw new HttpError(410, 'This invite has been used or has expired. Ask for a new one');
      if (getUserForLogin(db, username)) throw new HttpError(409, 'That username is taken. Pick another');
      const u = createUser(db, { username, displayName: str(body, 'displayName', 60) || inv.display_name, role: inv.role, passwordHash, autodownload: !!inv.autodownload });
      db.prepare('UPDATE invites SET used_at = ?, used_by = ? WHERE id = ?').run(Date.now(), u.id, inv.id);
      audit(db, { actorId: u.id, action: 'invite.accepted', target: u.username, detail: { role: u.role, invite: inv.id, by: inv.created_by }, ip });
      return u;
    });
  }

  const codeOf = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);

  app.get<{ Params: { code: string } }>('/invite/:code', async (req, reply) => {
    const code = codeOf(req.params.code);
    const inv = live(code);
    if (!inv) return html(reply, message('Invite', 'This invite has been used or has expired. Ask for a new one.', true), 410);
    return html(reply, invitePage({ code, role: inv.role, displayName: inv.display_name }));
  });

  app.post<{ Params: { code: string } }>('/invite/:code', async (req, reply) => {
    const code = codeOf(req.params.code);
    try {
      const u = await accept(code, req.body, clientIp(req));
      const web = config.webDir ? ` or open ${config.publicUrl} in a browser` : '';
      return html(reply, message('Welcome', `Your account ${u.username} is ready. Sign in from the Wavelength app (Settings → Account, Hub ${config.publicUrl})${web}.`));
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      const inv = live(code);
      if (!inv) return html(reply, message('Invite', e.message, true), e.statusCode);
      return html(reply, invitePage({ code, role: inv.role, displayName: str(req.body, 'displayName', 60) || inv.display_name, username: str(req.body, 'username', 32), error: e.message }), e.statusCode);
    }
  });

  /** For the app's sign-in screen: accept and get this device signed in straight away. */
  app.post('/auth/invite', async (req) => {
    const code = codeOf(str(req.body, 'code', 200).replace(/^.*\/invite\//, ''));
    const u = await accept(code, req.body, clientIp(req));
    const { device, token } = createDevice(db, u.id, str(req.body, 'deviceName', 60) || 'Wavelength', str(req.body, 'platform', 30) || 'unknown');
    return session(token, u, device);
  });
}
