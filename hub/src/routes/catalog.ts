import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import { clientIp, HttpError, need } from '../http.ts';
import { importPlaylists, playlistsImported } from '../playlists.ts';
import { importFromNavidrome, radioImportedAt } from '../radioStations.ts';
import { navidromeLogins, serviceIdOfKind } from '../services.ts';
import { importUserData, userDataImported, userDataSummary } from '../userData.ts';

/** What's in the catalog, counted from catalog_songs (for Settings → Server → Music catalog). */
function summary(ctx: Ctx) {
  const one = <T>(sql: string) => ctx.db.prepare(sql).get() as T;
  const totals = one<{ albums: number; artists: number; hours: number; untagged: number; unlinked: number }>(`
    SELECT COUNT(DISTINCT lower(CASE WHEN album_artist <> '' THEN album_artist ELSE artist END) || char(31) || lower(album)) AS albums,
           COUNT(DISTINCT lower(CASE WHEN album_artist <> '' THEN album_artist ELSE artist END)) AS artists,
           ROUND(SUM(duration) / 3600.0, 1) AS hours,
           SUM(CASE WHEN error IS NULL AND (title = '' OR artist = '' OR album = '') THEN 1 ELSE 0 END) AS untagged,
           SUM(CASE WHEN nd_id IS NULL AND error IS NULL THEN 1 ELSE 0 END) AS unlinked
    FROM catalog_songs`);
  const formats = ctx.db.prepare("SELECT codec, COUNT(*) AS files FROM catalog_songs WHERE codec <> '' GROUP BY codec ORDER BY files DESC").all() as { codec: string; files: number }[];
  const genres = ctx.db.prepare("SELECT genre, COUNT(*) AS files FROM catalog_songs WHERE genre <> '' GROUP BY lower(genre) ORDER BY files DESC LIMIT 25").all() as { genre: string; files: number }[];
  const failed = ctx.db.prepare('SELECT path, error FROM catalog_songs WHERE error IS NOT NULL ORDER BY path LIMIT 20').all() as { path: string; error: string }[];
  return { albums: totals.albums, artists: totals.artists, hours: totals.hours ?? 0, untagged: totals.untagged ?? 0, unlinked: totals.unlinked ?? 0, formats, genres, failed };
}

/**
 * The music catalog (catalog.ts), phase 1 of the Hub's own music server: how far it got and what it found. Admins
 * only. Nothing here changes what the app plays.
 */
