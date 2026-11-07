import { SonicWorker } from './sonic/worker.ts';
import { sonicRoutes } from './routes/sonic.ts';
import { tourRoutes, videoRoutes } from './routes/tours.ts';
import { Videos } from './videos.ts';
import { publicLinkRoutes } from './routes/publicLinks.ts';
import { Tours } from './tours.ts';
import { deezerLookups, Mixes, type MixLookups, type MixSong } from './mixes.ts';
import { mixRoutes } from './routes/mixes.ts';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { deviceForToken } from './devices.ts';
import { HttpError, RateLimiter } from './http.ts';
import { permissionsFor } from './roles.ts';
import { adminRoutes } from './routes/admin.ts';
import { familyRoutes } from './routes/families.ts';
import { artworkRoutes } from './routes/artwork.ts';
import { playlistCoverRoutes } from './routes/playlistCovers.ts';
import { authRoutes } from './routes/auth.ts';
import { listeningRoutes } from './routes/listening.ts';
import { meRoutes } from './routes/me.ts';
import { navidromeRoutes } from './routes/navidrome.ts';
import { relayRoutes } from './routes/relay.ts';
import { remoteRoutes } from './routes/remote.ts';
import { togetherRoutes } from './routes/together.ts';
import { activityRoutes } from './routes/activity.ts';
import { dockerRoutes } from './routes/docker.ts';
import { trashRoutes } from './routes/trash.ts';
import { notificationRoutes } from './routes/notifications.ts';
import { slskdRoutes } from './routes/slskd.ts';
import { mineRoutes } from './routes/mine.ts';
import { importRoutes } from './routes/imports.ts';
import { inviteRoutes } from './routes/invites.ts';
import { tagRoutes } from './routes/tags.ts';
import { genreRoutes } from './routes/genres.ts';
import { creditRoutes } from './routes/credits.ts';
import { flagRoutes } from './routes/flags.ts';
import { kidRoutes } from './routes/kids.ts';
import { proxyRoutes } from './routes/proxy.ts';
import { ratingRoutes } from './routes/ratings.ts';
import { requestRoutes } from './routes/requests.ts';
import { serverRoutes } from './routes/server.ts';
import { serviceRoutes } from './routes/services.ts';
import { shareRoutes } from './routes/shares.ts';
import { webFetchRoutes } from './routes/webfetch.ts';
import { radioRoutes } from './routes/radio.ts';
import { discoverRoutes } from './routes/discover.ts';
import { searchRoutes } from './routes/search.ts';
import { lyricsRoutes } from './routes/lyrics.ts';
import { LyricsCache } from './lyricsCache.ts';
import { ChartCache } from './discover.ts';
import { ChartHistory } from './chartHistory.ts';
import { LibraryIndex } from './libraryIndex.ts';
import { ReleaseRadar } from './radar.ts';
import { radarRoutes } from './routes/radar.ts';
import { scrobbleRoutes } from './routes/scrobble.ts';
import { pushRoutes } from './routes/push.ts';
import { householdRoutes } from './routes/household.ts';
import { Scrobbler } from './scrobble.ts';
import { Digests } from './digests.ts';
import { getUser } from './users.ts';
import { Library } from './library.ts';
import { CleanDownloads } from './cleanDownloads.ts';
import { webRoutes } from './web.ts';
import { YtdlpRunner, type YtResult } from './ytdlp.ts';
import { DjAgent } from './dj/agent.ts';
import { DjVoice, type Fetch } from './dj/voice.ts';
import { Station } from './dj/station.ts';
import { ollamaProvider } from './dj/ollama.ts';
import { anthropicProvider, type ProviderFactory } from './dj/provider.ts';
import { djRoutes } from './routes/dj.ts';

declare module 'fastify' {
  interface FastifyInstance {
    hubRoutes: { method: string; url: string }[];
    hubLibrary: Library;
    hubClean: CleanDownloads;
    hubScrobbler: Scrobbler;
  }
}

