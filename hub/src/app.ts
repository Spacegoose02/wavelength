import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { deviceForToken } from './devices.ts';
import { HttpError, RateLimiter } from './http.ts';
import { permissionsFor } from './roles.ts';
import { adminRoutes } from './routes/admin.ts';
import { artworkRoutes } from './routes/artwork.ts';
import { authRoutes } from './routes/auth.ts';
import { listeningRoutes } from './routes/listening.ts';
import { meRoutes } from './routes/me.ts';
import { navidromeRoutes } from './routes/navidrome.ts';
import { relayRoutes } from './routes/relay.ts';
import { remoteRoutes } from './routes/remote.ts';
import { togetherRoutes } from './routes/together.ts';
import { dockerRoutes } from './routes/docker.ts';
import { trashRoutes } from './routes/trash.ts';
import { slskdRoutes } from './routes/slskd.ts';
import { mineRoutes } from './routes/mine.ts';
import { importRoutes } from './routes/imports.ts';
import { inviteRoutes } from './routes/invites.ts';
import { tagRoutes } from './routes/tags.ts';
import { flagRoutes } from './routes/flags.ts';
import { kidRoutes } from './routes/kids.ts';
import { proxyRoutes } from './routes/proxy.ts';
import { ratingRoutes } from './routes/ratings.ts';
import { requestRoutes } from './routes/requests.ts';
import { serverRoutes } from './routes/server.ts';
import { serviceRoutes } from './routes/services.ts';
import { shareRoutes } from './routes/shares.ts';
import { webFetchRoutes } from './routes/webfetch.ts';
import { getUser } from './users.ts';
import { Library } from './library.ts';
import { webRoutes } from './web.ts';
import { YtdlpRunner } from './ytdlp.ts';

declare module 'fastify' {
  interface FastifyInstance {
    hubRoutes: { method: string; url: string }[];
    hubLibrary: Library;
  }
}

/** What every route module gets. */
export interface Ctx {
  db: Db;
  config: Config;
  limits: { login: RateLimiter; pairing: RateLimiter; poll: RateLimiter };
  ytdlp: YtdlpRunner;
  library: Library;
  /** Stop the Hub so Docker starts it again (main.ts); used after a restore is staged. */
  restart: () => void;
}

export function buildApp(db: Db, config: Config, opts: { logger?: boolean; watchLibrary?: boolean; restart?: () => void } = {}): FastifyInstance {
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
    restart: opts.restart ?? (() => undefined),
  } as Omit<Ctx, 'library'> as Ctx;
  ctx.library = new Library(db, config.secretKey, ctx.ytdlp);
  if (opts.watchLibrary ?? true) ctx.library.start();
  app.addHook('onClose', async () => ctx.library.stop());
  app.decorate('hubLibrary', ctx.library);

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
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
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
  inviteRoutes(app, ctx);
  serviceRoutes(app, ctx);
  proxyRoutes(app, ctx);
  requestRoutes(app, ctx);
  shareRoutes(app, ctx);
  flagRoutes(app, ctx);
  kidRoutes(app, ctx);
  ratingRoutes(app, ctx);
  artworkRoutes(app, ctx);
  listeningRoutes(app, ctx);
  remoteRoutes(app, ctx);
  togetherRoutes(app, ctx);
  dockerRoutes(app, ctx);
  trashRoutes(app, ctx);
  slskdRoutes(app, ctx);
  navidromeRoutes(app, ctx);
  relayRoutes(app, ctx);
  mineRoutes(app, ctx);
  importRoutes(app, ctx);
  tagRoutes(app, ctx);
  serverRoutes(app, ctx);
  webFetchRoutes(app, ctx);
  webRoutes(app, config.webDir);
  return app;
}
