import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import type { Db } from '../db.ts';
import { clientIp, HttpError, need, signedIn, str, type Auth } from '../http.ts';
import { deemixJobIds, type DownloadProgress } from '../library.ts';
import { approvers, notify, notifyRequester } from '../notify.ts';
import { permissionsFor } from '../roles.ts';
import { getUser } from '../users.ts';
import { guardiansOf, isGuardian, kidsOf } from '../family.ts';
import { releaseNotForKids } from '../kidSafe.ts';
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
  /** Downloading with deemix: how it's going (library.ts). */
  progress?: DownloadProgress;
}

interface Row {
  id: number; user_id: number; username: string; display_name: string; link: string; kind: string; title: string; artist: string;
  cover: string | null; note: string | null; status: RequestStatus; reason: string | null; via: string | null; decider: string | null;
  created_at: number; decided_at: number | null; downloaded_at: number | null; ready_at: number | null; seen: number; job?: string | null;
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

export function requestRoutes(app: FastifyInstance, { db, config, ytdlp, library, clean, radar }: Ctx) {
  const key = config.secretKey;
  /** A request as sent to devices, with its download's progress while deemix has it. */
  const withProgress = (r: Row): MusicRequest => {
    const out = toRequest(r);
    const progress = library.progressFor({ ...out, job: r.job });
    return progress ? { ...out, progress } : out;
  };

  /**
   * Release Radar's "Get new releases automatically" (radar.ts): the release becomes this person's request, which
   * downloads straight away with Autodownload and otherwise waits in the admins' queue like any other.
   */
  radar.autoGet = async (userId, rel) => {
    const user = getUser(db, userId);
    if (!user || user.disabled) return;
    const permissions = permissionsFor(user);
    if (!permissions.includes('requests.create') || (user.role === 'kid' && releaseNotForKids(db, rel))) return;
    const open = db.prepare("SELECT 1 FROM requests WHERE user_id = ? AND link = ? AND status IN ('pending', 'approved')").get(userId, rel.link);
    if (open) return;
    const kind = 'album'; // singles and EPs are albums on Deezer too
    const { lastInsertRowid } = db
      .prepare('INSERT INTO requests (user_id, link, kind, title, artist, cover, note, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(userId, rel.link, kind, rel.title, rel.artist, rel.cover, 'Release Radar: got automatically', 'pending', Date.now());
    const r = getRequest(db, Number(lastInsertRowid))!;
    audit(db, { actorId: userId, action: 'request.created', target: `${r.artist} – ${r.title}`, detail: { link: r.link, kind, auto: true } });
    if (permissions.includes('downloads.run')) await approve(r, user, '');
    else notify(db, approvers(db, userId), 'request.new', `New request from ${user.displayName}`, `${r.title} by ${r.artist} (Release Radar)`);
  };

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
      // "Request clean version": into its own folder, once deemix is free (followed by its Deezer id)
      if (r.kind === 'album' && /\(clean\)$/i.test(r.title)) {
        clean.add(r.link, bitrate ?? (Number(s.config.bitrate) || 9));
        return { via: 'deemix', job: null };
      }
      await clean.beforeQueue();
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
    if (status === 'failed' && by.id !== r.userId) notifyRequester(db, r.id, 'request.failed');
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
    else notify(db, [...approvers(db, auth.user.id), ...guardiansOf(db, auth.user.id)], 'request.new', `New request from ${auth.user.displayName}`, r.artist ? `${r.title} by ${r.artist}` : r.title);
    return { request: r };
  });

  /** Your requests, newest first. */
  app.get('/api/requests', async (req) => {
    const { user } = signedIn(req);
    const rows = db.prepare(`${SELECT} WHERE r.user_id = ? ORDER BY r.created_at DESC LIMIT 200`).all(user.id) as unknown as Row[];
    return { requests: rows.map(withProgress) };
  });

