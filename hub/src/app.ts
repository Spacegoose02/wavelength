import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { deviceForToken } from './devices.ts';
import { HttpError, RateLimiter } from './http.ts';
import { permissionsFor } from './roles.ts';
import { adminRoutes } from './routes/admin.ts';
import { authRoutes } from './routes/auth.ts';
import { meRoutes } from './routes/me.ts';
import { flagRoutes } from './routes/flags.ts';
import { proxyRoutes } from './routes/proxy.ts';
import { requestRoutes } from './routes/requests.ts';
import { serviceRoutes } from './routes/services.ts';
import { shareRoutes } from './routes/shares.ts';
import { getUser } from './users.ts';
import { YtdlpRunner } from './ytdlp.ts';

declare module 'fastify' {
  interface FastifyInstance {
    hubRoutes: { method: string; url: string }[];
  }
}

/** What every route module gets. */
export interface Ctx {
  db: Db;
  config: Config;
  limits: { login: RateLimiter; pairing: RateLimiter; poll: RateLimiter };
  ytdlp: YtdlpRunner;
}

export function buildApp(db: Db, config: Config, opts: { logger?: boolean } = {}): FastifyInstance {
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
  };

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
  serviceRoutes(app, ctx);
  proxyRoutes(app, ctx);
  requestRoutes(app, ctx);
  shareRoutes(app, ctx);
  flagRoutes(app, ctx);
  return app;
}
