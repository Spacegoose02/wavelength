import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import { clientIp, HttpError, need, signedIn } from '../http.ts';
import { createService, deleteService, getService, listServices, removeServiceUser, servicesFor, setServiceUser, updateService } from '../services.ts';
import { getUser } from '../users.ts';

/**
 * Server logins (services.ts). Admins manage them under /api/admin/services; every signed-in device
 * fetches the ones its user may use from /api/me/services. Audit entries name fields, never values.
 */
export function serviceRoutes(app: FastifyInstance, { db, config }: Ctx) {
  const key = config.secretKey;
  const body = (b: unknown) => (b ?? {}) as Record<string, unknown>;

  app.get('/api/me/services', async (req) => ({ services: servicesFor(db, key, signedIn(req)) }));

  app.get('/api/admin/services', async (req) => {
    need(req, 'keys.manage');
    return { services: listServices(db, key) };
  });

  app.post('/api/admin/services', async (req) => {
    const { user } = need(req, 'keys.manage');
    const s = createService(db, key, body(req.body));
    audit(db, { actorId: user.id, action: 'service.created', target: s.name, detail: { kind: s.kind, access: s.access, secrets: s.secretsSet }, ip: clientIp(req) });
    return { service: s };
  });

  app.patch<{ Params: { id: string } }>('/api/admin/services/:id', async (req) => {
    const { user } = need(req, 'keys.manage');
    const { service, changed } = updateService(db, key, Number(req.params.id), body(req.body));
    if (changed.length) audit(db, { actorId: user.id, action: 'service.updated', target: service.name, detail: { changed }, ip: clientIp(req) });
    return { service };
  });

  app.delete<{ Params: { id: string } }>('/api/admin/services/:id', async (req) => {
    const { user } = need(req, 'keys.manage');
    const r = deleteService(db, Number(req.params.id));
    audit(db, { actorId: user.id, action: 'service.deleted', target: r.name, detail: { kind: r.kind }, ip: clientIp(req) });
    return { ok: true };
  });

  /** Let someone use a 'chosen' server and/or give them their own login: `{ secrets?: { token } }`. */
  app.put<{ Params: { id: string; userId: string } }>('/api/admin/services/:id/users/:userId', async (req) => {
    const { user } = need(req, 'keys.manage');
    const target = getUser(db, Number(req.params.userId));
    if (!target) throw new HttpError(404, 'No such user');
    const s = setServiceUser(db, key, Number(req.params.id), target.id, body(req.body).secrets);
    const own = s.users.find((u) => u.userId === target.id)?.secretsSet ?? [];
    audit(db, { actorId: user.id, action: 'service.user_set', target: s.name, detail: { user: target.username, ownLogin: own }, ip: clientIp(req) });
    return { service: s };
  });

  app.delete<{ Params: { id: string; userId: string } }>('/api/admin/services/:id/users/:userId', async (req) => {
    const { user } = need(req, 'keys.manage');
    const target = getUser(db, Number(req.params.userId));
    if (!target || !getService(db, key, Number(req.params.id))) throw new HttpError(404, 'No such user or server');
    const s = removeServiceUser(db, key, Number(req.params.id), target.id);
    audit(db, { actorId: user.id, action: 'service.user_removed', target: s.name, detail: { user: target.username }, ip: clientIp(req) });
    return { service: s };
  });
}