export function catalogRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/api/admin/catalog', async (req) => {
    need(req, 'server.view');
    return { ...ctx.catalog.status(), summary: summary(ctx), people: userDataSummary(ctx.db) };
  });

  /**
   * `{ serve?, stream? }`: for devices that go through the Hub (routes/relay.ts), answer browsing, search and covers
   * from the catalog (phase 3), and play songs from the music folder (phase 4). Each takes effect only while the
   * catalog matches Navidrome (usable()).
   */
  app.put('/api/admin/catalog', async (req) => {
    const { user } = need(req, 'server.view');
    const body = (req.body ?? {}) as { serve?: unknown; stream?: unknown; userData?: unknown };
    for (const k of ['serve', 'stream', 'userData'] as const) if (body[k] !== undefined && typeof body[k] !== 'boolean') throw new HttpError(400, `${k} must be true or false`);
    if (body.serve === undefined && body.stream === undefined && body.userData === undefined) throw new HttpError(400, 'Send serve, stream or userData');
    if (typeof body.userData === 'boolean') {
      ctx.catalog.setKeepsUserData(body.userData);
      audit(ctx.db, { actorId: user.id, action: 'catalog.userData', detail: { userData: body.userData }, ip: clientIp(req) });
    }
    if (typeof body.serve === 'boolean') {
      ctx.catalog.setServe(body.serve);
      audit(ctx.db, { actorId: user.id, action: 'catalog.serve', detail: { serve: body.serve }, ip: clientIp(req) });
    }
    if (typeof body.stream === 'boolean') {
      ctx.catalog.setStream(body.stream);
      audit(ctx.db, { actorId: user.id, action: 'catalog.stream', detail: { stream: body.stream }, ip: clientIp(req) });
    }
    return { ...ctx.catalog.status(), summary: summary(ctx), people: userDataSummary(ctx.db) };
  });

  /**
   * `{ off: true }`: turn Navidrome off for this household (phase 6, docs/HUB.md "Without Navidrome"). First, while
   * Navidrome can still be asked, copy what isn't on the Hub yet: everyone's hearts, plays, ratings and playlists
   * (each person's own login) and the radio stations. Then the Hub gives ids to songs Navidrome never saw and answers
   * everything itself. Someone whose copy fails is listed, and the switch stays off unless `force` is set.
   * `{ off: false }` lets Navidrome answer again (what changed meanwhile stays on the Hub only).
   */
  app.put('/api/admin/catalog/navidrome', async (req) => {
    const { user } = need(req, 'server.view');
    const body = (req.body ?? {}) as { off?: unknown; force?: unknown };
    if (typeof body.off !== 'boolean') throw new HttpError(400, 'Send { off: true } or { off: false }');
    if (!body.off) {
      ctx.catalog.setStandalone(false);
      audit(ctx.db, { actorId: user.id, action: 'catalog.navidrome_on', ip: clientIp(req) });
      return { ...ctx.catalog.status(), summary: summary(ctx), people: userDataSummary(ctx.db), copied: [], notCopied: [] };
    }
    if (!ctx.config.musicDir) throw new HttpError(409, 'The Hub has no music folder. Map your music share to /music (WAVELENGTH_MUSIC_DIR)');
    if (!ctx.catalog.usable()) throw new HttpError(409, 'Scan the music folder first, and let it match Navidrome’s songs, so the Hub has every song with Navidrome’s ids');
    const copied: string[] = [];
    const failed: { user: string; error: string }[] = [];
    const nameOf = (id: number) => (ctx.db.prepare('SELECT username FROM users WHERE id = ?').get(id) as { username: string } | undefined)?.username ?? `#${id}`;
    const service = serviceIdOfKind(ctx.db, 'navidrome');
    for (const login of service === undefined ? [] : navidromeLogins(ctx.db, ctx.config.secretKey, service)) {
      try {
        if (!userDataImported(ctx.db, login.userId)) await importUserData(ctx.db, login.userId, login);
        if (!playlistsImported(ctx.db, login.userId)) await importPlaylists(ctx.db, login.userId, login);
        copied.push(nameOf(login.userId));
      } catch (e) {
        failed.push({ user: nameOf(login.userId), error: String((e as Error).message ?? e) });
      }
    }
    if (radioImportedAt(ctx.db) === null) await importFromNavidrome(ctx.db, ctx.config.secretKey).catch((e: Error) => failed.push({ user: 'radio stations', error: e.message }));
    if (failed.length && body.force !== true) {
      return { ...ctx.catalog.status(), summary: summary(ctx), people: userDataSummary(ctx.db), copied, notCopied: failed };
    }
    ctx.catalog.setStandalone(true);
    const given = ctx.catalog.giveIds();
    audit(ctx.db, { actorId: user.id, action: 'catalog.navidrome_off', detail: { copied: copied.length, failed: failed.length, given }, ip: clientIp(req) });
    return { ...ctx.catalog.status(), summary: summary(ctx), people: userDataSummary(ctx.db), copied, notCopied: failed };
  });

  app.post('/api/admin/catalog/scan', async (req) => {
    const { user } = need(req, 'server.view');
    if (!ctx.catalog.status().scanning) audit(ctx.db, { actorId: user.id, action: 'catalog.scan', ip: clientIp(req) });
    void ctx.catalog.scan().catch(() => undefined);
    return { ...ctx.catalog.status(), summary: summary(ctx), people: userDataSummary(ctx.db) };
  });
}
