import type { Db } from './db.ts';
import { isRole, permissionsFor } from './roles.ts';

/**
 * Notifications (docs/USERS-AND-ADMIN.md §6.8): the Hub writes one when something happens that a person
 * would want to hear about away from the Inbox, and their devices fetch the new ones (routes/notifications.ts)
 * and show them as system notifications. The Inbox stays the place to act on them.
 */

export type NoticeKind = 'request.new' | 'request.ready' | 'request.rejected' | 'request.have' | 'request.failed' | 'share';

const KEEP_MS = 30 * 86_400_000;

export function notify(db: Db, userIds: number[], kind: NoticeKind, title: string, body: string, now = Date.now()) {
  const add = db.prepare('INSERT INTO notifications (user_id, kind, title, body, created_at) VALUES (?, ?, ?, ?, ?)');
  for (const id of new Set(userIds)) add.run(id, kind, title.slice(0, 200), body.slice(0, 400), now);
}

/** Tell whoever asked for a request what happened to it. */
export function notifyRequester(db: Db, requestId: number, kind: Exclude<NoticeKind, 'request.new' | 'share'>) {
  const r = db.prepare('SELECT user_id, title, artist, reason FROM requests WHERE id = ?').get(requestId) as
    { user_id: number; title: string; artist: string; reason: string | null } | undefined;
  if (!r) return;
  const what = r.artist ? `${r.title} by ${r.artist}` : r.title;
  const [title, body] = {
    'request.ready': ['Ready to play', `${what} is in the library`],
    'request.have': ['Already in the library', `${what} was there all along`],
    'request.rejected': ['Request not approved', r.reason ? `${what}: ${r.reason}` : what],
    'request.failed': ['Request didn’t download', r.reason ? `${what}: ${r.reason}` : what],
  }[kind];
  notify(db, [r.user_id], kind, title, body);
}

/** Everyone who can approve requests, except `but` (who made it). */
export function approvers(db: Db, but?: number): number[] {
  const users = db.prepare('SELECT id, role, autodownload FROM users WHERE disabled = 0').all() as { id: number; role: string; autodownload: number }[];
  return users
    .filter((u) => u.id !== but && isRole(u.role) && permissionsFor({ role: u.role, autodownload: !!u.autodownload }).includes('requests.approve'))
    .map((u) => u.id);
}

/** Everyone who can sign in, except `but`. */
export function everyone(db: Db, but: number): number[] {
  return (db.prepare('SELECT id FROM users WHERE disabled = 0 AND id != ?').all(but) as { id: number }[]).map((u) => u.id);
}

export interface Notice { id: number; kind: NoticeKind; title: string; body: string; createdAt: number }

/**
 * Yours after `after` (oldest first, at most 20), and your newest id: the device's next `after`. It can go
 * down (old ones pruned, a backup restored), which puts the device back in step.
 */
export function noticesAfter(db: Db, userId: number, after: number): { notifications: Notice[]; last: number } {
  const rows = db.prepare('SELECT id, kind, title, body, created_at FROM notifications WHERE user_id = ? AND id > ? ORDER BY id DESC LIMIT 20')
    .all(userId, after) as { id: number; kind: NoticeKind; title: string; body: string; created_at: number }[];
  const last = (db.prepare('SELECT MAX(id) AS n FROM notifications WHERE user_id = ?').get(userId) as { n: number | null }).n ?? 0;
  return { notifications: rows.reverse().map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, createdAt: r.created_at })), last };
}

export function pruneNotices(db: Db, now = Date.now()) {
  db.prepare('DELETE FROM notifications WHERE created_at < ?').run(now - KEEP_MS);
}
