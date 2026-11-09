import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import { clientIp, HttpError, need, signedIn, str } from '../http.ts';
import { cleanValues, FACETS_OF, type Facets, isKind, readAll, readItem, renameItem, setItem, tagValues } from '../itemTags.ts';
import { readAllTracks, readTrack, renameTracks, setTrack, type TrackFacets, withTrackCounts } from '../trackTags.ts';

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
    return { ...readAll(db), values: withTrackCounts(tagValues(db), db) };
  });

  /** Every song with a style or mood (hub/src/trackTags.ts): asked for apart, only when the app needs them. */
  app.get('/api/item-tags/tracks', async (req) => {
    signedIn(req);
    return { tracks: readAllTracks(db) };
  });

  /** One song (`artist=&album=&title=`, the album artist). */
  app.get<{ Querystring: { artist?: string; album?: string; title?: string } }>('/api/item-tags/track', async (req) => {
    signedIn(req);
    const [artist, album, title] = [req.query.artist, req.query.album, req.query.title].map((v) => (v ?? '').trim().slice(0, 300));
    if (!artist || !title) throw new HttpError(400, 'artist and title are needed');
    return readTrack(db, artist, album, title);
  });

  /** `{ artist, album, title, styles?, moods? }`: a song's own styles and moods (the album artist and album name it). */
  app.put('/api/admin/track-tags', async (req) => {
    const { user } = need(req, 'library.edit');
    const body = req.body as Record<string, unknown> | null;
    const artist = str(body, 'artist', 300);
    const album = str(body, 'album', 300);
    const title = str(body, 'title', 300);
    if (!artist || !title) throw new HttpError(400, 'artist and title are needed');
    const facets: TrackFacets = {};
    for (const [field, facet] of [['styles', 'style'], ['moods', 'mood']] as const) {
      if (body?.[field] === undefined) continue;
      const vals = cleanValues(body[field]);
      if (!vals) throw new HttpError(400, `${field} must be a list of names`);
      facets[facet] = vals;
    }
    if (body?.genres !== undefined || body?.collections !== undefined) throw new HttpError(400, 'A song takes styles and moods here; its genres are in its file');
    const changed = setTrack(db, { artist, album, title, facets, userId: user.id });
    if (changed.length) audit(db, { actorId: user.id, action: 'itemTags.edited', target: `${artist} – ${title}`, detail: { kind: 'track', album, changed }, ip: clientIp(req) });
    return readTrack(db, artist, album, title);
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

  /** `{ from: { artist, album, title }, to: { … } }`: a song's styles and moods follow when its tags are edited. */
  app.post('/api/admin/track-tags/rename', async (req) => {
    need(req, 'library.edit');
    const body = req.body as Record<string, unknown> | null;
    const side = (v: unknown) => ({ artist: str(v, 'artist', 300), album: str(v, 'album', 300), title: str(v, 'title', 300) });
    const from = side(body?.from);
    const to = side(body?.to);
    if (!from.artist || !from.title || !to.artist || !to.title) throw new HttpError(400, 'from and to need an artist and a title');
    return { moved: renameTracks(db, { kind: 'track', from, to }) };
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
    // songs follow too: all of an artist's, or an album's
    const moved = renameItem(db, { kind, from, to, userId: user.id })
      + renameTracks(db, { kind, from: { artist: from.artist, album: from.title }, to: { artist: to.artist, album: to.title } });
    if (moved) audit(db, { actorId: user.id, action: 'itemTags.renamed', target: kind === 'album' ? `${to.artist} – ${to.title}` : to.artist, detail: { kind, from, moved }, ip: clientIp(req) });
    return { moved };
  });
}
