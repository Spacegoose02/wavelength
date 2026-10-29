import type { Db } from './db.ts';
import { tx } from './db.ts';
import { newToken, sha256, userCode } from './crypto.ts';
import { createDevice, type Device } from './devices.ts';

/**
 * Device pairing (docs/USERS-AND-ADMIN.md §3): the app asks for a code, shows it (and a QR code), the
 * person approves it in a browser where they're signed in (tinyauth or a Hub password), and the app,
 * polling with its secret device code, receives its own device token.
 */
export const PAIRING_TTL_MS = 10 * 60_000;
export const POLL_INTERVAL_S = 3;

export interface Pairing {
  id: number;
  userCode: string;
  deviceName: string;
  platform: string;
  status: 'pending' | 'approved' | 'denied';
  userId: number | null;
  expiresAt: number;
}

interface PairingRow {
  id: number;
  user_code: string;
  device_name: string;
  platform: string;
  status: Pairing['status'];
  user_id: number | null;
  expires_at: number;
}

const toPairing = (r: PairingRow): Pairing => ({
  id: r.id,
  userCode: r.user_code,
  deviceName: r.device_name,
  platform: r.platform,
  status: r.status,
  userId: r.user_id,
  expiresAt: r.expires_at,
});

function sweep(db: Db) {
  db.prepare('DELETE FROM pairings WHERE expires_at < ?').run(Date.now());
}

export function startPairing(db: Db, deviceName: string, platform: string) {
  sweep(db);
  const deviceCode = newToken('wlp_');
  const now = Date.now();
  // user codes are unique among live pairings; retry on the rare clash
  for (let i = 0; ; i++) {
    const code = userCode();
    try {
      db.prepare(
        `INSERT INTO pairings (device_code_hash, user_code, device_name, platform, status, created_at, expires_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
      ).run(sha256(deviceCode), code, deviceName, platform, now, now + PAIRING_TTL_MS);
      return { deviceCode, userCode: code, expiresAt: now + PAIRING_TTL_MS };
    } catch (e) {
      if (i > 5) throw e;
    }
  }
}

/** A live, pending pairing by the code the person typed. */
export function pendingPairing(db: Db, code: string): Pairing | undefined {
  const r = db.prepare("SELECT * FROM pairings WHERE user_code = ? AND status = 'pending' AND expires_at > ?").get(code, Date.now()) as
    | PairingRow
    | undefined;
  return r && toPairing(r);
}

export function decidePairing(db: Db, id: number, userId: number, approve: boolean): boolean {
  const res = db
    .prepare("UPDATE pairings SET status = ?, user_id = ? WHERE id = ? AND status = 'pending' AND expires_at > ?")
    .run(approve ? 'approved' : 'denied', userId, id, Date.now());
  return res.changes === 1;
}

export type PollResult =
  | { status: 'pending' | 'denied' | 'expired' }
  | { status: 'approved'; token: string; device: Device; userId: number };

/** The app's poll. On approval this creates the device once and forgets the pairing. */
export function pollPairing(db: Db, deviceCode: string): PollResult {
  return tx(db, () => {
    const r = db.prepare('SELECT * FROM pairings WHERE device_code_hash = ?').get(sha256(deviceCode)) as PairingRow | undefined;
    if (!r || r.expires_at < Date.now()) return { status: 'expired' };
    if (r.status === 'pending') return { status: 'pending' };
    db.prepare('DELETE FROM pairings WHERE id = ?').run(r.id);
    if (r.status === 'denied' || r.user_id === null) return { status: 'denied' };
    const { device, token } = createDevice(db, r.user_id, r.device_name, r.platform);
    return { status: 'approved', token, device, userId: r.user_id };
  });
}
