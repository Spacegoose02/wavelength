import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import { clientIp, HttpError, need } from '../http.ts';
import type { Db } from '../db.ts';
import { serviceForHub, serviceIdOfKind } from '../services.ts';
import { deemixFor, subwaveAdmin } from '../upstream.ts';

/**
 * Calls the Hub makes for people with its own saved logins, so no device needs the SUB/WAVE admin
 * password, the deemix ARL or a share login: SUB/WAVE admin (`subwave.control`), deemix and yt-dlp
 * (`downloads.run`: admins, and members with Autodownload).
 */
export function proxyRoutes(app: FastifyInstance, { db, config, ytdlp, library }: Ctx) {
  const key = config.secretKey;
  const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

  // ---- SUB/WAVE admin: /api/admin/subwave/<server id>/<API path> ----
  app.route<{ Params: { id: string; '*': string } }>({
    method: ['GET', 'POST', 'PUT', 'DELETE'],
    url: '/api/admin/subwave/:id/*',
    handler: async (req, reply) => {
      const { user } = need(req, 'subwave.control');
      const s = serviceForHub(db, key, Number(req.params.id));
      if (!s || s.kind !== 'subwave') throw new HttpError(404, 'No such SUB/WAVE server');
      if (!s.secrets.username || !s.secrets.password) throw new HttpError(409, 'Add the SUB/WAVE admin login to this server in Settings → Sources');
      const q = req.url.indexOf('?');
      const r = await subwaveAdmin(
        { url: s.url, apiUrl: s.config.apiUrl as string | undefined, username: s.secrets.username, password: s.secrets.password, token: s.secrets.token },
        req.method,
        req.params['*'],
        q >= 0 ? req.url.slice(q) : '',
        req.body ?? undefined,
      );
      // changes on air are worth knowing about; reads aren't
      if (req.method !== 'GET') audit(db, { actorId: user.id, action: 'subwave.admin', target: s.name, detail: { method: req.method, path: req.params['*'].slice(0, 200) }, ip: clientIp(req) });
      return reply.code(r.status).send(r.body ?? {});
    },
  });

  // ---- deemix ----
  const deemix = () => hubDeemix(db, key);

  app.get('/api/downloads/deemix', async (req) => {
    need(req, 'downloads.run');
    return deemix().client.status();
  });

  app.get('/api/downloads/deemix/queue', async (req) => {
    need(req, 'downloads.run');
    return deemix().client.getQueue();
  });

  app.post('/api/downloads/deemix/queue', async (req) => {
    const { user } = need(req, 'downloads.run');
    const b = (req.body ?? {}) as Record<string, unknown>;
    const link = str(b.link, 500);
    if (!isDeezerLink(link)) throw new HttpError(400, 'Send a Deezer link');
    const { s, client } = deemix();
    const bitrate = typeof b.bitrate === 'number' && [1, 3, 9].includes(b.bitrate) ? b.bitrate : Number(s.config.bitrate) || 9;
    library.activity();
    const r = await client.addToQueue(link, bitrate);
    audit(db, { actorId: user.id, action: 'download.queued', target: link, detail: { via: 'deemix', bitrate }, ip: clientIp(req) });
    return r ?? { ok: true };
  });

  // ---- yt-dlp ----
  const ytSettings = () => hubYtSettings(db, key);

  app.post('/api/downloads/ytdlp/search', async (req) => {
    need(req, 'downloads.run');
    return { results: await ytdlp.search(str((req.body as Record<string, unknown> | null)?.query, 500)) };
  });

  app.get('/api/downloads/ytdlp/jobs', async (req) => {
    const { user } = need(req, 'downloads.run');
    return { jobs: ytdlp.list(user.role === 'admin' ? null : user.id) };
  });

  app.post('/api/downloads/ytdlp/jobs', async (req) => {
    const { user } = need(req, 'downloads.run');
    const b = (req.body ?? {}) as Record<string, unknown>;
    const job = ytdlp.start(user, { url: str(b.url, 1000), title: str(b.title, 300), channel: str(b.channel, 200) }, ytSettings());
    audit(db, { actorId: user.id, action: 'download.queued', target: job.url, detail: { via: 'yt-dlp', title: job.title }, ip: clientIp(req) });
    return { job };
  });

  app.delete('/api/downloads/ytdlp/jobs', async (req) => {
    const { user } = need(req, 'downloads.run');
    ytdlp.clearFinished(user.role === 'admin' ? null : user.id);
    return { ok: true };
  });
}

/** The Hub's deemix server and a logged-in client for it. 404 when none is set up. */
export function hubDeemix(db: Db, key: Buffer) {
  const id = serviceIdOfKind(db, 'deemix');
  const s = id === undefined ? undefined : serviceForHub(db, key, id);
  if (!s) throw new HttpError(404, 'The Hub has no deemix set up. An admin adds it in Settings → Downloads');
  return { s, client: deemixFor(s.id, s.url, s.secrets.arl ?? '') };
}

/** Where and how the Hub's yt-dlp saves. */
export function hubYtSettings(db: Db, key: Buffer) {
  const id = serviceIdOfKind(db, 'ytdlp');
  const s = id === undefined ? undefined : serviceForHub(db, key, id);
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  return { folder: text(s?.config.folder) || 'yt-dlp', format: text(s?.config.format) || 'opus' };
}

export const isDeezerLink = (link: string) =>
  /^https:\/\/(www\.)?deezer\.com\/\S+$/i.test(link) || /^https:\/\/(deezer\.page\.link|link\.deezer\.com)\/\S+$/i.test(link);