  /** Numbers for the badge: your decisions you haven't seen, and (admins) requests waiting. */
  app.get('/api/requests/counts', async (req) => {
    const { user, permissions } = signedIn(req);
    const n = (sql: string, ...args: (string | number)[]) => (db.prepare(sql).get(...args) as { n: number }).n;
    return {
      unseen: n('SELECT COUNT(*) AS n FROM requests WHERE user_id = ? AND seen = 0', user.id),
      pending: permissions.includes('requests.approve') ? n("SELECT COUNT(*) AS n FROM requests WHERE status = 'pending'")
        : n("SELECT COUNT(*) AS n FROM requests r JOIN guardians g ON g.kid_id = r.user_id AND g.guardian_id = ? WHERE r.status = 'pending'", user.id),
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

  // ---- the admin queue (and parents, for their own kids' requests) ----

  /** Admins see every request; a parent (family.ts) only their kids'. Anyone else: 403. */
  const queue = (req: Parameters<typeof signedIn>[0]): { auth: Auth; kids: number[] | null } => {
    const auth = signedIn(req);
    if (auth.permissions.includes('requests.approve')) return { auth, kids: null };
    const kids = kidsOf(db, auth.user.id);
    if (!kids.length) throw new HttpError(403, 'You do not have permission to do that');
    return { auth, kids };
  };

  app.get('/api/admin/requests', async (req) => {
    const { kids } = queue(req);
    const status = str(req.query, 'status', 20);
    const mine = kids ? `r.user_id IN (${kids.map(Number).join(',')})` : '1';
    const rows = (status
      ? db.prepare(`${SELECT} WHERE ${mine} AND r.status = ? ORDER BY r.created_at DESC LIMIT 300`).all(status)
      : db.prepare(`${SELECT} WHERE ${mine} ORDER BY (r.status = 'pending') DESC, r.created_at DESC LIMIT 300`).all()) as unknown as Row[];
    return { requests: rows.map(withProgress) };
  });

  /** The request, if the caller may decide it: admins any, parents their kids'. */
  const decide = (req: Parameters<typeof signedIn>[0], id: number): { user: Auth['user']; r: MusicRequest; parent: boolean } => {
    const { auth, kids } = queue(req);
    const r = getRequest(db, id);
    if (!r || (kids && !isGuardian(db, auth.user.id, r.userId))) throw new HttpError(404, 'No such request');
    return { user: auth.user, r, parent: !!kids };
  };

  /**
   * Download it. `{ bitrate? }` for Deezer: 9 FLAC, 3 MP3 320, 1 MP3 128. `{ slskd: { username, files } }`
   * downloads a folder picked on Soulseek instead. Also retries a failed one.
   */
  app.post<{ Params: { id: string } }>('/api/admin/requests/:id/approve', async (req) => {
    const { user, r, parent } = decide(req, Number(req.params.id));
    const b = (req.body ?? {}) as { bitrate?: unknown; slskd?: { username?: unknown; files?: unknown } };
    // picking Soulseek files is for admins
    const slskd = b.slskd && !parent ? { username: str(b.slskd, 'username', 100), files: readFiles(b.slskd.files) } : undefined;
    if (slskd && !slskd.username) throw new HttpError(400, 'Whose files?');
    return { request: await approve(r, user, clientIp(req), typeof b.bitrate === 'number' && [1, 3, 9].includes(b.bitrate) ? b.bitrate : undefined, slskd) };
  });

  app.post<{ Params: { id: string } }>('/api/admin/requests/:id/reject', async (req) => {
    const { user, r } = decide(req, Number(req.params.id));
    const reason = str(req.body, 'reason', 300) || null;
    db.prepare("UPDATE requests SET status = 'rejected', reason = ?, decided_by = ?, decided_at = ?, seen = 0 WHERE id = ?").run(reason, user.id, Date.now(), r.id);
    if (r.userId !== user.id) notifyRequester(db, r.id, 'request.rejected');
    audit(db, { actorId: user.id, action: 'request.rejected', target: `${r.artist} – ${r.title}`, detail: { for: r.username, reason }, ip: clientIp(req) });
    return { request: getRequest(db, r.id) };
  });

  /** "You already have it": nothing to download. */
  app.post<{ Params: { id: string } }>('/api/admin/requests/:id/have', async (req) => {
    const { user, r } = decide(req, Number(req.params.id));
    db.prepare("UPDATE requests SET status = 'have', reason = NULL, decided_by = ?, decided_at = ?, seen = 0 WHERE id = ?").run(user.id, Date.now(), r.id);
    if (r.userId !== user.id) notifyRequester(db, r.id, 'request.have');
    audit(db, { actorId: user.id, action: 'request.have', target: `${r.artist} – ${r.title}`, detail: { for: r.username }, ip: clientIp(req) });
    return { request: getRequest(db, r.id) };
  });

  app.delete<{ Params: { id: string } }>('/api/admin/requests/:id', async (req) => {
    need(req, 'requests.approve');
    const r = getRequest(db, Number(req.params.id));
    if (!r) throw new HttpError(404, 'No such request');
    db.prepare('DELETE FROM requests WHERE id = ?').run(r.id);
    return { ok: true };
  });
}
