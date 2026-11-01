import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import { hashPassword, verifyPassword } from '../crypto.ts';
import { tx } from '../db.ts';
import { createDevice, listDevices } from '../devices.ts';
import {
  createFamily, deleteFamily, familyMembers, familySize, getFamily, isSharedKey, keyStatus, listFamilies, managedFamily,
  managerMayTouch, saveKey, SHARED_KEYS, setMembership, updateFamily, type Family,
} from '../families.ts';
import { setGuardians } from '../family.ts';
import { clientIp, HttpError, need, signedIn, str } from '../http.ts';
import { createUser, getUser, getUserForLogin, updateUser, USERNAME_RE, type User } from '../users.ts';
import { MIN_PASSWORD, session } from './auth.ts';

/**
 * Families (families.ts, docs/HUB.md "Families").
 *
 * - `/api/admin/families…`, `/api/admin/keys`: the Hub admin only. Makes families, puts people in them, picks
 *   managers, decides what each family may do, and sets shared keys for the whole Hub or any family.
 * - `/api/family…`: a family's managers, for what the admin switched on for that family. Everyone else gets 403,
 *   so these settings never reach the rest of the family.
 * - `/api/me/family`, `/api/me/switch-pin`, `/api/me/switch`: everyone, for switching profiles on a shared device.
 */
