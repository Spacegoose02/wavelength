import { hmac, safeEqual, verifyPassword } from './crypto.ts';
import type { Db } from './db.ts';
import { familyMembers, getFamily } from './families.ts';
import { HttpError } from './http.ts';
import { getUserBySso, getUserForLogin, type User } from './users.ts';

/**
 * Family sign-ins (docs/HUB.md "Family sign-ins"): a username and password and/or a tinyauth identity that
 * belongs to a whole family instead of one profile. Signing in with one gives the device a **family token**
 * and the family's profiles to pick from, Netflix-style; picking one (with that profile's switching PIN when
 * it has one) gives the device that profile's own session. Admin profiles can only be picked with a PIN, so a
 * shared family password never opens an admin profile by itself.
 *
 * A sign-in that belongs to one profile (users.password_hash / users.sso_subject) skips the picker, as before.
 *
 * The family token is signed, not stored: `wlf_<id>.<epoch>.<mac>`. Changing the sign-in's password or
 * tinyauth name, or "Sign out everywhere", bumps `epoch`, which ends every token handed out before.
 */

export interface FamilyLogin {
  id: number;
  familyId: number;
  username: string | null;
  ssoSubject: string | null;
  hasPassword: boolean;
  createdAt: number;
}

interface Row {
  id: number;
  family_id: number;
  username: string | null;
  password_hash: string | null;
  sso_subject: string | null;
  epoch: number;
  created_at: number;
}

const toLogin = (r: Row): FamilyLogin => ({
  id: r.id,
  familyId: r.family_id,
  username: r.username,
  ssoSubject: r.sso_subject,
  hasPassword: !!r.password_hash,
  createdAt: r.created_at,
});

const row = (db: Db, where: string, v: string | number) => db.prepare(`SELECT * FROM family_logins WHERE ${where} = ?`).get(v) as Row | undefined;

export const listFamilyLogins = (db: Db): FamilyLogin[] => (db.prepare('SELECT * FROM family_logins ORDER BY family_id, id').all() as unknown as Row[]).map(toLogin);
export const getFamilyLogin = (db: Db, id: number) => {
  const r = row(db, 'id', id);
  return r && toLogin(r);
};
export const familyLoginBySso = (db: Db, subject: string) => {
  const r = row(db, 'sso_subject', subject.toLowerCase());
  return r && toLogin(r);
};

/** Is this username or tinyauth name free across profiles and family sign-ins? (`exceptLogin`: the one being edited) */
export function checkFree(db: Db, f: { username?: string | null; ssoSubject?: string | null }, exceptLogin?: number) {
  if (f.username) {
    const other = row(db, 'username', f.username);
    if (getUserForLogin(db, f.username) || (other && other.id !== exceptLogin)) throw new HttpError(409, 'That username is taken');
  }
  if (f.ssoSubject) {
    const other = row(db, 'sso_subject', f.ssoSubject);
    if (getUserBySso(db, f.ssoSubject) || (other && other.id !== exceptLogin)) throw new HttpError(409, 'That SSO username is already linked to someone');
  }
}

/** Is a username (users.ts) taken by a family sign-in? Profiles can't take it then. */
export const usernameIsFamilyLogin = (db: Db, username: string) => !!row(db, 'username', username.toLowerCase());
export const ssoIsFamilyLogin = (db: Db, subject: string) => !!row(db, 'sso_subject', subject.toLowerCase());

