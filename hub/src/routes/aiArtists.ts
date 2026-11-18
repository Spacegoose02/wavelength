import type { FastifyInstance } from 'fastify';
import { aiArtist, aiArtists, renameAiArtist, setAiArtist } from '../aiArtists.ts';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import { clientIp, HttpError, need, signedIn, str } from '../http.ts';

/**
 * AI-generated artists (hub/src/aiArtists.ts, docs/HUB.md "AI-generated artists"). Everyone signed in reads the
 * list; admins with `library.edit` mark and unmark artists from Edit artist, an artist's Deezer page or a song's menu.
 */
export function aiArtistRoutes(app: FastifyInstance, { db }: Ctx) {
  /** Every marked artist at once: the app keeps the list for its badges and filters. */
  app.get('/api/ai-artists', async (req) => {
    signedIn(req);
    return { artists: aiArtists(db) };
  });

  /** `{ name, ai: boolean }` → `{ artist }`, the artist's mark now (null when unmarked). */
  app.put('/api/admin/ai-artists', async (req) => {
    const { user } = need(req, 'library.edit');
    const body = req.body as Record<string, unknown> | null;
    const name = str(body, 'name', 300);
    if (!name) throw new HttpError(400, 'name is needed');
    if (typeof body?.ai !== 'boolean') throw new HttpError(400, 'ai must be true or false');
    let changed: boolean;
    try {
      changed = setAiArtist(db, name, body.ai, user.id);
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    if (changed) audit(db, { actorId: user.id, action: body.ai ? 'artist.aiMarked' : 'artist.aiUnmarked', target: name, ip: clientIp(req) });
    return { artist: aiArtist(db, name) };
  });

  /** `{ from, to }`: an artist was renamed (Edit artist), so their mark follows. */
  app.post('/api/admin/ai-artists/rename', async (req) => {
    need(req, 'library.edit');
    const body = req.body as Record<string, unknown> | null;
    const from = str(body, 'from', 300);
    const to = str(body, 'to', 300);
    if (!from || !to) throw new HttpError(400, 'from and to are needed');
    return { moved: renameAiArtist(db, from, to) };
  });
}
