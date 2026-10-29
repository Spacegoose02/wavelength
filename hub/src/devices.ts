import type { Db } from './db.ts';
import { newToken, sha256 } from './crypto.ts';

/** A signed-in app install. Each one has its own token, so it can be signed out on its own. */
export interface Device {
  id: number;
  userId: number;
  name: string;
  platform: string;
  createdAt: number;
  lastSeenAt: number;
}

interface DeviceRow {
  id: number;
  user_id: number;
  name: string;
  platform: string;
  created_at: number;
  last_seen_at: number;
}

const toDevice = (r: DeviceRow): Device => ({
  id: r.id,
  userId: r.user_id,
  name: r.name,
  platform: r.platform,
  createdAt: r.created_at,
  lastSeenAt: r.last_seen_at,
});

export const TOKEN_PREFIX = 'wlh_';
// Writing last_seen on every request would make each read a write; once a minute is plenty.
const SEEN_EVERY_MS = 60_000;

export function createDevice(db: Db, userId: number, name: string, platform: string): { device: Device; token: string } {
  const token = newToken(TOKEN_PREFIX);
  const now = Date.now();
  const res = db
    .prepare('INSERT INTO devices (user_id, name, platform, token_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, name, platform, sha256(token), now, now);
  const device = toDevice(db.prepare('SELECT * FROM devices WHERE id = ?').get(Number(res.lastInsertRowid)) as unknown as DeviceRow);
  return { device, token };
}

/** The live device for a token, or undefined if it's unknown or signed out. */
export function deviceForToken(db: Db, token: string): Device | undefined {
  if (!token.startsWith(TOKEN_PREFIX)) return undefined;
  const r = db.prepare('SELECT * FROM devices WHERE token_hash = ? AND revoked_at IS NULL').get(sha256(token)) as DeviceRow | undefined;
  if (!r) return undefined;
  const now = Date.now();
  if (now - r.last_seen_at > SEEN_EVERY_MS) db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(now, r.id);
  return toDevice({ ...r, last_seen_at: now });
}

export function listDevices(db: Db, userId?: number): Device[] {
  const rows = userId === undefined
    ? db.prepare('SELECT * FROM devices WHERE revoked_at IS NULL ORDER BY last_seen_at DESC').all()
    : db.prepare('SELECT * FROM devices WHERE revoked_at IS NULL AND user_id = ? ORDER BY last_seen_at DESC').all(userId);
  return (rows as unknown as DeviceRow[]).map(toDevice);
}

export function getDevice(db: Db, id: number): Device | undefined {
  const r = db.prepare('SELECT * FROM devices WHERE id = ? AND revoked_at IS NULL').get(id) as DeviceRow | undefined;
  return r && toDevice(r);
}

export function revokeDevice(db: Db, id: number) {
  db.prepare('UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(Date.now(), id);
}

export function revokeUserDevices(db: Db, userId: number) {
  db.prepare('UPDATE devices SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(Date.now(), userId);
}
