import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import { clientIp, HttpError, need } from '../http.ts';
import { FACETS, type Facet } from '../itemTags.ts';
import { listServices } from '../services.ts';

/**
 * Import from Plex (plexImport.ts, docs/HUB.md "Importing from Plex"), for admins (`library.edit`): read the Plex
 * server and see what matches (nothing is written), then import the styles, moods, collections and artist genres.
 * Album genres are only suggested; the app applies them with POST /api/admin/genres/apply.
 */
export function plexImportRoutes(app: FastifyInstance, { db, config, plexImport }: Ctx) {
  const servers = () => listServices(db, config.secretKey).filter((s) => s.kind === 'plex').map((s) => ({ id: s.id, name: s.name, token: s.secretsSet.includes('token') }));

  app.get('/api/admin/plex-import', async (req) => {
    need(req, 'library.edit');
    return { ...plexImport.status, servers: servers() };
  });

  /** `{ serviceId? }`: read Plex in the background; GET shows how far it got and then the preview. */
  app.post('/api/admin/plex-import/read', async (req, reply) => {
    need(req, 'library.edit');
    const id = (req.body as { serviceId?: unknown } | null)?.serviceId;
    try {
      plexImport.read(typeof id === 'number' ? id : undefined);
    } catch (e) {
      throw new HttpError(409, (e as Error).message);
    }
    reply.code(202);
    return { ...plexImport.status, servers: servers() };
  });

  /** `{ facets? }` (genre, style, mood, collection; all by default): write what the last read found. */
  app.post('/api/admin/plex-import/apply', async (req) => {
    const { user } = need(req, 'library.edit');
    const raw = (req.body as { facets?: unknown } | null)?.facets;
    if (raw !== undefined && (!Array.isArray(raw) || raw.some((f) => !(FACETS as readonly unknown[]).includes(f)))) throw new HttpError(400, `facets must be some of: ${FACETS.join(', ')}`);
    let r: { albums: number; artists: number };
    try {
      r = plexImport.apply({ facets: raw as Facet[] | undefined, userId: user.id });
    } catch (e) {
      throw new HttpError(409, (e as Error).message);
    }
    audit(db, { actorId: user.id, action: 'itemTags.imported', target: plexImport.status.preview?.server ?? 'Plex', detail: { ...r, facets: raw ?? 'all' }, ip: clientIp(req) });
    return { ...plexImport.status, servers: servers() };
  });
}