export function familyRoutes(app: FastifyInstance, { db, config, limits }: Ctx) {
  const key = config.secretKey;
  const body = (b: unknown) => (b ?? {}) as Record<string, unknown>;
  const withCounts = (f: Family) => ({ ...f, people: familySize(db, f.id) });
  const person = (u: User) => ({ id: u.id, username: u.username, displayName: u.displayName, role: u.role, familyManager: u.familyManager, disabled: u.disabled, hasSwitchPin: u.hasSwitchPin });

  /** Values a family's keys may be set to: `{ name: value }`, '' or null to remove. */
  function saveKeys(familyId: number, values: unknown): string[] {
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new HttpError(400, 'Send values: { key name: value }');
    const changed: string[] = [];
    for (const [name, v] of Object.entries(values)) {
      if (!isSharedKey(name)) throw new HttpError(400, `${name.slice(0, 40)} isn’t a shared key`);
      if (familyId === 0 && SHARED_KEYS[name].hubWide !== 'here') throw new HttpError(400, `The whole Hub’s ${SHARED_KEYS[name].label} is set on its own settings page`);
      if (v !== null && typeof v !== 'string') throw new HttpError(400, `${name} must be text`);
      saveKey(db, key, familyId, name, v);
      changed.push(name);
    }
    return changed;
  }

  // ---- the Hub admin ----

  app.get('/api/admin/families', async (req) => {
    need(req, 'users.manage');
    return { families: listFamilies(db).map(withCounts) };
  });

  app.post('/api/admin/families', async (req) => {
    const { user } = need(req, 'users.manage');
    const f = createFamily(db, req.body);
    audit(db, { actorId: user.id, action: 'family.created', target: f.name, ip: clientIp(req) });
    return { family: withCounts(f) };
  });

  app.patch<{ Params: { id: string } }>('/api/admin/families/:id', async (req) => {
    const { user } = need(req, 'users.manage');
    const f = updateFamily(db, Number(req.params.id), req.body);
    audit(db, { actorId: user.id, action: 'family.updated', target: f.name, detail: { canRegister: f.canRegister, ownKeys: f.ownKeys, kidControls: f.kidControls, maxPeople: f.maxPeople }, ip: clientIp(req) });
    return { family: withCounts(f) };
  });

  app.delete<{ Params: { id: string } }>('/api/admin/families/:id', async (req) => {
    const { user } = need(req, 'users.manage');
    const f = tx(db, () => deleteFamily(db, Number(req.params.id)));
    audit(db, { actorId: user.id, action: 'family.deleted', target: f.name, ip: clientIp(req) });
    return { ok: true };
  });

  /** `{ familyId: number | null, manager?: boolean }`. */
  app.put<{ Params: { id: string } }>('/api/admin/users/:id/family', async (req) => {
    const { user } = need(req, 'users.manage');
    const b = body(req.body);
    const familyId = b.familyId === null || b.familyId === undefined || b.familyId === '' ? null : Number(b.familyId);
    const u = tx(db, () => setMembership(db, Number(req.params.id), familyId, b.manager === true));
    audit(db, { actorId: user.id, action: 'user.family', target: u.username, detail: { family: getFamily(db, u.familyId)?.name ?? null, manager: u.familyManager }, ip: clientIp(req) });
    return { user: u };
  });

  /** Someone forgot their switching PIN: take it off. */
  app.delete<{ Params: { id: string } }>('/api/admin/users/:id/switch-pin', async (req) => {
    const { user } = need(req, 'users.manage');
    const target = getUser(db, Number(req.params.id));
    if (!target) throw new HttpError(404, 'No such user');
    db.prepare('UPDATE users SET switch_pin = NULL, updated_at = ? WHERE id = ?').run(Date.now(), target.id);
    audit(db, { actorId: user.id, action: 'user.switch_pin_removed', target: target.username, ip: clientIp(req) });
    return { user: getUser(db, target.id) };
  });

  /** `?familyId=` (0 or none = the whole Hub): which shared keys are set there. Never a secret value. */
  app.get('/api/admin/keys', async (req) => {
    need(req, 'users.manage');
    const familyId = Number((req.query as { familyId?: string }).familyId) || 0;
    if (familyId && !getFamily(db, familyId)) throw new HttpError(404, 'No such family');
    return {
      keys: keyStatus(db, key, familyId),
      // whether the Hub's environment has these, so the page can say a value there is in use
      env: { lastfmKey: !!config.lastfmKey, lastfmSecret: !!config.lastfmSecret, fanart: !!config.fanartKey },
    };
  });

  /** `{ familyId?, values: { name: value | '' } }`. */
  app.put('/api/admin/keys', async (req) => {
    const { user } = need(req, 'users.manage');
    const b = body(req.body);
    const familyId = Number(b.familyId) || 0;
    const f = familyId ? getFamily(db, familyId) : undefined;
    if (familyId && !f) throw new HttpError(404, 'No such family');
    const changed = tx(db, () => saveKeys(familyId, b.values));
    audit(db, { actorId: user.id, action: 'keys.shared', target: f?.name ?? 'Whole Hub', detail: { changed }, ip: clientIp(req) });
    return { keys: keyStatus(db, key, familyId) };
  });

  // ---- a family's managers ----

  /** The family this manager manages, its switches, its people and (with ownKeys) its keys. 403 for anyone else. */
  app.get('/api/family', async (req) => {
    const { user } = signedIn(req);
    if (!user.familyManager || user.role === 'kid') throw new HttpError(403, 'You do not have permission to do that');
    const f = getFamily(db, user.familyId)!;
    return {
      family: withCounts(f),
      people: familyMembers(db, f.id).map((u) => ({ ...person(u), devices: listDevices(db, u.id).length })),
      ...(f.ownKeys && { keys: keyStatus(db, key, f.id) }),
    };
  });

  const canRegister = (user: User) => {
    const f = managedFamily(db, user, 'canRegister');
    if (!f) throw new HttpError(403, 'You do not have permission to do that');
    return f;
  };

  /** `{ username, displayName?, role: 'member' | 'kid', password }`: someone new, in the manager's family. */
  app.post('/api/family/users', async (req) => {
    const { user } = signedIn(req);
    const f = canRegister(user);
    const b = body(req.body);
    const username = str(b, 'username', 32).toLowerCase();
    if (!USERNAME_RE.test(username)) throw new HttpError(400, 'Usernames are 1–32 letters, numbers, dots, dashes or underscores');
    if (b.role !== 'member' && b.role !== 'kid') throw new HttpError(400, 'A family manager can add members and kids');
    const pw = str(b, 'password', 200);
    if (pw.length < MIN_PASSWORD) throw new HttpError(400, `Passwords need at least ${MIN_PASSWORD} characters`);
    const passwordHash = await hashPassword(pw);
    const u = tx(db, () => {
      if (getUserForLogin(db, username)) throw new HttpError(409, 'That username is taken');
      if (f.maxPeople !== null && familySize(db, f.id) >= f.maxPeople) throw new HttpError(409, `${f.name} already has ${f.maxPeople} people, its most`);
      const made = createUser(db, { username, displayName: str(b, 'displayName', 60), role: b.role as 'member' | 'kid', passwordHash });
      return setMembership(db, made.id, f.id, false);
    });
    audit(db, { actorId: user.id, action: 'user.created', target: u.username, detail: { role: u.role, family: f.name }, ip: clientIp(req) });
    return { user: person(u) };
  });

  /** `{ displayName?, role?: 'member' | 'kid', password?, disabled? }` for someone in the manager's family. */
  app.patch<{ Params: { id: string } }>('/api/family/users/:id', async (req) => {
    const { user } = signedIn(req);
    canRegister(user);
    const target = getUser(db, Number(req.params.id));
    if (!target || !managerMayTouch(user, target)) throw new HttpError(404, 'No such person in your family');
    const b = body(req.body);
    const p: Parameters<typeof updateUser>[2] = {};
    if (b.displayName !== undefined) p.displayName = str(b, 'displayName', 60) || target.displayName;
    if (b.role !== undefined) {
      if (b.role !== 'member' && b.role !== 'kid') throw new HttpError(400, 'A family manager can make people members or kids');
      p.role = b.role;
    }
    if (typeof b.password === 'string') {
      if (b.password.length < MIN_PASSWORD) throw new HttpError(400, `Passwords need at least ${MIN_PASSWORD} characters`);
      p.passwordHash = await hashPassword(b.password);
    }
    if (b.disabled !== undefined) p.disabled = b.disabled === true;
    const u = updateUser(db, target.id, p)!;
    if (p.disabled) db.prepare('UPDATE devices SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(Date.now(), target.id);
    const { passwordHash, ...changed } = p;
    audit(db, { actorId: user.id, action: 'user.updated', target: u.username, detail: { ...changed, ...(passwordHash && { password: 'changed' }) }, ip: clientIp(req) });
    return { user: person(u) };
  });

  /** `{ ids }`: a kid's parents, grown-ups in the same family. Needs kidControls. */
  app.put<{ Params: { id: string } }>('/api/family/users/:id/guardians', async (req) => {
    const { user } = signedIn(req);
    const f = managedFamily(db, user, 'kidControls');
    if (!f) throw new HttpError(403, 'You do not have permission to do that');
    const kid = getUser(db, Number(req.params.id));
    if (!kid || kid.role !== 'kid' || kid.familyId !== f.id) throw new HttpError(404, 'No such kid in your family');
    const raw = body(req.body).ids;
    if (!Array.isArray(raw) || raw.length > 20) throw new HttpError(400, 'Send ids: the parents’ user ids');
    const ids = [...new Set(raw.map(Number))];
    for (const id of ids) {
      const g = getUser(db, id);
      if (!g || g.role === 'kid' || g.familyId !== f.id) throw new HttpError(400, 'A parent has to be a grown-up in your family');
    }
    setGuardians(db, kid.id, ids);
    audit(db, { actorId: user.id, action: 'user.guardians', target: kid.username, detail: { guardians: ids.map((id) => getUser(db, id)!.username) }, ip: clientIp(req) });
    return { ok: true };
  });

  /** `{ values }`: the family's own shared keys. Needs ownKeys. */
  app.put('/api/family/keys', async (req) => {
    const { user } = signedIn(req);
    const f = managedFamily(db, user, 'ownKeys');
    if (!f) throw new HttpError(403, 'You do not have permission to do that');
    const changed = tx(db, () => saveKeys(f.id, body(req.body).values));
    audit(db, { actorId: user.id, action: 'keys.shared', target: f.name, detail: { changed }, ip: clientIp(req) });
    return { keys: keyStatus(db, key, f.id) };
  });

  // ---- everyone: switching profiles on a shared device ----

  /** The people in your family, for the profile picker. Names only: no family settings. */
  app.get('/api/me/family', async (req) => {
    const { user } = signedIn(req);
    if (!user.familyId) return { people: [] };
    const f = getFamily(db, user.familyId);
    return {
      name: f?.name ?? null,
      people: familyMembers(db, user.familyId).filter((u) => !u.disabled).map((u) => ({ id: u.id, displayName: u.displayName, role: u.role, hasSwitchPin: u.hasSwitchPin })),
    };
  });

  /** `{ pin }` (4 to 8 digits) that your family switches to you with; `{ pin: null }` removes it. */
  app.put('/api/me/switch-pin', async (req) => {
    const { user } = signedIn(req);
    const pin = body(req.body).pin;
    if (pin !== null && !(typeof pin === 'string' && /^\d{4,8}$/.test(pin))) throw new HttpError(400, 'The PIN is 4 to 8 digits');
    db.prepare('UPDATE users SET switch_pin = ?, updated_at = ? WHERE id = ?').run(pin === null ? null : await hashPassword(pin), Date.now(), user.id);
    audit(db, { actorId: user.id, action: pin === null ? 'user.switch_pin_removed' : 'user.switch_pin_set', target: user.username, ip: clientIp(req) });
    return { user: getUser(db, user.id) };
  });

  /**
   * `{ userId, pin?, deviceName?, platform? }` → a session for that person on this device, without pairing again.
   * Only within one family. The other person's switching PIN is needed, except a grown-up switching to a kid
   * without one. Kids always need it, so a kid can't step into a grown-up's profile.
   */
  app.post('/api/me/switch', async (req) => {
    const { user, device } = signedIn(req);
    const b = body(req.body);
    const target = getUser(db, Number(b.userId));
    if (!user.familyId || !target || target.id === user.id || target.familyId !== user.familyId || target.disabled) throw new HttpError(404, 'That person isn’t in your family');
    const row = getUserForLogin(db, target.username)!;
    const pinHash = (db.prepare('SELECT switch_pin FROM users WHERE id = ?').get(target.id) as { switch_pin: string | null }).switch_pin;
    if (pinHash) {
      limits.login.hit(`switch:${device.id}:${target.id}`);
      const pin = b.pin;
      if (!(typeof pin === 'string' && (await verifyPassword(pin, pinHash)))) {
        audit(db, { actorId: user.id, action: 'user.switch_failed', target: row.username, ip: clientIp(req) });
        throw new HttpError(403, `That’s not ${target.displayName}’s PIN`);
      }
      limits.login.clear(`switch:${device.id}:${target.id}`);
    } else if (!(target.role === 'kid' && user.role !== 'kid')) {
      throw new HttpError(409, `${target.displayName} hasn’t set a switching PIN yet (Settings → Account)`);
    }
    const made = createDevice(db, target.id, str(b, 'deviceName', 60) || device.name, str(b, 'platform', 30) || device.platform);
    audit(db, { actorId: user.id, action: 'user.switched', target: target.username, detail: { device: made.device.name }, ip: clientIp(req) });
    return session(made.token, target, made.device);
  });
}
