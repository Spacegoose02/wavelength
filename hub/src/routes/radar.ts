import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { HttpError, signedIn } from '../http.ts';
import { WINDOW_DAYS } from '../radar.ts';

/**
 * Release Radar (radar.ts, docs/RELEASE-RADAR.md). Everything here is the caller's own: who they follow,
 * the new releases from those artists, and artists they might like. Anyone signed in may use it, kids
 * included; the app hides what a kid profile mustn't see, as it does everywhere else.
 */

const artistId = (v: unknown) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(400, 'Not a Deezer artist id');
  return n;
};
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const picture = (v: unknown) => {
  const s = text(v, 500);
  return /^https:\/\//.test(s) ? s : null;
};

export function radarRoutes(app: FastifyInstance, { radar }: Ctx) {
  /** `{ follows, releases, windowDays, checkedAt, pending, failed }` */
  app.get('/api/radar', async (req) => {
    const { user } = signedIn(req);
    return { follows: radar.follows(user.id), releases: radar.releases(user.id), windowDays: WINDOW_DAYS, ...radar.status(user.id) };
  });

  /**
   * Follow an artist: `{ id, name, picture? }` with a Deezer artist id, or just `{ name }` (from the library)
   * and the Hub finds them on Deezer by exact name. 404 when Deezer has nobody by that name.
   */
  app.post('/api/radar/follows', async (req, reply) => {
    const { user } = signedIn(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    let name = text(b.name, 200);
    let pic = picture(b.picture);
    let id: number;
    if (b.id !== undefined && b.id !== null) {
      id = artistId(b.id);
      if (!name) throw new HttpError(400, 'Send the artist’s name too');
    } else {
      if (!name) throw new HttpError(400, 'Send an artist');
      const found = await radar.resolve(name).catch(() => {
        throw new HttpError(502, 'Couldn’t reach Deezer to find that artist');
      });
      if (!found) throw new HttpError(404, `Deezer has no artist called ${name}`);
      ({ id, name } = found);
      pic ??= found.picture;
    }
    const follow = radar.follow(user.id, { id, name, picture: pic });
    return reply.code(201).send({ follow });
  });

  app.delete<{ Params: { id: string } }>('/api/radar/follows/:id', async (req) => {
    const { user } = signedIn(req);
    if (!radar.unfollow(user.id, artistId(req.params.id))) throw new HttpError(404, 'You don’t follow that artist');
    return { ok: true };
  });

  /** Look up your artists now instead of waiting for the next round (skips ones looked at in the last few minutes). */
  app.post('/api/radar/check', async (req) => {
    const { user } = signedIn(req);
    await radar.checkDue(user.id);
    return { releases: radar.releases(user.id), ...radar.status(user.id) };
  });

  /** `?fresh=1` works them out again instead of using this person's copy from the last few hours. */
  app.get('/api/radar/suggestions', async (req) => {
    const { user } = signedIn(req);
    const fresh = (req.query as Record<string, unknown>).fresh === '1';
    return { suggestions: await radar.suggestions(user.id, fresh) };
  });

  /** "Not interested": never suggest this artist to you again (following them later clears it). */
  app.post<{ Params: { id: string } }>('/api/radar/suggestions/:id/hide', async (req) => {
    const { user } = signedIn(req);
    radar.hide(user.id, artistId(req.params.id));
    return { ok: true };
  });
}
