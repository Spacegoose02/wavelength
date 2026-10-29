import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { signedIn } from '../http.ts';
import { noticesAfter, pruneNotices } from '../notify.ts';

/**
 * A device's system notifications (notify.ts). `GET /api/notifications?after=<id>` returns yours after the
 * last one the device showed; without `after` it returns none, only where to start.
 */
export function notificationRoutes(app: FastifyInstance, { db }: Ctx) {
  const timer = setInterval(() => pruneNotices(db), 6 * 3600_000);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));
  pruneNotices(db);

  app.get('/api/notifications', async (req) => {
    const { user } = signedIn(req);
    const raw = (req.query as Record<string, unknown>).after;
    const after = Number(raw);
    const r = noticesAfter(db, user.id, Number.isSafeInteger(after) && after >= 0 ? after : Number.MAX_SAFE_INTEGER);
    return raw === undefined || raw === '' ? { notifications: [], last: r.last } : r;
  });
}
