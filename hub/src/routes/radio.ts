import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { HttpError, signedIn } from '../http.ts';
import { IcyError, StationTitles, streamUrl } from '../radio.ts';

/**
 * The song a radio station is playing, read from inside its stream (radio.ts), for the browser app. Only
 * the title comes back, never the station's audio or headers, so this can't be used to read other pages.
 */
export function radioRoutes(app: FastifyInstance, _ctx: Ctx, titles = new StationTitles()) {
  app.get('/api/radio/now-playing', async (req, reply) => {
    signedIn(req);
    const raw = String((req.query as Record<string, unknown>).url ?? '');
    try {
      const r = await titles.get(streamUrl(raw).toString());
      return reply.header('cache-control', 'no-store').send({ icy: r.icy, title: r.title || null });
    } catch (e) {
      if (e instanceof IcyError) throw new HttpError(e.message.startsWith('Send') ? 400 : 502, e.message);
      throw e;
    }
  });
}
