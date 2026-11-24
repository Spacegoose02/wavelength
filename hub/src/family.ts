import type { Db } from './db.ts';

/**
 * Parents (docs/USERS-AND-ADMIN.md): an admin can make any grown-up account a parent of a kid. Parents get
 * that kid's requests to approve (routes/requests.ts), even without being admins, and the kid's weekly report
 * (digests.ts). A kid can have several parents; a parent several kids.
 */

export function guardiansOf(db: Db, kidId: number): number[] {
  return (db.prepare('SELECT guardian_id FROM guardians WHERE kid_id = ? ORDER BY guardian_id').all(kidId) as { guardian_id: number }[]).map((r) => r.guardian_id);
}

export function kidsOf(db: Db, guardianId: number): number[] {
  return (db.prepare('SELECT kid_id FROM guardians WHERE guardian_id = ? ORDER BY kid_id').all(guardianId) as { kid_id: number }[]).map((r) => r.kid_id);
}

export function isGuardian(db: Db, guardianId: number, kidId: number): boolean {
  return !!db.prepare('SELECT 1 FROM guardians WHERE guardian_id = ? AND kid_id = ?').get(guardianId, kidId);
}

export function setGuardians(db: Db, kidId: number, guardianIds: number[]) {
  db.prepare('DELETE FROM guardians WHERE kid_id = ?').run(kidId);
  const add = db.prepare('INSERT OR IGNORE INTO guardians (kid_id, guardian_id) VALUES (?, ?)');
  for (const g of guardianIds) add.run(kidId, g);
}

/**
 * Switching PIN hashes (routes/families.ts `/api/me/switch-pin`) of this kid's parents who set one and aren't
 * turned off. Any of them lets a device leave the kid's profile (routes/kids.ts `/api/kid/unlock`), so a parent
 * can hand a shared device to their kid without an admin setting a grown-up PIN first.
 */
export function parentPinHashes(db: Db, kidId: number): string[] {
  return (db.prepare(`SELECT u.switch_pin FROM guardians g JOIN users u ON u.id = g.guardian_id
    WHERE g.kid_id = ? AND u.switch_pin IS NOT NULL AND u.disabled = 0 AND u.role <> 'kid' ORDER BY g.guardian_id`).all(kidId) as { switch_pin: string }[]).map((r) => r.switch_pin);
}
