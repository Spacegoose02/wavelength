import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { requireFeature } from '../features.ts';
import { HttpError, need, signedIn } from '../http.ts';

/** Sound-alike analysis (sonic/): similar songs, journeys, features, and the admin's progress page. */
export function sonicRoutes(app: FastifyInstance, { db, sonic }: Ctx) {
  const index = sonic.index;
  type Q = { id?: string; artist?: string; title?: string };
  const pick = (q: Q, what = 'song') => {
    const i = index.find({ id: q.id, artist: q.artist, title: q.title });
    if (i === undefined) throw new HttpError(404, `That ${what} hasn’t been analysed yet`);
    return i;
  };
  const limit = (v: unknown, d: number, max: number) => Math.min(max, Math.max(1, Number(v) || d));

  app.get<{ Querystring: Q & { limit?: string } }>('/api/sonic/similar', async (req) => {
    requireFeature(db, 'sonic', signedIn(req).user);
    const i = pick(req.query);
    return { song: index.hit(i), songs: index.similar(i, limit(req.query.limit, 50, 200)) };
  });

  app.get<{ Querystring: { from?: string; to?: string; fromArtist?: string; fromTitle?: string; toArtist?: string; toTitle?: string; steps?: string } }>('/api/sonic/journey', async (req) => {
    requireFeature(db, 'sonic', signedIn(req).user);
    const q = req.query;
    const a = pick({ id: q.from, artist: q.fromArtist, title: q.fromTitle }, 'first song');
    const b = pick({ id: q.to, artist: q.toArtist, title: q.toTitle }, 'last song');
    return { songs: index.journey(a, b, limit(q.steps, 20, 60)) };
  });

  app.get<{ Querystring: { q?: string } }>('/api/sonic/search', async (req) => {
    requireFeature(db, 'sonic', signedIn(req).user);
    return { songs: index.search(String(req.query.q ?? '').slice(0, 100)) };
  });

  /** `{ songs: [{ id?, artist?, title? }] }` (up to 500) → features for the ones analysed, same order (null for the rest). */
  app.post('/api/sonic/lookup', async (req) => {
    requireFeature(db, 'sonic', signedIn(req).user);
    const songs = (req.body as { songs?: unknown } | null)?.songs;
    if (!Array.isArray(songs) || songs.length > 500) throw new HttpError(400, 'Send { songs: [...] }, up to 500');
    return {
      features: songs.map((s) => {
        const o = (s ?? {}) as Q;
        const i = index.find({ id: typeof o.id === 'string' ? o.id : undefined, artist: typeof o.artist === 'string' ? o.artist : undefined, title: typeof o.title === 'string' ? o.title : undefined });
        if (i === undefined) return null;
        const f = index.features(i);
        return { ...index.hit(i), beatStrength: f.beatStrength, beatPhase: f.beatPhase, offset: f.offset ?? 0, loudness: f.loudness };
      }),
    };
  });

  app.get('/api/admin/sonic', async (req) => {
    need(req, 'server.view');
    return sonic.status();
  });

  app.post('/api/admin/sonic/rescan', async (req) => {
    need(req, 'server.view');
    sonic.kick();
    return sonic.status();
  });
}
