import type { FastifyInstance } from 'fastify';
import type { LyricsCacheResponse } from '../api/lyrics.ts';
import type { Ctx } from '../app.ts';
import { HttpError, signedIn } from '../http.ts';
import { checkLyrics } from '../lyricsCache.ts';

const key = (v: unknown) => {
  if (typeof v !== 'string' || !v || v.length > 400) throw new HttpError(400, 'Send the lyrics key from the app');
  return v;
};

/** The shared lyrics cache (lyricsCache.ts, docs/HUB.md "Lyrics"). */
export function lyricsRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/api/lyrics', async (req): Promise<LyricsCacheResponse> => {
    signedIn(req);
    return { lyrics: ctx.lyrics.get(key((req.query as Record<string, unknown>).key)) };
  });

  app.put('/api/lyrics', { bodyLimit: 256 * 1024 }, async (req) => {
    signedIn(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const lyrics = checkLyrics(b.lyrics);
    if (!lyrics || typeof b.artist !== 'string' || typeof b.title !== 'string') throw new HttpError(400, 'Send { key, artist, title, lyrics }');
    ctx.lyrics.put(key(b.key), b.artist, b.title, lyrics);
    return { ok: true };
  });
}
