import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import { clientIp, HttpError, need, signedIn } from '../http.ts';
import { createService, deleteService, getService, listServices, relayPassword, relayTarget, relayUsername, removeServiceUser, serviceIdOfKind, servicesFor, setServiceFamilies, setServiceUser, updateService } from '../services.ts';
import { createDevice, listDevices } from '../devices.ts';
import { getUser } from '../users.ts';

/**
 * Server logins (services.ts). Admins manage them under /api/admin/services; every signed-in device
 * fetches the ones its user may use from /api/me/services. Audit entries name fields, never values.
 */
export function serviceRoutes(app: FastifyInstance, { db, config }: Ctx) {
  const key = config.secretKey;
  const body = (b: unknown) => (b ?? {}) as Record<string, unknown>;

  app.get('/api/me/services', async (req) => ({ services: servicesFor(db, key, signedIn(req)) }));

  /**
   * Logins for other music apps (SUB/WAVE, Symfonium, Feishin…): a Subsonic address and login on the Hub's relay
   * (routes/relay.ts), so they work with Navidrome off. Each is a device of its own (platform `subsonic-app`): the
   * password is made from its id, so it can be shown again, and signing the device out under Your devices ends it.
   */
  const APP = 'subsonic-app';
  const appLogin = (deviceId: number, name: string, createdAt: number, user: { username: string }, serviceId: number) =>
    ({ id: deviceId, name, createdAt, path: `/nd/${serviceId}`, username: relayUsername(user.username, deviceId), password: relayPassword(key, deviceId) });
  const relayFor = (user: { id: number; role: string }) => {
    const id = serviceIdOfKind(db, 'navidrome');
    return id !== undefined && relayTarget(db, key, id, user.id, user.role) ? id : undefined;
  };

  app.get('/api/me/app-logins', async (req) => {
    const { user } = signedIn(req);
    const id = relayFor(user);
    if (id === undefined) return { available: false, logins: [] };
    return { available: true, logins: listDevices(db, user.id).filter((d) => d.platform === APP).map((d) => appLogin(d.id, d.name, d.createdAt, user, id)) };
  });

  app.post('/api/me/app-logins', async (req) => {
    const { user } = signedIn(req);
    const name = String(body(req.body).name ?? '').trim().slice(0, 60);
    if (!name) throw new HttpError(400, 'Name the app (SUB/WAVE, Symfonium…)');
    const id = relayFor(user);
    if (id === undefined) throw new HttpError(409, 'Other apps sign in through the Hub once Navidrome is off, or “Send everyone through the Hub” is on (Settings → Server)');
    const { device } = createDevice(db, user.id, name, APP);
    audit(db, { actorId: user.id, action: 'device.app_login', target: name, ip: clientIp(req) });
    return { login: appLogin(device.id, device.name, device.createdAt, user, id) };
  });

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

  /** `{ ids }`: only these families get this server (families.ts); `{ ids: [] }` for every family. */
  app.put<{ Params: { id: string } }>('/api/admin/services/:id/families', async (req) => {
    const { user } = need(req, 'keys.manage');
    const s = setServiceFamilies(db, key, Number(req.params.id), body(req.body).ids);
    audit(db, { actorId: user.id, action: 'service.families', target: s.name, detail: { families: s.families }, ip: clientIp(req) });
    return { service: s };
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
