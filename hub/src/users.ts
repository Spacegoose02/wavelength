import { HttpError } from './http.ts';
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
  /** The family they're in (families.ts), or null. */
  familyId: number | null;
  /** Manages their family (what the admin lets that family do). */
  familyManager: boolean;
  /** Has a PIN their family can switch to them with (POST /api/me/switch). */
  hasSwitchPin: boolean;
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
  family_id: number | null;
  family_manager: number;
  switch_pin: string | null;
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
  familyId: r.family_id ?? null,
  familyManager: !!r.family_manager && r.family_id !== null,
  hasSwitchPin: !!r.switch_pin,
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
  // a family sign-in (familyLogins.ts) owns this name: signing in with it must stay unambiguous
  if (db.prepare('SELECT 1 FROM family_logins WHERE username = ? OR sso_subject = ?').get(username, u.ssoSubject?.toLowerCase() ?? '\u0000')) {
    throw new HttpError(409, 'That username is taken by a family sign-in');
  }
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

/**
 * Merge two profiles (Settings → Users → Merge): everything `fromId` owns moves to `intoId`, then `fromId` is
 * deleted. Every table that points at users(id) is followed (found from the schema, so new tables are covered);
 * where both have a row that can only exist once (a setting, a rating of the same song), the kept profile's wins.
 * Sign-ins move too: `fromId`'s tinyauth name, password and switching PIN go to `intoId` where it has none.
 * The kept profile keeps its own username, name and role.
 */
export function mergeUsers(db: Db, fromId: number, intoId: number): User {
  const from = db.prepare('SELECT * FROM users WHERE id = ?').get(fromId) as UserRow | undefined;
  const into = db.prepare('SELECT * FROM users WHERE id = ?').get(intoId) as UserRow | undefined;
  if (!from || !into) throw new HttpError(404, 'No such user');
  if (fromId === intoId) throw new HttpError(400, 'Pick two different profiles');
  if (from.sso_subject && into.sso_subject && from.sso_subject !== into.sso_subject) {
    throw new HttpError(409, `Both have single sign-on (“${from.sso_subject}” and “${into.sso_subject}”). Clear one first.`);
  }
  const q = (name: string) => `"${name.replace(/"/g, '""')}"`;
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((t) => t.name);
  for (const t of tables) {
    if (t === 'users') continue;
    let fks: { table: string; from: string }[] = [];
    try {
      fks = db.prepare(`PRAGMA foreign_key_list(${q(t)})`).all() as { table: string; from: string }[];
    } catch {
      continue; // a virtual table
    }
    for (const fk of fks.filter((f) => f.table === 'users')) {
      db.prepare(`UPDATE OR IGNORE ${q(t)} SET ${q(fk.from)} = ? WHERE ${q(fk.from)} = ?`).run(intoId, fromId);
    }
  }
  // a kid merged into their own parent would be their own guardian
  db.prepare('DELETE FROM guardians WHERE kid_id = guardian_id').run();
  db.prepare('UPDATE users SET sso_subject = NULL WHERE id = ?').run(fromId);
  db.prepare(
    `UPDATE users SET sso_subject = COALESCE(sso_subject, ?), password_hash = COALESCE(password_hash, ?), switch_pin = COALESCE(switch_pin, ?),
       family_id = COALESCE(family_id, ?), updated_at = ? WHERE id = ?`,
  ).run(from.sso_subject, from.password_hash, from.switch_pin, from.family_id, Date.now(), intoId);
  db.prepare('DELETE FROM users WHERE id = ?').run(fromId);
  return getUser(db, intoId)!;
}
