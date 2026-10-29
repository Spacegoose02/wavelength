import type { Db } from './db.ts';
import type { Role } from './roles.ts';

export interface User {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  ssoSubject: string | null;
  hasPassword: boolean;
  autodownload: boolean;
  disabled: boolean;
  createdAt: number;
}

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  role: Role;
  password_hash: string | null;
  sso_subject: string | null;
  autodownload: number;
  disabled: number;
  created_at: number;
}

export const toUser = (r: UserRow): User => ({
  id: r.id,
  username: r.username,
  displayName: r.display_name,
  role: r.role,
  ssoSubject: r.sso_subject,
  hasPassword: !!r.password_hash,
  autodownload: !!r.autodownload,
  disabled: !!r.disabled,
  createdAt: r.created_at,
});

export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{0,31}$/;

export function getUser(db: Db, id: number): User | undefined {
  const r = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  return r && toUser(r);
}

/** The row with its password hash, for login only. */
export function getUserForLogin(db: Db, username: string): (User & { passwordHash: string | null }) | undefined {
  const r = db.prepare('SELECT * FROM users WHERE username = ?').get(username.toLowerCase()) as UserRow | undefined;
  return r && { ...toUser(r), passwordHash: r.password_hash };
}

export function getUserBySso(db: Db, subject: string): User | undefined {
  const r = db.prepare('SELECT * FROM users WHERE sso_subject = ?').get(subject.toLowerCase()) as UserRow | undefined;
  return r && toUser(r);
}

export function listUsers(db: Db): User[] {
  return (db.prepare('SELECT * FROM users ORDER BY username').all() as unknown as UserRow[]).map(toUser);
}

export const countUsers = (db: Db) => (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;

export const countActiveAdmins = (db: Db) =>
  (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0").get() as { n: number }).n;

export function createUser(
  db: Db,
  u: { username: string; displayName?: string; role: Role; passwordHash?: string | null; ssoSubject?: string | null; autodownload?: boolean },
): User {
  const now = Date.now();
  const username = u.username.toLowerCase();
  const res = db
    .prepare(
      `INSERT INTO users (username, display_name, role, password_hash, sso_subject, autodownload, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(username, u.displayName || username, u.role, u.passwordHash ?? null, u.ssoSubject?.toLowerCase() ?? null, u.autodownload && u.role !== 'kid' ? 1 : 0, now, now);
  return getUser(db, Number(res.lastInsertRowid))!;
}

export interface UserPatch {
  displayName?: string;
  role?: Role;
  passwordHash?: string | null;
  ssoSubject?: string | null;
  autodownload?: boolean;
  disabled?: boolean;
}

export function updateUser(db: Db, id: number, p: UserPatch): User | undefined {
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  const add = (col: string, v: string | number | null) => (sets.push(`${col} = ?`), vals.push(v));
  if (p.displayName !== undefined) add('display_name', p.displayName);
  if (p.role !== undefined) add('role', p.role);
  if (p.passwordHash !== undefined) add('password_hash', p.passwordHash);
  if (p.ssoSubject !== undefined) add('sso_subject', p.ssoSubject?.toLowerCase() || null);
  if (p.autodownload !== undefined) add('autodownload', p.autodownload ? 1 : 0);
  if (p.disabled !== undefined) add('disabled', p.disabled ? 1 : 0);
  if (sets.length) {
    add('updated_at', Date.now());
    db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  }
  // Kids can never hold the Autodownload switch, whatever order the fields were changed in.
  db.prepare("UPDATE users SET autodownload = 0 WHERE id = ? AND role = 'kid'").run(id);
  return getUser(db, id);
}

export function deleteUser(db: Db, id: number) {
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}
