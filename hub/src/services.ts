import type { Auth } from './http.ts';
import { seal, unseal } from './crypto.ts';
import type { Db } from './db.ts';
import { tx } from './db.ts';
import { HttpError } from './http.ts';

/**
 * Server logins the Hub keeps for the household: Plex, Audiobookshelf, SUB/WAVE, deemix and yt-dlp.
 * Navidrome stays a per-person login on each device. Secrets are sealed at rest and handed to a device
 * only when its user may use them (servicesFor). The admin view never includes a secret, only which
 * fields are set. See docs/HUB.md "Server logins".
 */

interface KindSpec {
  /** Secret fields, sealed at rest. */
  secrets: readonly string[];
  /** Secret fields a person can have their own value for (their own Plex token, their own ABS key). */
  own: readonly string[];
  /** Settings that aren't secret. */
  config: readonly string[];
  /** Secret fields only handed to people allowed to control SUB/WAVE. */
  controlOnly?: readonly string[];
  /** Download tools: one per Hub, handed only to people allowed to download (admins, Autodownload). */
  download?: boolean;
}

export const KINDS = {
  plex: { secrets: ['token'], own: ['token'], config: [] },
  audiobookshelf: { secrets: ['token'], own: ['token'], config: [] },
  subwave: { secrets: ['username', 'password', 'token'], own: [], config: ['streamUrl', 'apiUrl', 'nowPlayingUrl'], controlOnly: ['username', 'password'] },
  deemix: { secrets: ['arl'], own: [], config: ['bitrate'], download: true },
  ytdlp: { secrets: ['shareUser', 'sharePass'], own: [], config: ['outDir', 'format'], download: true },
} satisfies Record<string, KindSpec>;
export type ServiceKind = keyof typeof KINDS;
const spec = (k: ServiceKind): KindSpec => KINDS[k];
export const isKind = (v: unknown): v is ServiceKind => typeof v === 'string' && Object.hasOwn(KINDS, v);

export const ACCESS = ['everyone', 'admins', 'chosen'] as const;
export type Access = (typeof ACCESS)[number];

type Fields = Record<string, string>;
type Config = Record<string, string | number>;

interface Row {
  id: number;
  kind: ServiceKind;
  name: string;
  url: string;
  access: Access;
  config: string;
  secrets: string | null;
  position: number;
}

/** What an admin sees: never a secret value, only which ones are set. */
export interface AdminService {
  id: number;
  kind: ServiceKind;
  name: string;
  url: string;
  access: Access;
  config: Config;
  secretsSet: string[];
  /** The secret key changed since these were saved, so they can't be read. Re-enter them. */
  unreadable: boolean;
  users: { userId: number; secretsSet: string[]; unreadable: boolean }[];
}

/** What a device gets for its user. */
export interface DeviceService {
  id: number;
  kind: ServiceKind;
  name: string;
  url: string;
  config: Config;
  secrets: Fields;
  /** This person has their own login rather than the shared one. */
  ownLogin: boolean;
}

const aadShared = (id: number) => `service:${id}`;
const aadUser = (id: number, userId: number) => `service:${id}:user:${userId}`;

function open(key: Buffer, sealed: string | null, aad: string): { fields: Fields; unreadable: boolean } {
  if (!sealed) return { fields: {}, unreadable: false };
  try {
    return { fields: JSON.parse(unseal(key, sealed, aad)) as Fields, unreadable: false };
  } catch {
    return { fields: {}, unreadable: true };
  }
}
const close = (key: Buffer, fields: Fields, aad: string) => (Object.keys(fields).length ? seal(key, JSON.stringify(fields), aad) : null);

const rows = (db: Db) => db.prepare('SELECT * FROM services ORDER BY position, id').all() as unknown as Row[];
const getRow = (db: Db, id: number) => db.prepare('SELECT * FROM services WHERE id = ?').get(id) as unknown as Row | undefined;
const userRows = (db: Db, id: number) => db.prepare('SELECT user_id, secrets FROM service_users WHERE service_id = ? ORDER BY user_id').all(id) as { user_id: number; secrets: string | null }[];

