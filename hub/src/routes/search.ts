import type { FastifyInstance } from 'fastify';
import type { LibrarySearchResponse } from '../api/library.ts';
import type { Ctx } from '../app.ts';
import { words } from '../librarySearch.ts';
import { signedIn } from '../http.ts';

/** Plays per artist for one person over the last year, keyed like librarySearch's artist key. */
function playsByArtist(ctx: Ctx, userId: number): Map<string, number> {
  const since = Date.now() - 365 * 86_400_000;
  const rows = ctx.db
    .prepare('SELECT artist, COUNT(*) AS n FROM plays WHERE user_id = ? AND played_at > ? GROUP BY artist')
    .all(userId, since) as { artist: string; n: number }[];
  return new Map(rows.map((r) => [words(r.artist).join(' '), r.n]));
}

/**
 * Search (docs/HUB.md "Search"): the library index's typo-tolerant search over the Hub's Navidrome, ranked by
 * what the person searching plays. `ready: false` until the Hub has a scan login and has listed the library once;
 * the app then searches its servers itself, as before.
 */
export function searchRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/api/library/search', async (req): Promise<LibrarySearchResponse> => {
    const auth = signedIn(req);
    const q = String((req.query as Record<string, unknown>).q ?? '').slice(0, 200).trim();
    const ready = await ctx.libraryIndex.ensure();
    const { server } = ctx.libraryIndex.status();
    if (!ready || q.length < 2) return { ready, server, songs: [], albums: [], artists: [] };
    return { ready, server, ...ctx.libraryIndex.search(q, { plays: playsByArtist(ctx, auth.user.id) }) };
  });
}
