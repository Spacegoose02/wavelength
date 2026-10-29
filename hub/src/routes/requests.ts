import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import type { Db } from '../db.ts';
import { clientIp, HttpError, need, signedIn, str, type Auth } from '../http.ts';
import { deemixJobIds } from '../library.ts';
import { hubSlskd } from '../slskd.ts';
import { hubDeemix, hubYtSettings, isDeezerLink } from './proxy.ts';
import { readFiles } from './slskd.ts';

/**
 * Music requests (docs/USERS-AND-ADMIN.md §6.3). Anyone with `requests.create` asks for a song, album,
 * playlist or artist; an admin (`requests.approve`) approves it, which makes the Hub download it with
 * deemix (Deezer links) or yt-dlp (anything else), rejects it with a reason, or marks it as already in the
 * library. People with Autodownload skip the queue: their requests are approved straight away.
 */

export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'have' | 'failed';

export interface MusicRequest {
  id: number;
  userId: number;
  username: string;
  displayName: string;
  link: string;
  kind: string;
  title: string;
  artist: string;
  cover: string | null;
  note: string | null;
  status: RequestStatus;
  reason: string | null;
  via: string | null;
  decidedBy: string | null;
  createdAt: number;
  decidedAt: number | null;
  /** The download finished. */
  downloadedAt: number | null;
  /** In the library: Navidrome scanned it in ("your song is ready"). */
  readyAt: number | null;
  seen: boolean;
}

interface Row {
  id: number; user_id: number; username: string; display_name: string; link: string; kind: string; title: string; artist: string;
  cover: string | null; note: string | null; status: RequestStatus; reason: string | null; via: string | null; decider: string | null;
  created_at: number; decided_at: number | null; downloaded_at: number | null; ready_at: number | null; seen: number;
}

const SELECT = `SELECT r.*, u.username, u.display_name, d.display_name AS decider
  FROM requests r JOIN users u ON u.id = r.user_id LEFT JOIN users d ON d.id = r.decided_by`;

const toRequest = (r: Row): MusicRequest => ({
  id: r.id, userId: r.user_id, username: r.username, displayName: r.display_name, link: r.link, kind: r.kind,
  title: r.title, artist: r.artist, cover: r.cover, note: r.note, status: r.status, reason: r.reason, via: r.via,
  decidedBy: r.decider, createdAt: r.created_at, decidedAt: r.decided_at, downloadedAt: r.downloaded_at, readyAt: r.ready_at, seen: !!r.seen,
});

const getRequest = (db: Db, id: number) => {
  const r = db.prepare(`${SELECT} WHERE r.id = ?`).get(id) as Row | undefined;
  return r && toRequest(r);
};

const KINDS = ['track', 'album', 'playlist', 'artist', 'video'];

