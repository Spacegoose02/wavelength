import { createHash, createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
// ~64 MiB, OWASP's scrypt baseline. Stored with the hash so it can be raised later.
const N = 2 ** 16, r = 8, p = 1, KEYLEN = 32;
const SCRYPT_OPTS = { N, r, p, maxmem: 128 * N * r * 2 };

/** `scrypt$N$r$p$salt$hash` (base64). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEYLEN, SCRYPT_OPTS);
  return ['scrypt', N, r, p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [kind, n, rr, pp, salt, hash] = stored.split('$');
  if (kind !== 'scrypt') return false;
  const N = Number(n), r = Number(rr), p = Number(pp);
  const expected = Buffer.from(hash, 'base64');
  const got = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length, { N, r, p, maxmem: 128 * N * r * 2 });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** A hash to compare against when the user doesn't exist, so login takes the same time either way. */
export const DUMMY_HASH = 'scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

export const newToken = (prefix: string) => prefix + randomBytes(32).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const hmac = (key: Buffer, s: string) => createHmac('sha256', key).update(s).digest('base64url');

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// No 0/O/1/I/L/U: easy to read off a TV and type on a phone.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
/** e.g. `KQ7M-X2PD` */
export function userCode(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
export const normalizeUserCode = (s: string) => {
  const c = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
};
