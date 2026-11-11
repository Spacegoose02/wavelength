import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import { featureOn, requireFeature } from '../features.ts';
import { clientIp, need, signedIn } from '../http.ts';
import { saveTourSettings, tourKey, tourSettings } from '../tours.ts';

/** Tour dates (tours.ts): listeners ask for an artist's dates; admins save the provider and key. */
export function tourRoutes(app: FastifyInstance, { db, config, tours }: Ctx) {
  app.get<{ Querystring: { artist?: string } }>('/api/tours', async (req) => {
    const { user } = signedIn(req);
    requireFeature(db, 'tourDates', user);
    return { events: await tours.upcoming(req.query.artist ?? '', user.id) };
  });

  /** Whether the app should show tour dates at all (on, and a key saved). */
  app.get('/api/tours/status', async (req) => {
    const { user } = signedIn(req);
    return { available: featureOn(db, 'tourDates', user) && !!tourKey(db, config.secretKey, user.id) };
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

/** Music videos (videos.ts): the official video for a song, as a YouTube id. */
export function videoRoutes(app: FastifyInstance, { db, videos }: Ctx) {
  app.get<{ Querystring: { artist?: string; title?: string; duration?: string } }>('/api/videos', async (req) => {
    const { user } = signedIn(req);
    requireFeature(db, 'musicVideos', user);
    const d = Number(req.query.duration);
    return { video: await videos.find(req.query.artist ?? '', req.query.title ?? '', Number.isFinite(d) && d > 0 ? d : undefined) };
  });
  // a podcast episode's video, posted by the show
  app.get<{ Querystring: { show?: string; title?: string; duration?: string } }>('/api/videos/episode', async (req) => {
    const { user } = signedIn(req);
    requireFeature(db, 'musicVideos', user);
    const d = Number(req.query.duration);
    return { video: await videos.findEpisode(req.query.show ?? '', req.query.title ?? '', Number.isFinite(d) && d > 0 ? d : undefined) };
  });
}
