import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { HttpError, signedIn, str } from '../http.ts';
import { SERVICES, type Service } from '../scrobble.ts';

/** Your own scrobbling accounts (scrobble.ts): connect ListenBrainz or Last.fm, see them, disconnect. */
export function scrobbleRoutes(app: FastifyInstance, { scrobbler }: Ctx) {
  app.get('/api/me/scrobble', async (req) => {
    const { user } = signedIn(req);
    return { accounts: scrobbler.accounts(user.id), lastfmAvailable: scrobbler.lastfmAvailable };
  });

  /** `{ token }` for ListenBrainz; `{ username, password }` for Last.fm (the password isn't kept). */
  app.post<{ Params: { service: string } }>('/api/me/scrobble/:service', async (req) => {
    const { user } = signedIn(req);
    const b = req.body ?? {};
    if (req.params.service === 'listenbrainz') {
      const token = str(b, 'token', 200);
      if (!token) throw new HttpError(400, 'Paste your ListenBrainz user token');
      return { account: await scrobbler.connectListenBrainz(user.id, token) };
    }
    if (req.params.service === 'lastfm') {
      const username = str(b, 'username', 100), password = str(b, 'password', 200);
      if (!username || !password) throw new HttpError(400, 'Send your Last.fm username and password');
      return { account: await scrobbler.connectLastfm(user.id, username, password) };
    }
    throw new HttpError(404, 'No such service');
  });

  app.delete<{ Params: { service: string } }>('/api/me/scrobble/:service', async (req) => {
    const { user } = signedIn(req);
    if (!SERVICES.includes(req.params.service as Service)) throw new HttpError(404, 'No such service');
    scrobbler.disconnect(user.id, req.params.service as Service);
    return { ok: true };
  });
}
