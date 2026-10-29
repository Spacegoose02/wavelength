import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import { clientIp, HttpError, signedIn, str } from '../http.ts';

/**
 * Sharing between people on the Hub: a playlist, album, song, artist, radio station or a whole favorites
 * list, sent to one person or to everyone. The Hub keeps a snapshot (the track list, or the station), so
 * the other person's app can play it from their own sources and save it as a playlist.
 */

export const SHARE_KINDS = ['playlist', 'album', 'track', 'artist', 'station', 'favorites'] as const;
const MAX_PAYLOAD = 512 * 1024;

interface Row {
  id: number; from_user: number; to_user: number | null; kind: string; title: string; subtitle: string | null; cover: string | null;
  note: string | null; payload: string; created_at: number; from_name: string; from_username: string; to_name: string | null;
  seen: number | null;
}

const toShare = (r: Row) => ({
  id: r.id, kind: r.kind, title: r.title, subtitle: r.subtitle, cover: r.cover, note: r.note,
  payload: JSON.parse(r.payload) as unknown, createdAt: r.created_at,
  from: { id: r.from_user, displayName: r.from_name, username: r.from_username },
  to: r.to_user === null ? null : { id: r.to_user, displayName: r.to_name ?? '' },
  seen: !!r.seen,
});

export function shareRoutes(app: FastifyInstance, { db }: Ctx) {
  const SELECT = `SELECT s.*, f.display_name AS from_name, f.username AS from_username, t.display_name AS to_name, v.user_id AS seen
    FROM shares s JOIN users f ON f.id = s.from_user LEFT JOIN users t ON t.id = s.to_user
    LEFT JOIN share_seen v ON v.share_id = s.id AND v.user_id = ?`;

  /** Who you can share with: everyone else who can sign in. */
  app.get('/api/people', async (req) => {
    const { user } = signedIn(req);
    const people = db.prepare('SELECT id, username, display_name, role FROM users WHERE disabled = 0 AND id != ? ORDER BY display_name COLLATE NOCASE')
      .all(user.id) as { id: number; username: string; display_name: string; role: string }[];
    return { people: people.map((p) => ({ id: p.id, username: p.username, displayName: p.display_name, kid: p.role === 'kid' })) };
  });

  /** `{ to: userId | null (everyone), kind, title, subtitle?, cover?, note?, payload }` */
  app.post('/api/shares', async (req) => {
    const { user } = signedIn(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const kind = str(b, 'kind', 20);
    if (!(SHARE_KINDS as readonly string[]).includes(kind)) throw new HttpError(400, `kind is one of ${SHARE_KINDS.join(', ')}`);
    const title = str(b, 'title', 200);
    if (!title) throw new HttpError(400, 'Send a title');
    let to: number | null = null;
    if (b.to !== null && b.to !== undefined) {
      to = Number(b.to);
      if (to === user.id) throw new HttpError(400, 'Share with someone else');
      const ok = db.prepare('SELECT 1 FROM users WHERE id = ? AND disabled = 0').get(to);
      if (!ok) throw new HttpError(404, 'No such person');
    }
    if (!b.payload || typeof b.payload !== 'object') throw new HttpError(400, 'Send what you are sharing');
    const payload = JSON.stringify(b.payload);
    if (payload.length > MAX_PAYLOAD) throw new HttpError(413, 'That is too big to share. Try a shorter playlist');
    const { lastInsertRowid } = db
      .prepare('INSERT INTO shares (from_user, to_user, kind, title, subtitle, cover, note, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(user.id, to, kind, title, str(b, 'subtitle', 300) || null, str(b, 'cover', 1000) || null, str(b, 'note', 500) || null, payload, Date.now());
    audit(db, { actorId: user.id, action: 'share.sent', target: `${kind}: ${title}`, detail: { to: to ?? 'everyone' }, ip: clientIp(req) });
    const r = db.prepare(`${SELECT} WHERE s.id = ?`).get(user.id, Number(lastInsertRowid)) as unknown as Row;
    return { share: toShare(r) };
  });

  /** Shared with you (newest first), or `?sent=1` for what you shared. */
  app.get('/api/shares', async (req) => {
    const { user } = signedIn(req);
    const sent = str(req.query, 'sent', 5) === '1';
    const rows = (sent
      ? db.prepare(`${SELECT} WHERE s.from_user = ? ORDER BY s.created_at DESC LIMIT 200`).all(user.id, user.id)
      : db.prepare(`${SELECT} WHERE s.from_user != ? AND (s.to_user = ? OR s.to_user IS NULL)
          AND NOT EXISTS (SELECT 1 FROM share_seen h WHERE h.share_id = s.id AND h.user_id = ? AND h.hidden = 1)
          ORDER BY s.created_at DESC LIMIT 200`).all(user.id, user.id, user.id, user.id)) as unknown as Row[];
    return { shares: rows.map(toShare) };
  });

  app.get('/api/shares/counts', async (req) => {
    const { user } = signedIn(req);
    const { n } = db.prepare(`SELECT COUNT(*) AS n FROM shares s WHERE s.from_user != ? AND (s.to_user = ? OR s.to_user IS NULL)
      AND NOT EXISTS (SELECT 1 FROM share_seen v WHERE v.share_id = s.id AND v.user_id = ?)`).get(user.id, user.id, user.id) as { n: number };
    return { unseen: n };
  });

  const visible = (shareId: number, userId: number) => {
    const s = db.prepare('SELECT id FROM shares WHERE id = ? AND from_user != ? AND (to_user = ? OR to_user IS NULL)').get(shareId, userId, userId);
    if (!s) throw new HttpError(404, 'No such share');
  };

  /** Mark shares as seen: `{ ids }`, or all of them when no ids are sent. */
  app.post('/api/shares/seen', async (req) => {
    const { user } = signedIn(req);
    const ids = (req.body as { ids?: unknown } | null)?.ids;
    const mark = db.prepare('INSERT OR IGNORE INTO share_seen (share_id, user_id) VALUES (?, ?)');
    if (Array.isArray(ids)) {
      for (const id of ids.slice(0, 500)) if (typeof id === 'number') {
        try { visible(id, user.id); mark.run(id, user.id); } catch { /* not yours: skip */ }
      }
    } else {
      db.prepare(`INSERT OR IGNORE INTO share_seen (share_id, user_id)
        SELECT id, ? FROM shares WHERE from_user != ? AND (to_user = ? OR to_user IS NULL)`).run(user.id, user.id, user.id);
    }
    return { ok: true };
  });

  /** Take it off your list (it stays for everyone else). */
  app.post<{ Params: { id: string } }>('/api/shares/:id/hide', async (req) => {
    const { user } = signedIn(req);
    const id = Number(req.params.id);
    visible(id, user.id);
    db.prepare(`INSERT INTO share_seen (share_id, user_id, hidden) VALUES (?, ?, 1)
      ON CONFLICT (share_id, user_id) DO UPDATE SET hidden = 1`).run(id, user.id);
    return { ok: true };
  });

  /** Unshare: the sender, or an admin. */
  app.delete<{ Params: { id: string } }>('/api/shares/:id', async (req) => {
    const { user, permissions } = signedIn(req);
    const s = db.prepare('SELECT from_user, kind, title FROM shares WHERE id = ?').get(Number(req.params.id)) as { from_user: number; kind: string; title: string } | undefined;
    if (!s || (s.from_user !== user.id && !permissions.includes('users.manage'))) throw new HttpError(404, 'No such share');
    db.prepare('DELETE FROM shares WHERE id = ?').run(Number(req.params.id));
    audit(db, { actorId: user.id, action: 'share.removed', target: `${s.kind}: ${s.title}`, ip: clientIp(req) });
    return { ok: true };
  });
}