export function listServices(db: Db, key: Buffer): AdminService[] {
  return rows(db).map((r) => {
    const shared = open(key, r.secrets, aadShared(r.id));
    return {
      id: r.id,
      kind: r.kind,
      name: r.name,
      url: r.url,
      access: r.access,
      config: JSON.parse(r.config) as Config,
      secretsSet: Object.keys(shared.fields),
      unreadable: shared.unreadable,
      users: userRows(db, r.id).map((u) => {
        const own = open(key, u.secrets, aadUser(r.id, u.user_id));
        return { userId: u.user_id, secretsSet: Object.keys(own.fields), unreadable: own.unreadable };
      }),
    };
  });
}

export const getService = (db: Db, key: Buffer, id: number) => listServices(db, key).find((s) => s.id === id);

/** `{ field: value }` to set, `{ field: '' | null }` to clear; fields left out are kept. */
function patchFields(cur: Fields, patch: unknown, allowed: readonly string[], what: string): Fields {
  if (patch === undefined) return cur;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new HttpError(400, `${what} must be an object`);
  const out = { ...cur };
  for (const [k, v] of Object.entries(patch)) {
    if (!allowed.includes(k)) throw new HttpError(400, `${what}: ${k.slice(0, 40)} isn't a field here`);
    if (v === null || v === '') delete out[k];
    else if (typeof v === 'string' && v.length <= 4096) out[k] = v;
    else throw new HttpError(400, `${what}: ${k} must be text`);
  }
  return out;
}

function readConfig(kind: ServiceKind, cur: Config, patch: unknown): Config {
  if (patch === undefined) return cur;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new HttpError(400, 'config must be an object');
  const out = { ...cur };
  for (const [k, v] of Object.entries(patch)) {
    if (!spec(kind).config.includes(k)) throw new HttpError(400, `config: ${k.slice(0, 40)} isn't a setting here`);
    if (v === null || v === '') delete out[k];
    else if ((typeof v === 'string' && v.length <= 1024) || (typeof v === 'number' && Number.isFinite(v))) out[k] = v;
    else throw new HttpError(400, `config: ${k} must be text or a number`);
  }
  return out;
}

const readAccess = (v: unknown, def: Access): Access => {
  if (v === undefined) return def;
  if (!(ACCESS as readonly unknown[]).includes(v)) throw new HttpError(400, 'access must be everyone, admins or chosen');
  return v as Access;
};

function readUrl(v: unknown, kind: ServiceKind): string {
  const url = typeof v === 'string' ? v.trim().slice(0, 1024) : '';
  // yt-dlp runs on the device and only needs a folder; every other kind is a server
  if (kind !== 'ytdlp' && !/^https?:\/\/\S+$/i.test(url)) throw new HttpError(400, 'Server URL must start with http:// or https://');
  return url.replace(/\/+$/, '');
}

const readName = (v: unknown, kind: ServiceKind) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 60) : kind);

export function createService(db: Db, key: Buffer, b: Record<string, unknown>): AdminService {
  if (!isKind(b.kind)) throw new HttpError(400, `Kind must be one of ${Object.keys(KINDS).join(', ')}`);
  const kind = b.kind;
  const name = readName(b.name, kind);
  const url = readUrl(b.url, kind);
  const access = spec(kind).download ? 'admins' : readAccess(b.access, 'everyone');
  const config = readConfig(kind, {}, b.config);
  const secrets = patchFields({}, b.secrets, spec(kind).secrets, 'secrets');
  const id = tx(db, () => {
    if (spec(kind).download && rows(db).some((r) => r.kind === kind)) throw new HttpError(409, `The Hub already has ${kind} set up. Edit that one instead`);
    const now = Date.now();
    const { p } = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM services').get() as { p: number };
    const r = db
      .prepare('INSERT INTO services (kind, name, url, access, config, secrets, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)')
      .run(kind, name, url, access, JSON.stringify(config), p, now, now);
    const id = Number(r.lastInsertRowid);
    db.prepare('UPDATE services SET secrets = ? WHERE id = ?').run(close(key, secrets, aadShared(id)), id);
    return id;
  });
  return getService(db, key, id)!;
}

