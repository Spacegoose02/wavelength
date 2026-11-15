import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { managedFamily } from '../families.ts';
import { HttpError, html, signedIn } from '../http.ts';
import { message } from '../pages.ts';

/**
 * Move from Spotify by signing in (spotify.ts). The export file needs none of this: the app reads it itself.
 *
 * - `GET /api/spotify` — whether sign-in is set up for you, the address to give Spotify, and whether you may set it up.
 * - `POST /api/spotify/connect` — `{ url }` to open in a browser to sign in to Spotify.
 * - `GET /auth/spotify/callback` — where Spotify sends the browser back; a page that says to go back to Wavelength.
 * - `GET /api/spotify/import` — `{ job }`: working, ready (with what was read) or error. `DELETE` forgets it.
 */
export function spotifyRoutes(app: FastifyInstance, { db, spotify }: Ctx) {
  app.get('/api/spotify', async (req) => {
    const { user, permissions } = signedIn(req);
    return {
      configured: !!spotify.app(user.id),
      redirectUri: spotify.redirectUri,
      redirectOk: spotify.redirectOk,
      // admins set it up for the whole Hub, a family's manager for their family (when allowed its own keys)
      setUp: permissions.includes('users.manage') ? 'hub' : managedFamily(db, user, 'ownKeys') ? 'family' : null,
    };
  });

  app.post('/api/spotify/connect', async (req) => {
    const { user } = signedIn(req);
    if (!spotify.redirectOk) throw new HttpError(400, 'Spotify only signs in to a Hub on an https:// address. Set the Hub’s public URL to one');
    return { url: spotify.start(user.id) };
  });

  app.get('/auth/spotify/callback', async (req, reply) => {
    const q = req.query as { code?: string; state?: string; error?: string };
    try {
      await spotify.finish(String(q.state ?? ''), q.code, q.error);
      if (q.error) return html(reply, message('Spotify', 'Nothing was read from Spotify. You can close this page.'));
      return html(reply, message('Spotify connected', 'Done. Go back to Wavelength: it’s reading your playlists, liked songs and artists now. You can close this page.'));
    } catch (e) {
      const status = e instanceof HttpError ? e.statusCode : 500;
      return html(reply, message('Spotify', (e as Error).message, true), status);
    }
  });

  app.get('/api/spotify/import', async (req) => {
    const { user } = signedIn(req);
    return { job: spotify.job(user.id) };
  });

  app.delete('/api/spotify/import', async (req) => {
    const { user } = signedIn(req);
    spotify.clear(user.id);
    return { ok: true };
  });
}
