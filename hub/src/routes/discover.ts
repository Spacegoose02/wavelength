import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { signedIn } from '../http.ts';

/**
 * Discover's charts, from the Hub's copy (discover.ts). Same hosts as /api/fetch. The answer says when the
 * Hub fetched it (`x-wavelength-fetched-at`) and whether the source failed and this is the last copy that
 * worked (`x-wavelength-stale: 1`).
 */
export function discoverRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/api/discover/fetch', async (req, reply) => {
    signedIn(req);
    const r = await ctx.charts.get(String((req.query as Record<string, unknown>).url ?? ''));
    return reply
      .code(r.status)
      .header('content-type', r.contentType)
      .header('cache-control', 'no-store')
      .header('access-control-expose-headers', 'x-wavelength-fetched-at, x-wavelength-stale')
      .header('x-wavelength-fetched-at', new Date(r.fetchedAt).toISOString())
      .header('x-wavelength-stale', r.stale ? '1' : '0')
      .send(r.body);
  });
}
