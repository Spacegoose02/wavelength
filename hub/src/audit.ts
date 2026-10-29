import type { Db } from './db.ts';

export interface AuditEntry {
  id: number;
  at: number;
  actorId: number | null;
  actor: string | null;
  action: string;
  target: string | null;
  detail: unknown;
  ip: string | null;
}

/** Record who did what. Every admin change and every sign-in goes through here. Never log secrets. */
export function audit(db: Db, e: { actorId?: number | null; action: string; target?: string | null; detail?: unknown; ip?: string | null }) {
  db.prepare('INSERT INTO audit (at, actor_id, action, target, detail, ip) VALUES (?, ?, ?, ?, ?, ?)').run(
    Date.now(),
    e.actorId ?? null,
    e.action,
    e.target ?? null,
    e.detail === undefined ? null : JSON.stringify(e.detail),
    e.ip ?? null,
  );
}

export function listAudit(db: Db, limit: number, before?: number): AuditEntry[] {
  const rows = db
    .prepare(
      `SELECT a.*, u.username AS actor FROM audit a LEFT JOIN users u ON u.id = a.actor_id
       WHERE a.id < ? ORDER BY a.id DESC LIMIT ?`,
    )
    .all(before ?? Number.MAX_SAFE_INTEGER, limit) as { id: number; at: number; actor_id: number | null; actor: string | null; action: string; target: string | null; detail: string | null; ip: string | null }[];
  return rows.map((r) => ({
    id: r.id,
    at: r.at,
    actorId: r.actor_id,
    actor: r.actor,
    action: r.action,
    target: r.target,
    detail: r.detail ? JSON.parse(r.detail) : null,
    ip: r.ip,
  }));
}