export function requestRoutes(app: FastifyInstance, { db, config, ytdlp, library }: Ctx) {
  const key = config.secretKey;

  /**
   * Hand an approved request to deemix or yt-dlp. Returns how, and which download to follow (library.ts),
   * or throws with what went wrong.
   */
  async function download(r: MusicRequest, bitrate?: number, slskd?: { username: string; files: { filename: string; size: number }[] }): Promise<{ via: string; job: string | null }> {
    library.activity();
    // an admin picked a folder on Soulseek for it
    if (slskd) {
      await hubSlskd(db, key).client.download(slskd.username, slskd.files);
      library.slskdActivity();
      return { via: 'slskd', job: JSON.stringify({ username: slskd.username, files: slskd.files.map((f) => f.filename) }) };
    }
    if (isDeezerLink(r.link)) {
      const { s, client } = hubDeemix(db, key);
      const answer = await client.addToQueue(r.link, bitrate ?? (Number(s.config.bitrate) || 9));
      const ids = deemixJobIds(answer);
      return { via: 'deemix', job: ids.length ? JSON.stringify(ids) : null };
    }
    // the job shows in the requester's own yt-dlp list
    const job = ytdlp.start({ id: r.userId, username: r.username }, { url: r.link, title: r.title, channel: r.artist }, hubYtSettings(db, key));
    return { via: 'yt-dlp', job: `yt:${job.jobId}` };
  }

  /** Approve: download it, then record how it went. A failed download is kept as 'failed' with the reason. */
  async function approve(r: MusicRequest, by: Auth['user'], ip: string, bitrate?: number, slskd?: Parameters<typeof download>[2]): Promise<MusicRequest> {
    let status: RequestStatus = 'approved', via: string | null = null, job: string | null = null, reason: string | null = null;
    try {
      ({ via, job } = await download(r, bitrate, slskd));
    } catch (e) {
      status = 'failed';
      reason = (e as Error).message.slice(0, 300);
    }
    db.prepare('UPDATE requests SET status = ?, via = ?, job = ?, downloaded_at = NULL, ready_at = NULL, reason = ?, decided_by = ?, decided_at = ?, seen = ? WHERE id = ?')
      .run(status, via, job, reason, by.id, Date.now(), by.id === r.userId ? 1 : 0, r.id);
    audit(db, { actorId: by.id, action: status === 'approved' ? 'request.approved' : 'request.failed', target: `${r.artist} – ${r.title}`, detail: { for: r.username, via, reason }, ip });
    return getRequest(db, r.id)!;
  }

  app.post('/api/requests', async (req) => {
    const auth = need(req, 'requests.create');
    const b = (req.body ?? {}) as Record<string, unknown>;
    const link = str(b, 'link', 1000);
    if (!/^https?:\/\/\S+$/i.test(link)) throw new HttpError(400, 'Send the link to the song, album or video');
    const title = str(b, 'title', 300);
    if (!title) throw new HttpError(400, 'Send a title');
    const kind = KINDS.includes(str(b, 'kind', 20)) ? str(b, 'kind', 20) : isDeezerLink(link) ? 'track' : 'video';
    // asking twice for the same thing just returns the open request
    const open = db.prepare(`${SELECT} WHERE r.user_id = ? AND r.link = ? AND r.status = 'pending'`).get(auth.user.id, link) as Row | undefined;
    if (open) return { request: toRequest(open) };
    const { lastInsertRowid } = db
      .prepare('INSERT INTO requests (user_id, link, kind, title, artist, cover, note, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(auth.user.id, link, kind, title, str(b, 'artist', 300), str(b, 'cover', 1000) || null, str(b, 'note', 500) || null, 'pending', Date.now());
    let r = getRequest(db, Number(lastInsertRowid))!;
    audit(db, { actorId: auth.user.id, action: 'request.created', target: `${r.artist} – ${r.title}`, detail: { link, kind }, ip: clientIp(req) });
    // Autodownload (and admins): no queue
    if (auth.permissions.includes('downloads.run')) r = await approve(r, auth.user, clientIp(req));
    return { request: r };
  });

  /** Your requests, newest first. */
  app.get('/api/requests', async (req) => {
    const { user } = signedIn(req);
    const rows = db.prepare(`${SELECT} WHERE r.user_id = ? ORDER BY r.created_at DESC LIMIT 200`).all(user.id) as unknown as Row[];
    return { requests: rows.map(toRequest) };
  });

  /** Numbers for the badge: your decisions you haven't seen, and (admins) requests waiting. */
  app.get('/api/requests/counts', async (req) => {
    const { user, permissions } = signedIn(req);
    const n = (sql: string, ...args: (string | number)[]) => (db.prepare(sql).get(...args) as { n: number }).n;
    return {
      unseen: n('SELECT COUNT(*) AS n FROM requests WHERE user_id = ? AND seen = 0', user.id),
      pending: permissions.includes('requests.approve') ? n("SELECT COUNT(*) AS n FROM requests WHERE status = 'pending'") : 0,
    };
  });

  app.post('/api/requests/seen', async (req) => {
    const { user } = signedIn(req);
    db.prepare('UPDATE requests SET seen = 1 WHERE user_id = ?').run(user.id);
    return { ok: true };
  });

  /** Cancel your own request while it's still waiting. */
  app.delete<{ Params: { id: string } }>('/api/requests/:id', async (req) => {
    const { user } = signedIn(req);
    const r = getRequest(db, Number(req.params.id));
    if (!r || r.userId !== user.id) throw new HttpError(404, 'No such request');
    if (r.status !== 'pending') throw new HttpError(409, 'Only a waiting request can be cancelled');
    db.prepare('DELETE FROM requests WHERE id = ?').run(r.id);
    return { ok: true };
  });

  // ---- the admin queue ----

  app.get('/api/admin/requests', async (req) => {
    need(req, 'requests.approve');
    const status = str(req.query, 'status', 20);
    const rows = (status
      ? db.prepare(`${SELECT} WHERE r.status = ? ORDER BY r.created_at DESC LIMIT 300`).all(status)
      : db.prepare(`${SELECT} ORDER BY (r.status = 'pending') DESC, r.created_at DESC LIMIT 300`).all()) as unknown as Row[];
    return { requests: rows.map(toRequest) };
  });

  const decided = (id: number) => {
    const r = getRequest(db, id);
    if (!r) throw new HttpError(404, 'No such request');
    return r;
  };

  /**
   * Download it. `{ bitrate? }` for Deezer: 9 FLAC, 3 MP3 320, 1 MP3 128. `{ slskd: { username, files } }`
   * downloads a folder picked on Soulseek instead. Also retries a failed one.
   */
  app.post<{ Params: { id: string } }>('/api/admin/requests/:id/approve', async (req) => {
    const { user } = need(req, 'requests.approve');
    const r = decided(Number(req.params.id));
    const b = (req.body ?? {}) as { bitrate?: unknown; slskd?: { username?: unknown; files?: unknown } };
    const slskd = b.slskd ? { username: str(b.slskd, 'username', 100), files: readFiles(b.slskd.files) } : undefined;
    if (slskd && !slskd.username) throw new HttpError(400, 'Whose files?');
    return { request: await approve(r, user, clientIp(req), typeof b.bitrate === 'number' && [1, 3, 9].includes(b.bitrate) ? b.bitrate : undefined, slskd) };
  });

  app.post<{ Params: { id: string } }>('/api/admin/requests/:id/reject', async (req) => {
    const { user } = need(req, 'requests.approve');
    const r = decided(Number(req.params.id));
    const reason = str(req.body, 'reason', 300) || null;
    db.prepare("UPDATE requests SET status = 'rejected', reason = ?, decided_by = ?, decided_at = ?, seen = 0 WHERE id = ?").run(reason, user.id, Date.now(), r.id);
    audit(db, { actorId: user.id, action: 'request.rejected', target: `${r.artist} – ${r.title}`, detail: { for: r.username, reason }, ip: clientIp(req) });
    return { request: getRequest(db, r.id) };
  });

  /** "You already have it": nothing to download. */
  app.post<{ Params: { id: string } }>('/api/admin/requests/:id/have', async (req) => {
    const { user } = need(req, 'requests.approve');
    const r = decided(Number(req.params.id));
    db.prepare("UPDATE requests SET status = 'have', reason = NULL, decided_by = ?, decided_at = ?, seen = 0 WHERE id = ?").run(user.id, Date.now(), r.id);
    audit(db, { actorId: user.id, action: 'request.have', target: `${r.artist} – ${r.title}`, detail: { for: r.username }, ip: clientIp(req) });
    return { request: getRequest(db, r.id) };
  });

  app.delete<{ Params: { id: string } }>('/api/admin/requests/:id', async (req) => {
    need(req, 'requests.approve');
    const r = decided(Number(req.params.id));
    db.prepare('DELETE FROM requests WHERE id = ?').run(r.id);
    return { ok: true };
  });
}