/** What every route module gets. */
export interface Ctx {
  db: Db;
  config: Config;
  limits: { login: RateLimiter; pairing: RateLimiter; poll: RateLimiter };
  ytdlp: YtdlpRunner;
  library: Library;
  /** Clean versions downloaded into their own folder (cleanDownloads.ts). */
  clean: CleanDownloads;
  /** Discover's charts, fetched and kept by the Hub so the apps don't each pull them (discover.ts). */
  charts: ChartCache;
  /** Discover's chart movement: a snapshot of each chart per day (chartHistory.ts). */
  chartHistory: ChartHistory;
  /** Every Navidrome song, kept to match Discover's charts against in one go (libraryIndex.ts). */
  libraryIndex: LibraryIndex;
  /** Lyrics the house's apps found, shared and searchable (lyricsCache.ts). */
  lyrics: LyricsCache;
  /** Deezer related artists and top songs (mixes.ts), for Made for you and Discover's For you. */
  mixLookups: MixLookups;
  /** Release Radar: followed artists and their new releases, looked up in the background (radar.ts). */
  radar: ReleaseRadar;
  /** Plays sent on to ListenBrainz / Last.fm (scrobble.ts). */
  scrobbler: Scrobbler;
  /** Kid reports and "your month in music" notifications (digests.ts). */
  digests: Digests;
  /** Stop the Hub so Docker starts it again (main.ts); used after a restore is staged. */
  restart: () => void;
  /** The AI DJ's chats and agent loop (dj/agent.ts). */
  dj: DjAgent;
  /** The talking DJ's Hub voices: Kokoro or OpenAI (dj/voice.ts). */
  voice: DjVoice;
  /** DJ mode's segments (dj/station.ts). */
  station: Station;
  /** Made for you mixes and Blends (mixes.ts). */
  mixes: Mixes;
  /** Sound-alike analysis of the library (sonic/). */
  sonic: SonicWorker;
  /** Tour dates (tours.ts). */
  tours: Tours;
  /** Music videos (videos.ts). */
  videos: Videos;
}

