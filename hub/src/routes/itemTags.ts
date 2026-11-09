import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import { clientIp, HttpError, need, signedIn, str } from '../http.ts';
import { cleanValues, FACETS_OF, type Facets, isKind, readAll, readItem, renameItem, setItem, tagValues } from '../itemTags.ts';

/**
 * Styles, moods, collections and artist genres (hub/src/itemTags.ts, docs/HUB.md "Styles, moods and collections").
 * Everyone signed in reads them; admins with `library.edit` set them from the app's Edit album and Edit artist.
 */

/** The body's lists, by the names the app sends ("styles") and the facet they fill ("style"). */
const LISTS = { genres: 'genre', styles: 'style', moods: 'mood', collections: 'collection' } as const;

export function itemTagRoutes(app: FastifyInstance, { db }: Ctx) {
  /** Everything at once: the app keeps it for Browse, the filters and the album and artist pages. */
  app.get('/api/item-tags', async (req) => {
    signedIn(req);
    return { ...readAll(db), values: tagValues(db) };
  });

  /** One album (`kind=album&artist=&title=`) or artist (`kind=artist&artist=`). */
  app.get<{ Querystring: { kind?: string; artist?: string; title?: string } }>('/api/item-tags/one', async (req) => {
    signedIn(req);
    const { kind } = req.query;
    if (!isKind(kind)) throw new HttpError(400, 'kind must be artist or album');
    const artist = (req.query.artist ?? '').trim().slice(0, 300);
    const title = (req.query.title ?? '').trim().slice(0, 300);
    if (!artist || (kind === 'album' && !title)) throw new HttpError(400, kind === 'album' ? 'artist and title are needed' : 'artist is needed');
    return readItem(db, kind, artist, title);
  });

  /** `{ kind, artist, title?, genres?, styles?, moods?, collections? }`: each list sent replaces what was there. */
  app.put('/api/admin/item-tags', async (req) => {
    const { user } = need(req, 'library.edit');
    const body = req.body as Record<string, unknown> | null;
    const kind = body?.kind;
    if (!isKind(kind)) throw new HttpError(400, 'kind must be artist or album');
    const artist = str(body, 'artist', 300);
    const title = str(body, 'title', 300);
    if (!artist || (kind === 'album' && !title)) throw new HttpError(400, kind === 'album' ? 'artist and title are needed' : 'artist is needed');
    const facets: Facets = {};
    for (const [field, facet] of Object.entries(LISTS)) {
      if (body?.[field] === undefined) continue;
      if (!FACETS_OF[kind].includes(facet)) throw new HttpError(400, `An ${kind}'s ${field} can't be set here${facet === 'genre' ? ': an album’s genres are in its files (PUT /api/admin/tags)' : ''}`);
      const vals = cleanValues(body[field]);
      if (!vals) throw new HttpError(400, `${field} must be a list of names`);
      facets[facet] = vals;
    }
    const changed = setItem(db, { kind, artist, title, facets, userId: user.id });
    if (changed.length) audit(db, { actorId: user.id, action: 'itemTags.edited', target: kind === 'album' ? `${artist} – ${title}` : artist, detail: { kind, changed }, ip: clientIp(req) });
    return readItem(db, kind, artist, title);
  });

  /** `{ kind, from: { artist, title? }, to: { artist, title? } }`: the tags follow a rename (and an artist's albums too). */
  app.post('/api/admin/item-tags/rename', async (req) => {
    const { user } = need(req, 'library.edit');
    const body = req.body as Record<string, unknown> | null;
    const kind = body?.kind;
    if (!isKind(kind)) throw new HttpError(400, 'kind must be artist or album');
    const from = { artist: str(body?.from, 'artist', 300), title: str(body?.from, 'title', 300) };
    const to = { artist: str(body?.to, 'artist', 300), title: str(body?.to, 'title', 300) };
    if (!from.artist || !to.artist || (kind === 'album' && (!from.title || !to.title))) throw new HttpError(400, 'from and to need an artist (and a title for an album)');
    const moved = renameItem(db, { kind, from, to, userId: user.id });
    if (moved) audit(db, { actorId: user.id, action: 'itemTags.renamed', target: kind === 'album' ? `${to.artist} – ${to.title}` : to.artist, detail: { kind, from, moved }, ip: clientIp(req) });
    return { moved };
  });
}