/** Returns the service and the names of the fields that changed (for the audit log; never values). */
export function updateService(db: Db, key: Buffer, id: number, b: Record<string, unknown>): { service: AdminService; changed: string[] } {
  const changed: string[] = [];
  tx(db, () => {
    const r = getRow(db, id);
    if (!r) throw new HttpError(404, 'No such server');
    const name = b.name === undefined ? r.name : readName(b.name, r.kind);
    const url = b.url === undefined ? r.url : readUrl(b.url, r.kind);
    const access = spec(r.kind).download ? 'admins' : readAccess(b.access, r.access);
    const config = readConfig(r.kind, JSON.parse(r.config) as Config, b.config);
    const cur = open(key, r.secrets, aadShared(id));
    // fields that can't be read any more are dropped rather than kept as junk
    const secrets = patchFields(cur.fields, b.secrets, spec(r.kind).secrets, 'secrets');
    if (name !== r.name) changed.push('name');
    if (url !== r.url) changed.push('url');
    if (access !== r.access) changed.push('access');
    if (JSON.stringify(config) !== r.config) changed.push('config');
    for (const k of spec(r.kind).secrets) if (cur.fields[k] !== secrets[k]) changed.push(k);
    db.prepare('UPDATE services SET name = ?, url = ?, access = ?, config = ?, secrets = ?, updated_at = ? WHERE id = ?').run(
      name, url, access, JSON.stringify(config), close(key, secrets, aadShared(id)), Date.now(), id,
    );
  });
  return { service: getService(db, key, id)!, changed };
}

export function deleteService(db: Db, id: number): Row {
  const r = getRow(db, id);
  if (!r) throw new HttpError(404, 'No such server');
  db.prepare('DELETE FROM services WHERE id = ?').run(id);
  return r;
}

/** Give someone access (for 'chosen'), and/or their own login. `secrets` follows patchFields. */
export function setServiceUser(db: Db, key: Buffer, id: number, userId: number, secretsPatch: unknown): AdminService {
  tx(db, () => {
    const r = getRow(db, id);
    if (!r) throw new HttpError(404, 'No such server');
    const cur = db.prepare('SELECT secrets FROM service_users WHERE service_id = ? AND user_id = ?').get(id, userId) as { secrets: string | null } | undefined;
    const own = patchFields(open(key, cur?.secrets ?? null, aadUser(id, userId)).fields, secretsPatch, spec(r.kind).own, 'secrets');
    db.prepare(
      `INSERT INTO service_users (service_id, user_id, secrets) VALUES (?, ?, ?)
       ON CONFLICT (service_id, user_id) DO UPDATE SET secrets = excluded.secrets`,
    ).run(id, userId, close(key, own, aadUser(id, userId)));
  });
  return getService(db, key, id)!;
}

export function removeServiceUser(db: Db, key: Buffer, id: number, userId: number): AdminService {
  if (!getRow(db, id)) throw new HttpError(404, 'No such server');
  db.prepare('DELETE FROM service_users WHERE service_id = ? AND user_id = ?').run(id, userId);
  return getService(db, key, id)!;
}

/**
 * The servers this person's devices may use, with the logins filled in. This is the only place a secret
 * leaves the Hub, so every rule about who gets what lives here.
 */
export function servicesFor(db: Db, key: Buffer, { user, permissions }: Auth): DeviceService[] {
  const out: DeviceService[] = [];
  for (const r of rows(db)) {
    const s = spec(r.kind);
    const mine = db.prepare('SELECT secrets FROM service_users WHERE service_id = ? AND user_id = ?').get(r.id, user.id) as { secrets: string | null } | undefined;
    const allowed = s.download
      ? permissions.includes('downloads.run')
      : r.access === 'everyone' || user.role === 'admin' || (r.access === 'chosen' && !!mine);
    if (!allowed) continue;
    const own = open(key, mine?.secrets ?? null, aadUser(r.id, user.id)).fields;
    const secrets = { ...open(key, r.secrets, aadShared(r.id)).fields, ...own };
    if (!permissions.includes('subwave.control')) for (const f of s.controlOnly ?? []) delete secrets[f];
    out.push({ id: r.id, kind: r.kind, name: r.name, url: r.url, config: JSON.parse(r.config) as Config, secrets, ownLogin: Object.keys(own).length > 0 });
  }
  return out;
}
