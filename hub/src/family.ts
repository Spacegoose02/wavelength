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
