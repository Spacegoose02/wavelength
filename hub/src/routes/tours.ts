import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import { featureOn, requireFeature } from '../features.ts';
import { clientIp, need, signedIn } from '../http.ts';
import { saveTourSettings, tourSettings } from '../tours.ts';

/** Tour dates (tours.ts): listeners ask for an artist's dates; admins save the provider and key. */
export function tourRoutes(app: FastifyInstance, { db, config, tours }: Ctx) {
  app.get<{ Querystring: { artist?: string } }>('/api/tours', async (req) => {
    const { user } = signedIn(req);
    requireFeature(db, 'tourDates', user);
    return { events: await tours.upcoming(req.query.artist ?? '') };
  });

  /** Whether the app should show tour dates at all (on, and a key saved). */
  app.get('/api/tours/status', async (req) => {
    const { user } = signedIn(req);
    return { available: featureOn(db, 'tourDates', user) && tourSettings(db, config.secretKey).keySet };
  });

  app.get('/api/admin/tours', async (req) => {
    need(req, 'users.manage');
    return tourSettings(db, config.secretKey);
  });

  app.put('/api/admin/tours', async (req) => {
    const { user } = need(req, 'users.manage');
    const out = saveTourSettings(db, config.secretKey, req.body);
    audit(db, { actorId: user.id, action: 'tours.changed', target: out.provider, ip: clientIp(req) });
    return out;
  });
}
