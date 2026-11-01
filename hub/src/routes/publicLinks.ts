import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import { featureOn, requireFeature } from '../features.ts';
import { clientIp, html, HttpError, signedIn } from '../http.ts';
import { message } from '../pages.ts';
import { createLink, deleteLink, getLink, linkPage, myLinks, seen } from '../publicLinks.ts';
import { permissionsFor } from '../roles.ts';

/** Public share links (publicLinks.ts). Making one needs the publicShares feature; viewing needs nothing. */
export function publicLinkRoutes(app: FastifyInstance, { db, config }: Ctx) {
  app.post('/api/public-links', async (req) => {
    const { user } = signedIn(req);
    requireFeature(db, 'publicShares', user);
    if (user.role === 'kid') throw new HttpError(403, 'Kid profiles can’t make public links');
    const link = createLink(db, user.id, req.body);
    audit(db, { actorId: user.id, action: 'publicLink.created', target: `${link.kind}: ${link.title}`.slice(0, 200), ip: clientIp(req) });
    return { link, url: `${config.publicUrl}/s/${link.token}` };
  });

  app.get('/api/public-links', async (req) => {
    const { user } = signedIn(req);
    return { links: myLinks(db, user.id).map((l) => ({ ...l, url: `${config.publicUrl}/s/${l.token}` })) };
  });

  app.delete<{ Params: { token: string } }>('/api/public-links/:token', async (req) => {
    const { user } = signedIn(req);
    deleteLink(db, req.params.token, user.id, permissionsFor(user).includes('users.manage'));
    audit(db, { actorId: user.id, action: 'publicLink.deleted', target: req.params.token, ip: clientIp(req) });
    return { ok: true };
  });

  /** The page itself: no sign-in. Gone when expired, taken down, its owner disabled, or the feature switched off. */
  app.get<{ Params: { token: string } }>('/s/:token', async (req, reply) => {
    const token = String(req.params.token).slice(0, 64);
    const l = /^[\w-]+$/.test(token) ? getLink(db, token) : null;
    const owner = l && (db.prepare('SELECT role FROM users WHERE id = (SELECT user_id FROM public_links WHERE token = ?)').get(token) as { role: string } | undefined);
    if (!l || !owner || !featureOn(db, 'publicShares', owner) || (l.expiresAt !== null && l.expiresAt < Date.now())) {
      return html(reply, message('Link not available', 'This share link has expired or was taken down. Ask the person who sent it for a new one.', true), 404);
    }
    seen(db, token);
    return reply
      .header('content-type', 'text/html; charset=utf-8')
      .header('cache-control', 'private, max-age=60')
      .header('x-frame-options', 'DENY')
      .header('referrer-policy', 'no-referrer')
      // covers come from public image hosts (Deezer, Apple…), so images may load from any https address
      .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; img-src https:; frame-ancestors 'none'; base-uri 'none'")
      .send(linkPage(l));
  });
}
