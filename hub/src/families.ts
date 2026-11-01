import { seal, unseal } from './crypto.ts';
import type { Db } from './db.ts';
import type { Auth } from './http.ts';
import { HttpError } from './http.ts';
import { getUser, type User } from './users.ts';

/**
 * Families (docs/HUB.md "Families"): one Hub shared by a few households. Only the Hub admin makes families,
 * puts people in them and decides what each family may do; the people in a family never see these settings.
 *
 * - A family can have **managers** (users.family_manager). What a manager may do is the family's switches:
 *   `canRegister` (add people and make invite links into the family), `ownKeys` (set the family's own shared
 *   keys) and `kidControls` (bedtimes, daily limits and a grown-up PIN for the family's kids).
 * - **Shared keys** (`SHARED_KEYS`) can have a value for the whole Hub and one per family; a family's own
 *   value wins for its members. Keys stay on the Hub, sealed; only the Discord app ID (not a secret) is sent
 *   to devices, and it wins over anything typed into a device.
 * - **Switching** (routes/families.ts POST /api/me/switch): people in the same family switch to each other on
 *   a shared device with the other person's switching PIN, which the Hub checks.
 */

export interface Family {
  id: number;
  name: string;
  canRegister: boolean;
  ownKeys: boolean;
  kidControls: boolean;
  maxPeople: number | null;
  createdAt: number;
}

interface FamilyRow {
  id: number;
  name: string;
  can_register: number;
  own_keys: number;
  kid_controls: number;
  max_people: number | null;
  created_at: number;
}

const toFamily = (r: FamilyRow): Family => ({
  id: r.id,
  name: r.name,
  canRegister: !!r.can_register,
  ownKeys: !!r.own_keys,
  kidControls: !!r.kid_controls,
  maxPeople: r.max_people,
  createdAt: r.created_at,
});

export function listFamilies(db: Db): Family[] {
  return (db.prepare('SELECT * FROM families ORDER BY name COLLATE NOCASE').all() as unknown as FamilyRow[]).map(toFamily);
}

export function getFamily(db: Db, id: number | null | undefined): Family | undefined {
  if (!id) return undefined;
  const r = db.prepare('SELECT * FROM families WHERE id = ?').get(id) as FamilyRow | undefined;
  return r && toFamily(r);
}

export const familySize = (db: Db, id: number) => (db.prepare('SELECT COUNT(*) AS n FROM users WHERE family_id = ?').get(id) as { n: number }).n;

/** `{ name?, canRegister?, ownKeys?, kidControls?, maxPeople? }`. */
function readFamily(b: unknown, creating: boolean) {
  const o = (b ?? {}) as Record<string, unknown>;
  const out: Partial<Omit<Family, 'id' | 'createdAt'>> = {};
  if (o.name !== undefined || creating) {
    const name = typeof o.name === 'string' ? o.name.trim().slice(0, 40) : '';
    if (!name) throw new HttpError(400, 'Give the family a name');
    out.name = name;
  }
  for (const k of ['canRegister', 'ownKeys', 'kidControls'] as const) if (o[k] !== undefined) out[k] = o[k] === true;
  if (o.maxPeople !== undefined) {
    if (o.maxPeople === null || o.maxPeople === '' || o.maxPeople === 0) out.maxPeople = null;
    else if (typeof o.maxPeople === 'number' && Number.isInteger(o.maxPeople) && o.maxPeople > 0 && o.maxPeople <= 100) out.maxPeople = o.maxPeople;
    else throw new HttpError(400, 'The most people is a number from 1 to 100, or empty for no limit');
  }
  return out;
}

