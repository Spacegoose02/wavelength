import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import { clientIp, need, signedIn } from '../http.ts';
import { addStation, deleteStation, importFromNavidrome, listStations, radioImportedAt, readStation, updateStation } from '../radioStations.ts';

/**
 * Internet radio stations on the Hub (radioStations.ts). Everyone signed in reads them; admins (`library.edit`, as
 * only Navidrome admins could change them before) add, change and delete them. The first copy from Navidrome runs
 * by itself a minute after the Hub starts, once it has the Navidrome admin login.
 */
export function radioStationRoutes(app: FastifyInstance, { db, config }: Ctx) {
  const out = () => ({ imported: radioImportedAt(db) !== null, importedAt: radioImportedAt(db), stations: listStations(db) });

  app.get('/api/radio/stations', async (req) => {
    signedIn(req);
    return out();
  });

  app.post('/api/admin/radio/stations', async (req) => {
    const { user } = need(req, 'library.edit');
    const s = addStation(db, readStation(req.body as Record<string, unknown>) as { name: string; streamUrl: string; homePageUrl?: string });
    audit(db, { actorId: user.id, action: 'radio.added', target: s.name, ip: clientIp(req) });
    return { station: s, ...out() };
  });

  app.put<{ Params: { id: string } }>('/api/admin/radio/stations/:id', async (req) => {
    const { user } = need(req, 'library.edit');
    const s = updateStation(db, req.params.id, readStation(req.body as Record<string, unknown>, true));
    audit(db, { actorId: user.id, action: 'radio.changed', target: s.name, ip: clientIp(req) });
    return { station: s, ...out() };
  });

  app.delete<{ Params: { id: string } }>('/api/admin/radio/stations/:id', async (req) => {
    const { user } = need(req, 'library.edit');
    const name = listStations(db).find((s) => s.id === req.params.id)?.name ?? req.params.id;
    deleteStation(db, req.params.id);
    audit(db, { actorId: user.id, action: 'radio.deleted', target: name, ip: clientIp(req) });
    return out();
  });

  /** Copy Navidrome's stations again (ones the Hub has already are left alone). */
  app.post('/api/admin/radio/import', async (req) => {
    const { user } = need(req, 'library.edit');
    const r = await importFromNavidrome(db, config.secretKey);
    audit(db, { actorId: user.id, action: 'radio.imported', detail: r ?? { login: false }, ip: clientIp(req) });
    return { result: r, ...out() };
  });

  // the first copy, by itself: a minute after start, then every 10 minutes until it has the Navidrome admin login
  if (radioImportedAt(db) === null) {
    const tryImport = () => {
      if (radioImportedAt(db) !== null) return clearInterval(timer);
      void importFromNavidrome(db, config.secretKey).then((r) => {
        if (r) {
          clearInterval(timer);
          audit(db, { action: 'radio.imported', detail: r });
        }
      }).catch(() => undefined);
    };
    const first = setTimeout(tryImport, 60_000);
    const timer = setInterval(tryImport, 10 * 60_000);
    first.unref();
    timer.unref();
    app.addHook('onClose', async () => {
      clearTimeout(first);
      clearInterval(timer);
    });
  }
}
