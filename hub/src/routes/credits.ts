import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import { creditsSince, getCreditSettings, saveCreditSettings, setCreditsSince, tidyCredit } from '../credits.ts';
import { filesSince } from '../genres.ts';
import { clientIp, HttpError, need } from '../http.ts';
import { readTags, relPath, type Tags } from '../tags.ts';
import { saveTagChanges } from './tags.ts';

/**
 * Joined artist credits (credits.ts), for admins (`library.edit`): new downloads with "Lil Wayne;Drake" in their
 * Artist or Album artist tag get "Lil Wayne; Drake" before Navidrome scans them, so it lists two artists. The
 * setting turns that off. Fixing the music already in the library is done from the app (Library care →
 * Unmatched songs) with the tag editor's Save, so every change shows under Tag edits and can be undone.
 */
export function creditRoutes(app: FastifyInstance, { db, config, library }: Ctx) {
  // downloads that finish from now on are new; the library already there is for Unmatched songs
  if (creditsSince(db) === null) setCreditsSince(db, Date.now());

  library.onNewMusic.push(async () => {
    const s = getCreditSettings(db);
    const since = creditsSince(db) ?? Date.now();
    setCreditsSince(db, Date.now());
    if (!s.auto || !config.musicDir) return;
    // files someone edited by hand since keep what they chose
    const edited = new Set((db.prepare('SELECT path FROM tag_edits WHERE at >= ? AND user_id IS NOT NULL').all(since) as { path: string }[]).map((r) => r.path));
    const files = filesSince(config.musicDir, since).filter((f) => !edited.has(relPath(config.musicDir, f)));
    const plan: { file: string; tags: Tags }[] = [];
    for (let i = 0; i < files.length; i += 8) {
      await Promise.all(files.slice(i, i + 8).map(async (file) => {
        const cur = await readTags(file).catch(() => ({}) as Tags);
        const tags: Tags = {};
        for (const k of ['artist', 'albumArtist'] as const) {
          const v = cur[k];
          if (v && tidyCredit(v, k) !== v) tags[k] = tidyCredit(v, k);
        }
        if (Object.keys(tags).length) plan.push({ file, tags });
      }));
    }
    if (!plan.length) return;
    const r = await saveTagChanges(db, config.musicDir, plan, 'Artist credits of new downloads', null);
    if (r.changed.length) audit(db, { action: 'credits.tidied', target: 'new downloads', detail: { files: r.changed.length, failed: r.failed.length } });
  });

  app.get('/api/admin/credits', async (req) => {
    need(req, 'library.edit');
    return getCreditSettings(db);
  });

  /** `{ auto }`: whether new downloads' joined credits are tidied. */
  app.put('/api/admin/credits', async (req) => {
    const { user } = need(req, 'library.edit');
    const auto = (req.body as { auto?: unknown } | null)?.auto;
    if (typeof auto !== 'boolean') throw new HttpError(400, 'auto must be true or false');
    const s = saveCreditSettings(db, { auto });
    audit(db, { actorId: user.id, action: 'credits.settings', detail: { auto }, ip: clientIp(req) });
    return s;
  });
}