export function createFamilyLogin(db: Db, f: { familyId: number; username: string | null; passwordHash: string | null; ssoSubject: string | null }): FamilyLogin {
  if (!getFamily(db, f.familyId)) throw new HttpError(404, 'No such family');
  if (!f.username && !f.ssoSubject) throw new HttpError(400, 'Give the family sign-in a username and password, an SSO username, or both');
  if (f.username && !f.passwordHash) throw new HttpError(400, 'A family username needs a password');
  checkFree(db, f);
  const res = db
    .prepare('INSERT INTO family_logins (family_id, username, password_hash, sso_subject, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(f.familyId, f.username, f.passwordHash, f.ssoSubject, Date.now());
  return getFamilyLogin(db, Number(res.lastInsertRowid))!;
}

export function updateFamilyLogin(db: Db, id: number, p: { username?: string | null; passwordHash?: string | null; ssoSubject?: string | null; signOutEverywhere?: boolean }): FamilyLogin {
  const cur = row(db, 'id', id);
  if (!cur) throw new HttpError(404, 'No such family sign-in');
  const next = {
    username: p.username !== undefined ? p.username : cur.username,
    password_hash: p.passwordHash !== undefined ? p.passwordHash : cur.password_hash,
    sso_subject: p.ssoSubject !== undefined ? p.ssoSubject : cur.sso_subject,
  };
  if (!next.username && !next.sso_subject) throw new HttpError(400, 'A family sign-in needs a username and password, an SSO username, or both');
  if (next.username && !next.password_hash) throw new HttpError(400, 'A family username needs a password');
  checkFree(db, { username: p.username, ssoSubject: p.ssoSubject }, id);
  // a new password or identity ends the old devices' pickers, as a password change would
  const bump = p.signOutEverywhere || p.passwordHash !== undefined || (p.ssoSubject !== undefined && p.ssoSubject !== cur.sso_subject) ? 1 : 0;
  db.prepare('UPDATE family_logins SET username = ?, password_hash = ?, sso_subject = ?, epoch = epoch + ? WHERE id = ?').run(next.username, next.password_hash, next.sso_subject, bump, id);
  return getFamilyLogin(db, id)!;
}

export function deleteFamilyLogin(db: Db, id: number): FamilyLogin {
  const l = getFamilyLogin(db, id);
  if (!l) throw new HttpError(404, 'No such family sign-in');
  db.prepare('DELETE FROM family_logins WHERE id = ?').run(id);
  return l;
}

/** A family sign-in by username and password, or undefined (same timing either way is up to the caller). */
export async function checkFamilyPassword(db: Db, username: string, password: string, dummyHash: string): Promise<FamilyLogin | undefined> {
  const r = row(db, 'username', username.toLowerCase());
  const ok = await verifyPassword(password, r?.password_hash ?? dummyHash);
  return r && r.password_hash && ok ? toLogin(r) : undefined;
}

// ---- the family token and the profile picker ----

const mac = (secret: Buffer, id: number, epoch: number) => hmac(secret, `family-login:${id}:${epoch}`);

export function familyToken(db: Db, secret: Buffer, loginId: number): string {
  const r = row(db, 'id', loginId)!;
  return `wlf_${r.id}.${r.epoch}.${mac(secret, r.id, r.epoch)}`;
}

/** The family sign-in a token belongs to, if the token is still good. */
export function checkFamilyToken(db: Db, secret: Buffer, token: unknown): FamilyLogin | undefined {
  const m = typeof token === 'string' ? /^wlf_(\d+)\.(\d+)\.([\w-]+)$/.exec(token) : null;
  if (!m) return undefined;
  const r = row(db, 'id', Number(m[1]));
  if (!r || r.epoch !== Number(m[2]) || !safeEqual(m[3], mac(secret, r.id, r.epoch))) return undefined;
  return toLogin(r);
}

export interface PickProfile {
  id: number;
  displayName: string;
  role: string;
  /** Picking it asks for the profile's switching PIN. */
  needsPin: boolean;
}

/** Profiles a family sign-in may pick: the family's active people; admins only once they've set a PIN. */
export function pickable(db: Db, familyId: number): (PickProfile & { user: User })[] {
  return familyMembers(db, familyId)
    .filter((u) => !u.disabled && (u.role !== 'admin' || u.hasSwitchPin))
    .map((u) => ({ id: u.id, displayName: u.displayName, role: u.role, needsPin: u.hasSwitchPin, user: u }));
}

/** What the device gets back after signing in with a family sign-in, instead of a session. */
export function pickPayload(db: Db, secret: Buffer, login: FamilyLogin) {
  const f = getFamily(db, login.familyId);
  return {
    pick: {
      familyToken: familyToken(db, secret, login.id),
      family: { id: login.familyId, name: f?.name ?? '' },
      profiles: pickable(db, login.familyId).map(({ user: _u, ...p }) => p),
    },
  };
}
