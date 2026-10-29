import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import { clientIp, HttpError, need, str } from '../http.ts';
import { folderName, hubSlskd, rankFolders, transferDone, transferOk } from '../slskd.ts';

/**
 * Soulseek through the Hub's slskd (slskd.ts), for people allowed to download (`downloads.run`): search,
 * see the results grouped into folders, download one. Admins also use it to fill requests
 * (POST /api/admin/requests/:id/approve with `slskd`).
 */

/** `[{ filename, size }]` from a body, as slskd wants them. */
export function readFiles(v: unknown): { filename: string; size: number }[] {
  const files = (Array.isArray(v) ? v : [])
    .filter((f) => f && typeof f.filename === 'string' && f.filename.length <= 1000)
    .map((f) => ({ filename: f.filename as string, size: Math.max(0, Math.round(Number(f.size) || 0)) }))
    .slice(0, 200);
  if (!files.length) throw new HttpError(400, 'Pick some files to download');
  return files;
}

export function slskdRoutes(app: FastifyInstance, { db, config, library }: Ctx) {
  const key = config.secretKey;
  const queries = new Map<string, string>(); // search id → what was searched, for ranking

  app.post('/api/slskd/test', async (req) => {
    need(req, 'downloads.run');
    return { message: await hubSlskd(db, key).client.test() };
  });

  /** Start a search; the results come in over the next 10–20 seconds. */
  app.post('/api/slskd/searches', async (req) => {
    need(req, 'downloads.run');
    const query = str(req.body, 'query', 200);
    if (query.length < 3) throw new HttpError(400, 'Search for at least 3 letters');
    const { id } = await hubSlskd(db, key).client.search(query);
    queries.set(id, query);
    if (queries.size > 100) queries.delete(queries.keys().next().value!);
    return { id };
  });

  /** A search's results so far, grouped into folders and ranked. */
  app.get<{ Params: { id: string } }>('/api/slskd/searches/:id', async (req) => {
    need(req, 'downloads.run');
    const { client } = hubSlskd(db, key);
    const st = await client.searchState(req.params.id);
    const done = !!st.isComplete || /Completed/.test(st.state ?? '');
    const folders = rankFolders(await client.responses(req.params.id), queries.get(req.params.id) ?? '');
    if (done) {
      queries.delete(req.params.id);
      void client.deleteSearch(req.params.id);
    }
    return { done, responses: st.responseCount ?? 0, folders };
  });

  /** Download files from one person. `{ username, files: [{ filename, size }], label? }` */
  app.post('/api/slskd/downloads', async (req) => {
    const { user } = need(req, 'downloads.run');
    const b = (req.body ?? {}) as Record<string, unknown>;
    const username = str(b, 'username', 100);
    if (!username) throw new HttpError(400, 'Whose files?');
    const files = readFiles(b.files);
    await hubSlskd(db, key).client.download(username, files);
    library.slskdActivity();
    audit(db, { actorId: user.id, action: 'slskd.download', target: str(b, 'label', 200) || username, detail: { files: files.length, from: username }, ip: clientIp(req) });
    return { ok: true, files: files.length };
  });

  /** Downloads in slskd, grouped by folder, newest folders first. */
  app.get('/api/slskd/downloads', async (req) => {
    need(req, 'downloads.run');
    const all = await hubSlskd(db, key).client.transfers();
    const groups = new Map<string, { username: string; folder: string; files: number; done: number; failed: number; size: number; bytes: number; state: string }>();
    for (const t of all) {
      const i = Math.max(t.filename.lastIndexOf('\\'), t.filename.lastIndexOf('/'));
      const folder = t.filename.slice(0, Math.max(0, i));
      const k = `${t.username}\u0000${folder}`;
      const g = groups.get(k) ?? { username: t.username, folder, files: 0, done: 0, failed: 0, size: 0, bytes: 0, state: '' };
      g.files++;
      g.size += t.size || 0;
      g.bytes += ((t.percentComplete ?? (transferOk(t.state) ? 100 : 0)) / 100) * (t.size || 0);
      if (transferOk(t.state)) g.done++;
      else if (transferDone(t.state)) g.failed++;
      else g.state = t.state;
      groups.set(k, g);
    }
    return {
      downloads: [...groups.values()].reverse().slice(0, 100).map((g) => ({
        ...g,
        name: folderName(g.folder),
        progress: g.size ? Math.round((g.bytes / g.size) * 100) : 0,
        state: g.done + g.failed === g.files ? (g.failed ? (g.done ? 'Partly failed' : 'Failed') : 'Done') : g.state || 'Queued',
      })),
    };
  });
}
