import type { Db } from './db.ts';
import { tx } from './db.ts';
import { HttpError } from './http.ts';

/**
 * Per-user preferences synced between devices (skin, EQ, saved stations, playlists, history …).
 * Each key is last-writer-wins on its own `updatedAt`, so two devices editing different settings
 * never overwrite each other. A null value means "unset".
 */
export const PREF_KEY_RE = /^[a-zA-Z0-9._-]{1,64}$/;
export const MAX_VALUE_BYTES = 256 * 1024;
export const MAX_KEYS = 200;

export type Prefs = Record<string, { value: unknown; updatedAt: number }>;

export function getPrefs(db: Db, userId: number): Prefs {
  const rows = db.prepare('SELECT key, value, updated_at FROM prefs WHERE user_id = ?').all(userId) as { key: string; value: string; updated_at: number }[];
  return Object.fromEntries(rows.map((r) => [r.key, { value: JSON.parse(r.value), updatedAt: r.updated_at }]));
}

/** Apply changes newer than what's stored. Returns the keys that lost to a newer stored value. */
export function putPrefs(db: Db, userId: number, changes: unknown): { applied: string[]; stale: string[] } {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new HttpError(400, 'Send { changes: { key: { value, updatedAt } } }');
  const entries = Object.entries(changes as Record<string, unknown>);
  const now = Date.now();
  const parsed = entries.map(([key, c]) => {
    if (!PREF_KEY_RE.test(key)) throw new HttpError(400, `Bad preference key: ${key.slice(0, 64)}`);
    const { value, updatedAt } = (c ?? {}) as { value?: unknown; updatedAt?: unknown };
    if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) throw new HttpError(400, `${key}: updatedAt must be a timestamp`);
    const json = JSON.stringify(value ?? null);
    if (Buffer.byteLength(json) > MAX_VALUE_BYTES) throw new HttpError(413, `${key} is too large`);
    // A device with its clock in the future would otherwise win every later edit.
    return { key, json, at: Math.min(updatedAt, now) };
  });
  return tx(db, () => {
    const applied: string[] = [];
    const stale: string[] = [];
    const get = db.prepare('SELECT updated_at FROM prefs WHERE user_id = ? AND key = ?');
    const put = db.prepare(
      `INSERT INTO prefs (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    );
    for (const p of parsed) {
      const cur = get.get(userId, p.key) as { updated_at: number } | undefined;
      if (cur && cur.updated_at > p.at) {
        stale.push(p.key);
        continue;
      }
      put.run(userId, p.key, p.json, p.at);
      applied.push(p.key);
    }
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM prefs WHERE user_id = ?').get(userId) as { n: number };
    if (n > MAX_KEYS) throw new HttpError(413, `At most ${MAX_KEYS} preference keys per user`);
    return { applied, stale };
  });
}
