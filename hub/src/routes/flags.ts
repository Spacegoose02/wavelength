import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import { clientIp, HttpError, need, signedIn, str } from '../http.ts';

/**
 * Kid-safe flags (docs/USERS-AND-ADMIN.md §6.5). Admins mark a song, album or artist as not for kids, or
 * mark something explicit as fine for them. Every device fetches the list; the app hides flagged and
 * explicit music on kid profiles.
 */

const KINDS = ['track', 'album', 'artist'];

interface Row { id: number; kind: string; artist: string; title: string; verdict: string; set_by_name: string | null; created_at: number }
const toFlag = (r: Row) => ({ id: r.id, kind: r.kind, artist: r.artist, title: r.title, verdict: r.verdict, setBy: r.set_by_name, createdAt: r.created_at });

export function flagRoutes(app: FastifyInstance, { db }: Ctx) {
  const SELECT = 'SELECT f.*, u.display_name AS set_by_name FROM content_flags f LEFT JOIN users u ON u.id = f.set_by';

  app.get('/api/flags', async (req) => {
    signedIn(req);
    return { flags: (db.prepare(`${SELECT} ORDER BY f.created_at DESC`).all() as unknown as Row[]).map(toFlag) };
  });

  /** `{ kind, artist, title?, verdict: 'block' | 'allow' }`; setting the same item again replaces its verdict. */
  app.post('/api/admin/flags', async (req) => {
    const { user } = need(req, 'library.edit');
    const b = req.body;
    const kind = str(b, 'kind', 10);
    if (!KINDS.includes(kind)) throw new HttpError(400, 'kind is track, album or artist');
    const verdict = str(b, 'verdict', 10);
    if (verdict !== 'block' && verdict !== 'allow') throw new HttpError(400, "verdict is 'block' or 'allow'");
    const artist = str(b, 'artist', 300);
    const title = kind === 'artist' ? '' : str(b, 'title', 300);
    if (!artist || (kind !== 'artist' && !title)) throw new HttpError(400, kind === 'artist' ? 'Send the artist' : 'Send the artist and title');
    db.prepare(`INSERT INTO content_flags (kind, artist, title, verdict, set_by, created_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (kind, artist COLLATE NOCASE, title COLLATE NOCASE) DO UPDATE SET verdict = excluded.verdict, set_by = excluded.set_by, created_at = excluded.created_at`)
      .run(kind, artist, title, verdict, user.id, Date.now());
    const r = db.prepare(`${SELECT} WHERE f.kind = ? AND f.artist = ? COLLATE NOCASE AND f.title = ? COLLATE NOCASE`).get(kind, artist, title) as unknown as Row;
    audit(db, { actorId: user.id, action: verdict === 'block' ? 'kids.blocked' : 'kids.allowed', target: `${kind}: ${artist}${title ? ` – ${title}` : ''}`, ip: clientIp(req) });
    return { flag: toFlag(r) };
  });

  app.delete<{ Params: { id: string } }>('/api/admin/flags/:id', async (req) => {
    const { user } = need(req, 'library.edit');
    const r = db.prepare('SELECT * FROM content_flags WHERE id = ?').get(Number(req.params.id)) as Row | undefined;
    if (!r) throw new HttpError(404, 'No such flag');
    db.prepare('DELETE FROM content_flags WHERE id = ?').run(r.id);
    audit(db, { actorId: user.id, action: 'kids.unflagged', target: `${r.kind}: ${r.artist}${r.title ? ` – ${r.title}` : ''}`, ip: clientIp(req) });
    return { ok: true };
  });
}
