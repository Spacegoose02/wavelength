import { randomBytes } from 'node:crypto';
import { audit } from './audit.ts';
import type { Db } from './db.ts';
import { HttpError } from './http.ts';
import { navidromeAdmin } from './routes/navidrome.ts';
import { KINDS, listServices, navidromeOff, serviceForHub, setServiceUser, type ServiceKind } from './services.ts';
import type { User } from './users.ts';

/**
 * What someone new gets the moment their profile is made (docs/HUB.md "New people"), so an admin doesn't have to
 * visit every server for every person: their own Navidrome account, and each server switched on or off for them.
 * Applies to every way a profile is made: an admin adding someone, an invite, a family manager, and tinyauth making a
 * profile by itself. Not to the first admin, who gets everything anyway.
 *
 * Kept in hub_settings as one JSON row. A server not listed follows its access: on when it's for everyone, off
 * otherwise.
 */
export interface NewPeople {
  /**
   * Make them a Navidrome account with the admin login the Hub keeps, on each Navidrome they get (its switch below).
   * Only while Navidrome is on: when the Hub serves the music itself, nobody needs one. The app no longer shows this
   * switch (the Music switch decides); it's kept so a Hub can still turn the accounts off through the API.
   */
  navidromeAccount: boolean;
  /** Server id → on or off for new people. */
  services: Record<string, boolean>;
}

const KEY = 'newPeople';
const download = (k: ServiceKind) => 'download' in KINDS[k] && KINDS[k].download === true;

export function getNewPeople(db: Db): NewPeople {
  const row = db.prepare('SELECT value FROM hub_settings WHERE key = ?').get(KEY) as { value: string } | undefined;
  let v: Partial<NewPeople> = {};
  try {
    v = row ? (JSON.parse(row.value) as Partial<NewPeople>) : {};
  } catch {
    /* a broken row: the defaults */
  }
  return {
    navidromeAccount: v.navidromeAccount !== false,
    services: v.services && typeof v.services === 'object' ? Object.fromEntries(Object.entries(v.services).filter(([, on]) => typeof on === 'boolean')) : {},
  };
}

/** `{ navidromeAccount?, services?: { [id]: boolean | null } }`; null forgets a server's choice (back to its access). */
export function putNewPeople(db: Db, patch: unknown): NewPeople {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new HttpError(400, 'Send an object');
  const b = patch as Record<string, unknown>;
  const cur = getNewPeople(db);
  if (b.navidromeAccount !== undefined) {
    if (typeof b.navidromeAccount !== 'boolean') throw new HttpError(400, 'navidromeAccount must be true or false');
    cur.navidromeAccount = b.navidromeAccount;
  }
  if (b.services !== undefined) {
    if (!b.services || typeof b.services !== 'object' || Array.isArray(b.services)) throw new HttpError(400, 'services must be an object of server ids');
    const known = new Set(listServicesIds(db));
    for (const [id, on] of Object.entries(b.services)) {
      if (!known.has(Number(id))) throw new HttpError(400, `No server ${id.slice(0, 12)}`);
      if (on === null) delete cur.services[id];
      else if (typeof on === 'boolean') cur.services[id] = on;
      else throw new HttpError(400, 'Each server is true, false or null');
    }
  }
  // forget servers that were removed since
  const known = new Set(listServicesIds(db).map(String));
  cur.services = Object.fromEntries(Object.entries(cur.services).filter(([id]) => known.has(id)));
  db.prepare('INSERT INTO hub_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(KEY, JSON.stringify(cur));
  return cur;
}

const listServicesIds = (db: Db) => (db.prepare('SELECT id, kind FROM services').all() as { id: number; kind: ServiceKind }[]).filter((r) => !download(r.kind)).map((r) => r.id);

/**
 * Switch the servers on or off for someone just made. Plain statements, no transaction of its own, so it can run
 * inside the one that made the profile (tinyauth's). Admins are left alone: they always get every server.
 */
export function applyNewPeopleServices(db: Db, user: Pick<User, 'id' | 'role'>) {
  if (user.role === 'admin') return;
  const { services } = getNewPeople(db);
  const servers = db.prepare('SELECT id, kind, access FROM services').all() as { id: number; kind: ServiceKind; access: string }[];
  for (const s of servers) {
    if (download(s.kind)) continue;
    const want = services[String(s.id)];
    if (want === undefined) continue; // follows the server's access
    const has = s.access === 'everyone';
    if (want === has) continue;
    // on for an admins-only server makes it "People I choose" (setServiceAccess does the same)
    if (want && s.access === 'admins') db.prepare("UPDATE services SET access = 'chosen', updated_at = ? WHERE id = ?").run(Date.now(), s.id);
    db.prepare(
      `INSERT INTO service_users (service_id, user_id, secrets, allowed) VALUES (?, ?, NULL, ?)
       ON CONFLICT (service_id, user_id) DO UPDATE SET allowed = excluded.allowed`,
    ).run(s.id, user.id, want ? 1 : 0);
  }
}

/**
 * Make them their own account on each Navidrome the Hub has an admin login for. Never throws: a Navidrome that's
 * down, or already has someone by that name, is written to the audit log, and an admin can still make the account
 * by hand (Settings → Server → Navidrome accounts). Run it after the profile's transaction has committed.
 */
export async function makeNavidromeAccounts(db: Db, key: Buffer, user: Pick<User, 'id' | 'username' | 'displayName'>, ip?: string) {
  if (!getNewPeople(db).navidromeAccount || navidromeOff(db)) return;
  const { services } = getNewPeople(db);
  for (const s of listServices(db, key).filter((x) => x.kind === 'navidrome')) {
    if (s.users.some((u) => u.userId === user.id && u.secretsSet.includes('password'))) continue;
    // only on a Navidrome their Music switch gives them
    if (!(services[String(s.id)] ?? s.access === 'everyone')) continue;
    const hub = serviceForHub(db, key, s.id);
    if (!hub?.secrets.adminUsername || !hub.secrets.adminPassword) continue;
    try {
      const nd = await navidromeAdmin(hub.url, hub.secrets.adminUsername, hub.secrets.adminPassword);
      const password = randomBytes(18).toString('base64url');
      await nd.createUser({ userName: user.username, name: user.displayName, password });
      setServiceUser(db, key, s.id, user.id, { username: user.username, password });
      audit(db, { action: 'navidrome.account_created', target: user.username, detail: { server: s.name, automatic: true }, ...(ip && { ip }) });
    } catch (e) {
      audit(db, { action: 'navidrome.account_failed', target: user.username, detail: { server: s.name, error: e instanceof Error ? e.message.slice(0, 200) : 'failed' }, ...(ip && { ip }) });
    }
  }
}

/** Everything someone new gets, for the routes that make profiles outside a transaction. */
export async function welcomeNewPerson(db: Db, key: Buffer, user: User, ip?: string) {
  applyNewPeopleServices(db, user);
  await makeNavidromeAccounts(db, key, user, ip);
}
