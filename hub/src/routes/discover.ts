import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { forYou } from '../forYou.ts';
import { HttpError, signedIn } from '../http.ts';

/** `{ songs: [{ title, artist }] }`, checked: at most `max`, strings only. */
function songsOf(body: unknown, max: number): { title: string; artist: string }[] {
  const songs = (body as { songs?: unknown } | null)?.songs;
  if (!Array.isArray(songs) || songs.length > max) throw new HttpError(400, `Send { songs: [{ title, artist }] }, up to ${max}`);
  return songs.map((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    return { title: typeof o.title === 'string' ? o.title.slice(0, 300) : '', artist: typeof o.artist === 'string' ? o.artist.slice(0, 300) : '' };
  });
}

/**
 * Discover (docs/HUB.md "Discover"): the charts from the Hub's copy (discover.ts), which chart songs the library
 * has (libraryIndex.ts), how songs moved since last week (chartHistory.ts) and the For you ranking (forYou.ts).
 */
export function discoverRoutes(app: FastifyInstance, ctx: Ctx) {
  /**
   * Same hosts as /api/fetch. The answer says when the Hub fetched it (`x-wavelength-fetched-at`) and whether the
   * source failed and this is the last copy that worked (`x-wavelength-stale: 1`).
   */
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

  /** Which of these songs the Hub's Navidrome has. `ready: false` when the Hub can't list it (no scan login). */
  app.post('/api/discover/match', async (req) => {
    signedIn(req);
    const songs = songsOf(req.body, 300);
    const ready = await ctx.libraryIndex.ensure();
    const { server, songs: total } = ctx.libraryIndex.status();
    return { ready, server, total, songs: ready ? ctx.libraryIndex.match(songs) : songs.map(() => null) };
  });

  /** Keep today's snapshot of a chart (songs in rank order) and say how each moved since about a week ago. */
  app.post('/api/discover/positions', async (req) => {
    signedIn(req);
    const chart = (req.body as { chart?: unknown } | null)?.chart;
    if (typeof chart !== 'string' || !chart || chart.length > 300) throw new HttpError(400, 'Say which chart (chart: "billboard:all")');
    return ctx.chartHistory.record(chart, songsOf(req.body, 300));
  });

  /** For you: how close each song is to what the caller plays (score 0 = not at all), with a reason. */
  app.post('/api/discover/foryou', async (req) => {
    const { user } = signedIn(req);
    return forYou(ctx.db, user.id, songsOf(req.body, 300), ctx.mixLookups);
  });
}
