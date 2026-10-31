import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { seal, unseal } from './crypto.ts';
import type { Db } from './db.ts';

/**
 * Two-step sign-in (RFC 6238 TOTP, the 6-digit codes from Google Authenticator, 1Password, Aegis…). Optional
 * for everyone and recommended for admins. Password sign-ins (the app, /link, linking SSO) then also need a
 * code, or one of ten single-use recovery codes. Single sign-on through tinyauth isn't affected: tinyauth has
 * its own. The secret is sealed like the other logins; recovery codes are kept only as hashes.
 */

const STEP = 30;
const DIGITS = 6;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function fromBase32(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The code for one 30-second step. */
export function totpAt(secret: Buffer, step: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', secret).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = (h.readUInt32BE(o) & 0x7fffffff) % 10 ** DIGITS;
  return String(n).padStart(DIGITS, '0');
}

/** The step a code matched (one step either side allowed for clock drift), or null. */
export function checkTotp(secret: Buffer, code: string, now = Date.now()): number | null {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const step = Math.floor(now / 1000 / STEP);
  for (const s of [step, step - 1, step + 1]) {
    if (timingSafeEqual(Buffer.from(totpAt(secret, s)), Buffer.from(c))) return s;
  }
  return null;
}

const aad = (userId: number) => `totp:${userId}`;
const hashCode = (c: string) => createHash('sha256').update(c.toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex');

interface Row { secret: string; enabled_at: number | null; last_step: number; recovery: string }

const row = (db: Db, userId: number) => db.prepare('SELECT secret, enabled_at, last_step, recovery FROM user_totp WHERE user_id = ?').get(userId) as Row | undefined;

export function totpEnabled(db: Db, userId: number): boolean {
  return !!row(db, userId)?.enabled_at;
}

/** Start setting it up: a new secret (not yet in force) and the otpauth:// link for a QR code. */
export function beginTotp(db: Db, key: Buffer, userId: number, label: string, issuer = 'Wavelength'): { secret: string; uri: string } {
  const secret = base32(randomBytes(20));
  db.prepare(`INSERT INTO user_totp (user_id, secret, enabled_at, last_step, recovery) VALUES (?, ?, NULL, 0, '[]')
    ON CONFLICT (user_id) DO UPDATE SET secret = excluded.secret, enabled_at = NULL, last_step = 0, recovery = '[]'`)
    .run(userId, seal(key, secret, aad(userId)));
  const uri = `otpauth://totp/${encodeURIComponent(`${issuer}:${label}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=${DIGITS}&period=${STEP}`;
  return { secret, uri };
}

/** Turn it on with a first code from the app; returns the recovery codes (shown once). Null if the code is wrong. */
export function enableTotp(db: Db, key: Buffer, userId: number, code: string, now = Date.now()): string[] | null {
  const r = row(db, userId);
  if (!r || r.enabled_at) return null;
  const step = checkTotp(fromBase32(unseal(key, r.secret, aad(userId))), code, now);
  if (step === null) return null;
  const codes = Array.from({ length: 10 }, () => base32(randomBytes(5)).replace(/(.{4})(.{4})/, '$1-$2'));
  db.prepare('UPDATE user_totp SET enabled_at = ?, last_step = ?, recovery = ? WHERE user_id = ?').run(now, step, JSON.stringify(codes.map(hashCode)), userId);
  return codes;
}

/**
 * A sign-in's second step: a current code (not one already used) or a recovery code, which is then spent.
 * True when the person has no two-step sign-in at all.
 */
export function passTotp(db: Db, key: Buffer, userId: number, code: string | undefined, now = Date.now()): boolean {
  const r = row(db, userId);
  if (!r?.enabled_at) return true;
  if (!code) return false;
  const step = checkTotp(fromBase32(unseal(key, r.secret, aad(userId))), code, now);
  if (step !== null) {
    if (step <= r.last_step) return false; // the same code twice: someone watching
    db.prepare('UPDATE user_totp SET last_step = ? WHERE user_id = ?').run(step, userId);
    return true;
  }
  const left = JSON.parse(r.recovery) as string[];
  const h = hashCode(code);
  if (!left.includes(h)) return false;
  db.prepare('UPDATE user_totp SET recovery = ? WHERE user_id = ?').run(JSON.stringify(left.filter((x) => x !== h)), userId);
  return true;
}

export function recoveryLeft(db: Db, userId: number): number {
  const r = row(db, userId);
  return r?.enabled_at ? (JSON.parse(r.recovery) as string[]).length : 0;
}

export function disableTotp(db: Db, userId: number): boolean {
  return db.prepare('DELETE FROM user_totp WHERE user_id = ?').run(userId).changes > 0;
}