export function createFamily(db: Db, body: unknown): Family {
  const f = readFamily(body, true);
  if (db.prepare('SELECT 1 FROM families WHERE name = ? COLLATE NOCASE').get(f.name!)) throw new HttpError(409, 'There’s already a family with that name');
  const res = db
    .prepare('INSERT INTO families (name, can_register, own_keys, kid_controls, max_people, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(f.name!, f.canRegister ? 1 : 0, f.ownKeys ? 1 : 0, f.kidControls ? 1 : 0, f.maxPeople ?? null, Date.now());
  return getFamily(db, Number(res.lastInsertRowid))!;
}

export function updateFamily(db: Db, id: number, body: unknown): Family {
  const cur = getFamily(db, id);
  if (!cur) throw new HttpError(404, 'No such family');
  const f = { ...cur, ...readFamily(body, false) };
  if (f.name !== cur.name && db.prepare('SELECT 1 FROM families WHERE name = ? COLLATE NOCASE AND id != ?').get(f.name, id)) {
    throw new HttpError(409, 'There’s already a family with that name');
  }
  db.prepare('UPDATE families SET name = ?, can_register = ?, own_keys = ?, kid_controls = ?, max_people = ? WHERE id = ?')
    .run(f.name, f.canRegister ? 1 : 0, f.ownKeys ? 1 : 0, f.kidControls ? 1 : 0, f.maxPeople, id);
  return getFamily(db, id)!;
}

/** People leave the family (they keep their accounts); its keys and its grown-up PIN go. */
export function deleteFamily(db: Db, id: number): Family {
  const f = getFamily(db, id);
  if (!f) throw new HttpError(404, 'No such family');
  db.prepare('UPDATE users SET family_id = NULL, family_manager = 0 WHERE family_id = ?').run(id);
  db.prepare('DELETE FROM shared_keys WHERE family_id = ?').run(id);
  db.prepare('DELETE FROM invites WHERE family_id = ? AND used_at IS NULL').run(id);
  db.prepare('DELETE FROM hub_settings WHERE key = ?').run(familyPinKey(id));
  db.prepare('DELETE FROM families WHERE id = ?').run(id);
  return f;
}

/** Put someone in a family (or none) and make them its manager or not. */
export function setMembership(db: Db, userId: number, familyId: number | null, manager: boolean) {
  const u = getUser(db, userId);
  if (!u) throw new HttpError(404, 'No such user');
  if (familyId !== null) {
    const f = getFamily(db, familyId);
    if (!f) throw new HttpError(404, 'No such family');
    if (u.familyId !== familyId && f.maxPeople !== null && familySize(db, familyId) >= f.maxPeople) {
      throw new HttpError(409, `${f.name} already has ${f.maxPeople} people, its most`);
    }
  }
  if (manager && u.role === 'kid') throw new HttpError(400, 'A kid can’t manage a family');
  db.prepare('UPDATE users SET family_id = ?, family_manager = ?, updated_at = ? WHERE id = ?').run(familyId, familyId !== null && manager ? 1 : 0, Date.now(), userId);
  return getUser(db, userId)!;
}

export const familyMembers = (db: Db, familyId: number): User[] =>
  (db.prepare('SELECT id FROM users WHERE family_id = ? ORDER BY display_name COLLATE NOCASE').all(familyId) as { id: number }[]).map((r) => getUser(db, r.id)!);

// ---- what a manager may do ----

export type FamilyPower = 'canRegister' | 'ownKeys' | 'kidControls';

/** The family this person manages with `power` switched on for it, or undefined. Admins aren't covered here. */
export function managedFamily(db: Db, user: User, power: FamilyPower): Family | undefined {
  if (!user.familyManager || user.role === 'kid') return undefined;
  const f = getFamily(db, user.familyId);
  return f?.[power] ? f : undefined;
}

/**
 * Who may act on a family's `power`: an admin for any family, or a manager of that family when the admin
 * switched the power on for it. Returns the family to act on (`familyId` for admins; their own for managers).
 */
export function familyActor(db: Db, auth: Auth, power: FamilyPower, familyId?: number): { admin: boolean; family?: Family } {
  if (auth.permissions.includes('users.manage')) return { admin: true, family: familyId ? getFamily(db, familyId) : undefined };
  const f = managedFamily(db, auth.user, power);
  if (!f || (familyId !== undefined && familyId !== f.id)) throw new HttpError(403, 'You do not have permission to do that');
  return { admin: false, family: f };
}

/** A manager may only touch people in their own family who aren't admins or other managers. */
export function managerMayTouch(manager: User, target: User): boolean {
  return target.familyId === manager.familyId && target.id !== manager.id && target.role !== 'admin' && !target.familyManager;
}

// ---- the family's own grown-up PIN (routes/kids.ts) ----

export const familyPinKey = (familyId: number) => `kid_pin:family:${familyId}`;

// ---- shared keys ----

/**
 * Keys a family can share. `hubWide`: where the whole Hub's value lives when it isn't in shared_keys (family 0):
 * the AI DJ's and tour dates' keys keep their own settings pages, so here they only take per-family values.
 */
export const SHARED_KEYS = {
  anthropic: { label: 'AI DJ: Anthropic API key', secret: true, hubWide: 'dj' },
  openai: { label: 'AI DJ voice: OpenAI API key', secret: true, hubWide: 'dj' },
  ollama: { label: 'AI DJ web search: ollama.com API key', secret: true, hubWide: 'dj' },
  tours: { label: 'Tour dates: Ticketmaster key or Bandsintown app ID', secret: true, hubWide: 'tours' },
  lastfmKey: { label: 'Last.fm API key', secret: true, hubWide: 'here' },
  lastfmSecret: { label: 'Last.fm shared secret', secret: true, hubWide: 'here' },
  fanart: { label: 'fanart.tv API key', secret: true, hubWide: 'here' },
  discordAppId: { label: 'Discord application ID', secret: false, hubWide: 'here' },
} as const;
export type SharedKeyName = keyof typeof SHARED_KEYS;
export const SHARED_KEY_NAMES = Object.keys(SHARED_KEYS) as SharedKeyName[];
export const isSharedKey = (v: unknown): v is SharedKeyName => typeof v === 'string' && Object.hasOwn(SHARED_KEYS, v);

const aad = (familyId: number, name: string) => `shared-key:${familyId}:${name}`;

/** The value saved for this family (0 = the whole Hub), or null. A value sealed with an old secret key reads as null. */
export function storedKey(db: Db, secretKey: Buffer, familyId: number, name: SharedKeyName): string | null {
  const r = db.prepare('SELECT value FROM shared_keys WHERE family_id = ? AND name = ?').get(familyId, name) as { value: string } | undefined;
  if (!r) return null;
  try {
    return unseal(secretKey, r.value, aad(familyId, name));
  } catch {
    return null;
  }
}

/** '' or null removes it. */
export function saveKey(db: Db, secretKey: Buffer, familyId: number, name: SharedKeyName, value: string | null) {
  const v = (value ?? '').trim();
  if (v.length > 500) throw new HttpError(400, 'That key is too long');
  if (name === 'discordAppId' && v && !/^\d{5,25}$/.test(v)) throw new HttpError(400, 'A Discord application ID is a long number');
  if (!v) db.prepare('DELETE FROM shared_keys WHERE family_id = ? AND name = ?').run(familyId, name);
  else {
    db.prepare(`INSERT INTO shared_keys (family_id, name, value, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (family_id, name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(familyId, name, seal(secretKey, v, aad(familyId, name)), Date.now());
  }
}

/** The family's own value for this person, if their family has one. */
export function familyKeyFor(db: Db, secretKey: Buffer, userId: number | null | undefined, name: SharedKeyName): string | null {
  if (!userId) return null;
  const u = db.prepare('SELECT family_id FROM users WHERE id = ?').get(userId) as { family_id: number | null } | undefined;
  return u?.family_id ? storedKey(db, secretKey, u.family_id, name) : null;
}

/**
 * The key to use for this person: their family's own, then the whole Hub's (saved here), then `fallback`
 * (an environment variable, or the AI DJ's / tour dates' own setting).
 */
export function keyFor(db: Db, secretKey: Buffer, userId: number | null | undefined, name: SharedKeyName, fallback?: string | null): string | null {
  return familyKeyFor(db, secretKey, userId, name) ?? storedKey(db, secretKey, 0, name) ?? (fallback || null);
}

const hint = (v: string | null, secret: boolean) => (v ? (secret ? `…${v.slice(-4)}` : v) : null);

/** What an admin or manager sees: which keys are set and their last four characters, never a secret. */
export function keyStatus(db: Db, secretKey: Buffer, familyId: number) {
  return SHARED_KEY_NAMES.map((name) => {
    const s = SHARED_KEYS[name];
    const v = storedKey(db, secretKey, familyId, name);
    return { name, label: s.label, secret: s.secret, hubWide: s.hubWide, set: !!v, hint: hint(v, s.secret) };
  });
}
