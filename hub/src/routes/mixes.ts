import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { kidsOf, guardiansOf } from '../family.ts';
import { requireFeature } from '../features.ts';
import { HttpError, signedIn } from '../http.ts';
import { blendOptedIn, setBlendOptIn } from '../mixes.ts';
import { getUser, listUsers, type User } from '../users.ts';

/** Made for you mixes and Blends (mixes.ts). */
export function mixRoutes(app: FastifyInstance, { db, mixes }: Ctx) {
  app.get<{ Querystring: { fresh?: string } }>('/api/mixes', async (req) => {
    const { user } = signedIn(req);
    requireFeature(db, 'homeMixes', user);
    return mixes.get(user.id, user.role === 'kid', req.query.fresh === '1');
  });

  /** Who this person may make a Blend with: grown-ups with grown-ups and their own kids; kids with their parents. */
  const partners = (me: User): User[] => {
    const all = listUsers(db).filter((u) => u.id !== me.id && !u.disabled);
    if (me.role === 'kid') {
      const g = new Set(guardiansOf(db, me.id));
      return all.filter((u) => g.has(u.id));
    }
    const kids = new Set(kidsOf(db, me.id));
    return all.filter((u) => u.role !== 'kid' || kids.has(u.id));
  };

  app.get('/api/blend/people', async (req) => {
    const { user } = signedIn(req);
    requireFeature(db, 'blend', user);
    return {
      optedIn: blendOptedIn(db, user.id),
      people: partners(user).map((u) => ({ id: u.id, displayName: u.displayName, optedIn: blendOptedIn(db, u.id) })),
    };
  });

  app.put('/api/blend/optin', async (req) => {
    const { user } = signedIn(req);
    requireFeature(db, 'blend', user);
    const on = (req.body as { on?: unknown } | null)?.on;
    if (typeof on !== 'boolean') throw new HttpError(400, 'Send { on: true } or { on: false }');
    setBlendOptIn(db, user.id, on);
    return { optedIn: on };
  });

  app.get<{ Querystring: { with?: string } }>('/api/blend', async (req) => {
    const { user } = signedIn(req);
    requireFeature(db, 'blend', user);
    if (!blendOptedIn(db, user.id)) throw new HttpError(409, 'Turn on Blends for yourself first');
    const ids = [...new Set(String(req.query.with ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 5);
    if (!ids.length) throw new HttpError(400, 'Pick someone to blend with');
    const allowed = new Set(partners(user).map((u) => u.id));
    const others = ids.map((id) => getUser(db, id));
    for (const [i, o] of others.entries()) {
      if (!o || !allowed.has(o.id)) throw new HttpError(404, `No one to blend with as ${ids[i]}`);
      if (!blendOptedIn(db, o.id)) throw new HttpError(409, `${o.displayName} hasn’t turned on Blends`);
    }
    const mix = mixes.blend([{ id: user.id, displayName: user.displayName }, ...others.map((o) => ({ id: o!.id, displayName: o!.displayName }))]);
    // Blends with a kid stay kid-friendly: the app's kid filter does the rest
    return { mix };
  });
}