export function buildApp(db: Db, config: Config, opts: { logger?: boolean; watchLibrary?: boolean; restart?: () => void; djProvider?: ProviderFactory; mixLookups?: MixLookups; tourFetch?: (url: string) => Promise<unknown>; videoSearch?: (q: string, n: number) => Promise<YtResult[]>; ttsFetch?: Fetch; stationChart?: (kid: boolean) => Promise<MixSong[]>; ollamaFetch?: Fetch } = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 2 * 1024 * 1024 });
  const ctx: Ctx = {
    db,
    config,
    limits: {
      login: new RateLimiter(10, 60_000), // per IP + username
      pairing: new RateLimiter(30, 60_000), // per IP
      poll: new RateLimiter(120, 60_000), // per IP
    },
    ytdlp: new YtdlpRunner(config.ytdlpBin, config.musicDir),
    charts: new ChartCache(),
    restart: opts.restart ?? (() => undefined),
    dj: new DjAgent(db, config, opts.djProvider ?? anthropicProvider, ollamaProvider(opts.ollamaFetch), opts.ollamaFetch),
    voice: new DjVoice(db, config.secretKey, opts.ttsFetch),
    mixLookups: opts.mixLookups ?? deezerLookups(),
    chartHistory: new ChartHistory(db),
    sonic: new SonicWorker(db, config.secretKey, config.musicDir, config.navidromeMusicDir),
    tours: new Tours(db, config.secretKey, opts.tourFetch),
    videos: undefined as unknown as Videos,
  } as Omit<Ctx, 'library' | 'clean'> as Ctx;
  ctx.mixes = new Mixes(db, ctx.mixLookups);
  ctx.station = new Station(db, ctx.dj, ctx.mixes, opts.stationChart);
  ctx.videos = new Videos(opts.videoSearch ?? ((q, n) => ctx.ytdlp.search(q, n)));
  ctx.library = new Library(db, config.secretKey, ctx.ytdlp);
  ctx.lyrics = new LyricsCache(db);
  ctx.libraryIndex = new LibraryIndex(db, config.secretKey, () => ctx.library.status().lastScanAt);
  ctx.clean = new CleanDownloads(db, config.secretKey, config.musicDir, ctx.library);
  if (opts.watchLibrary ?? true) ctx.library.start();
  app.addHook('onClose', async () => ctx.library.stop());
  ctx.charts.start();
  app.addHook('onClose', async () => ctx.charts.stop());
  ctx.radar = new ReleaseRadar(db);
  if (opts.watchLibrary ?? true) ctx.radar.start();
  app.addHook('onClose', async () => ctx.radar.stop());
  ctx.scrobbler = new Scrobbler(db, config);
  if (opts.watchLibrary ?? true) ctx.scrobbler.start();
  app.addHook('onClose', async () => ctx.scrobbler.stop());
  if (opts.watchLibrary ?? true) ctx.sonic.start();
  app.addHook('onClose', async () => ctx.sonic.stop());
  ctx.digests = new Digests(db);
  if (opts.watchLibrary ?? true) ctx.digests.start();
  app.addHook('onClose', async () => ctx.digests.stop());
  app.decorate('hubLibrary', ctx.library);
  app.decorate('hubClean', ctx.clean);
  app.decorate('hubScrobbler', ctx.scrobbler);
  app.decorate('hubSonic', ctx.sonic);

  // database backups, for restore (routes/server.ts); the route sets how big
  app.addContentTypeParser(['application/octet-stream', 'application/vnd.sqlite3', 'application/x-sqlite3'], { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  // HTML forms post url-encoded bodies
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 16 * 1024 }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  // The app's own requests go through Rust (no CORS), but the browser dev preview needs it. Auth is a
  // bearer token, never a cookie, so allowing any origin doesn't let other sites act as the user.
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/') && !req.url.startsWith('/auth/')) return;
    reply.header('access-control-allow-origin', '*');
    reply.header('access-control-allow-headers', 'authorization, content-type');
    reply.header('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return reply.code(204).send();
  });

  // Who is calling. Routes decide what that allows with signedIn()/need().
  app.decorateRequest('auth', null);
  app.addHook('preHandler', async (req) => {
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '');
    if (!m) return;
    const device = deviceForToken(db, m[1]);
    const user = device && getUser(db, device.userId);
    if (device && user && !user.disabled) req.auth = { user, device, permissions: permissionsFor(user) };
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ ...err.extra, error: err.message });
    const { statusCode: status, message } = err as { statusCode?: number; message?: string };
    if (status && status < 500) return reply.code(status).send({ error: message });
    req.log.error(err);
    return reply.code(500).send({ error: 'Something went wrong on the Hub' });
  });

  // Recorded so tests can check every admin route refuses non-admins, including ones added later.
  const routes: { method: string; url: string }[] = [];
  app.decorate('hubRoutes', routes);
  app.addHook('onRoute', (r) => {
    for (const method of [r.method].flat()) if (method !== 'HEAD') routes.push({ method, url: r.url });
  });

  authRoutes(app, ctx);
  meRoutes(app, ctx);
  adminRoutes(app, ctx);
  familyRoutes(app, ctx);
  inviteRoutes(app, ctx);
  serviceRoutes(app, ctx);
  proxyRoutes(app, ctx);
  requestRoutes(app, ctx);
  shareRoutes(app, ctx);
  flagRoutes(app, ctx);
  kidRoutes(app, ctx);
  ratingRoutes(app, ctx);
  artworkRoutes(app, ctx);
  playlistCoverRoutes(app, ctx);
  listeningRoutes(app, ctx);
  remoteRoutes(app, ctx);
  togetherRoutes(app, ctx);
  activityRoutes(app, ctx);
  dockerRoutes(app, ctx);
  trashRoutes(app, ctx);
  notificationRoutes(app, ctx);
  slskdRoutes(app, ctx);
  navidromeRoutes(app, ctx);
  relayRoutes(app, ctx);
  mineRoutes(app, ctx);
  importRoutes(app, ctx);
  tagRoutes(app, ctx);
  genreRoutes(app, ctx);
  creditRoutes(app, ctx);
  serverRoutes(app, ctx);
  webFetchRoutes(app, ctx);
  radioRoutes(app, ctx);
  discoverRoutes(app, ctx);
  searchRoutes(app, ctx);
  lyricsRoutes(app, ctx);
  radarRoutes(app, ctx);
  scrobbleRoutes(app, ctx);
  pushRoutes(app, ctx);
  householdRoutes(app, ctx);
  djRoutes(app, ctx);
  mixRoutes(app, ctx);
  sonicRoutes(app, ctx);
  tourRoutes(app, ctx);
  videoRoutes(app, ctx);
  publicLinkRoutes(app, ctx);
  webRoutes(app, config.webDir);
  return app;
}
