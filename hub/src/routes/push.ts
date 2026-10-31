import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import { clientIp, HttpError, need, signedIn, str } from '../http.ts';
import { onNotify } from '../notify.ts';
import { dropTopic, newTopic, postPush, pushNotices, pushSettings, savePushSettings, topicOf } from '../push.ts';

/** Push notifications through ntfy (push.ts): the admin's server, and each person's own topic. */
export function pushRoutes(app: FastifyInstance, { db, config }: Ctx) {
  // the Inbox opens in a browser from the notification; the app has its own notifications when open
  onNotify(db, (ids, kind, title, body) => pushNotices(db, config.secretKey, ids, kind, title, body, `${config.publicUrl}/`));

  const mine = (userId: number) => {
    const s = pushSettings(db);
    const topic = s ? topicOf(db, userId) : undefined;
    const host = s ? new URL(s.server).host : undefined;
    return {
      available: !!s,
      server: s?.server ?? null,
      topic: topic ?? null,
      // the ntfy app opens these links and offers to subscribe
      subscribeUrl: topic ? `ntfy://${host}/${topic}` : null,
      webUrl: topic ? `${s!.server}/${topic}` : null,
    };
  };

  app.get('/api/me/push', async (req) => mine(signedIn(req).user.id));

  /** Turn push on (a new topic) for the caller. */
  app.post('/api/me/push', async (req) => {
    const { user } = signedIn(req);
    if (!pushSettings(db)) throw new HttpError(409, 'Push notifications aren’t set up on this Hub. Ask an admin');
    newTopic(db, user.id);
    return mine(user.id);
  });

  app.delete('/api/me/push', async (req) => {
    const { user } = signedIn(req);
    dropTopic(db, user.id);
    return mine(user.id);
  });

  app.post('/api/me/push/test', async (req) => {
    const { user } = signedIn(req);
    const topic = topicOf(db, user.id);
    if (!topic || !pushSettings(db)) throw new HttpError(409, 'Turn push notifications on first');
    try {
      await postPush(db, config.secretKey, topic, 'share', 'Wavelength', 'Push notifications work. You’ll get news here while the app is closed.');
    } catch (e) {
      throw new HttpError(502, `Couldn’t send it: ${(e as Error).message}`);
    }
    return { ok: true };
  });

  app.get('/api/admin/push', async (req) => {
    need(req, 'keys.manage');
    const s = pushSettings(db);
    return { server: s?.server ?? '', hasToken: !!s?.token };
  });

  /** `{ server, token? }`: '' turns push off. `token: null` removes the saved one, leaving it out keeps it. */
  app.put('/api/admin/push', async (req) => {
    const { user } = need(req, 'keys.manage');
    const b = (req.body ?? {}) as { token?: unknown };
    let server = str(req.body, 'server', 300).replace(/\/+$/, '');
    if (server) {
      let u: URL;
      try {
        u = new URL(server);
      } catch {
        throw new HttpError(400, 'That isn’t an address, e.g. https://ntfy.sh');
      }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new HttpError(400, 'The ntfy server needs an http(s) address');
      if (u.username || u.password || u.search || u.hash) throw new HttpError(400, 'Just the server’s address, without a login or topic');
      server = `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
    }
    const token = b.token === null ? null : typeof b.token === 'string' && b.token.trim() ? b.token.trim().slice(0, 200) : undefined;
    savePushSettings(db, config.secretKey, { server, token });
    audit(db, { actorId: user.id, action: 'push.settings', target: server || 'off', ip: clientIp(req) });
    const s = pushSettings(db);
    return { server: s?.server ?? '', hasToken: !!s?.token };
  });
}
