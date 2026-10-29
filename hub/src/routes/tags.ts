import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import { tx } from '../db.ts';
import { clientIp, HttpError, need, str } from '../http.ts';
import { getScanSettings } from '../library.ts';
import { findMatches, libraryFile, readTags, relPath, TAG_KEYS, writeTags, type Tags } from '../tags.ts';
import { navidromeAdmin } from './navidrome.ts';

/**
 * The tag editor (docs/USERS-AND-ADMIN.md Phase 5), for admins (`library.edit`): read an album's tags
 * straight from its files, look it up on Deezer and MusicBrainz, write the changes, and undo a save. Navidrome
 * is asked to rescan afterwards so the library shows the new tags.
 */

interface EditRow { id: number; batch: string; path: string; before: string; after: string; label: string; user_id: number | null; at: number; undone_at: number | null }

function readTagsBody(v: unknown): Tags {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'tags must be an object');
  const out: Tags = {};
  for (const [k, x] of Object.entries(v)) {
    if (!(TAG_KEYS as readonly string[]).includes(k)) throw new HttpError(400, `${k.slice(0, 40)} isn't a tag the editor knows`);
    if (typeof x !== 'string' || x.length > 1000) throw new HttpError(400, `${k} must be text`);
    out[k as keyof Tags] = x.trim();
  }
  return out;
}

export function tagRoutes(app: FastifyInstance, { db, config, library }: Ctx) {
  const file = (path: string) => libraryFile(config.musicDir, config.navidromeMusicDir, path);

  /** An album's songs (Navidrome album id), with the tags in their files. */
  app.get<{ Params: { id: string } }>('/api/admin/tags/album/:id', async (req) => {
    need(req, 'library.edit');
    const s = getScanSettings(db, config.secretKey);
    if (!s) throw new HttpError(409, 'Add the Navidrome admin login under Settings → Server first');
    const nd = await navidromeAdmin(s.url, s.username, s.password);
    const songs = await nd.albumSongs(req.params.id.slice(0, 100));
    if (!songs.length) throw new HttpError(404, 'Navidrome has no songs for that album');
    const out = [];
    for (const song of songs) {
      const f = file(String(song.path ?? ''));
      out.push({ id: song.id, path: relPath(config.musicDir, f), tags: await readTags(f) });
    }
    return { songs: out };
  });

  app.get<{ Querystring: { artist?: string; album?: string } }>('/api/admin/tags/match', async (req) => {
    need(req, 'library.edit');
    const artist = (req.query.artist ?? '').trim().slice(0, 200), album = (req.query.album ?? '').trim().slice(0, 200);
    if (!artist || !album) throw new HttpError(400, 'artist and album are needed');
    return { candidates: await findMatches(artist, album, config.version) };
  });

  /** `{ label, changes: [{ path, tags }] }`: one Save. Only the tags given change. */
  app.put('/api/admin/tags', async (req) => {
    const { user } = need(req, 'library.edit');
    const body = req.body as { changes?: unknown } | null;
    const changes = body?.changes;
    if (!Array.isArray(changes) || !changes.length || changes.length > 500) throw new HttpError(400, 'Send 1 to 500 changes');
    const label = str(body, 'label', 200) || 'Tags';
    const plan = changes.map((c: Record<string, unknown>) => {
      const path = typeof c?.path === 'string' ? c.path : '';
      return { file: file(path), tags: readTagsBody(c.tags) };
    });
    const batch = randomBytes(8).toString('hex');
    const now = Date.now();
    const done: string[] = [];
    const failed: { path: string; error: string }[] = [];
    const save = db.prepare('INSERT INTO tag_edits (batch, path, before, after, label, user_id, at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const p of plan) {
      const rel = relPath(config.musicDir, p.file);
      try {
        const cur = await readTags(p.file);
        // only what actually changes, so undo puts back exactly that
        const after: Tags = {}, before: Tags = {};
        for (const k of TAG_KEYS) {
          if (p.tags[k] === undefined || (p.tags[k] ?? '') === (cur[k] ?? '')) continue;
          after[k] = p.tags[k];
          before[k] = cur[k] ?? '';
        }
        if (!Object.keys(after).length) continue;
        await writeTags(p.file, after);
        tx(db, () => save.run(batch, rel, JSON.stringify(before), JSON.stringify(after), label, user.id, now));
        done.push(rel);
      } catch (e) {
        failed.push({ path: rel, error: (e as Error).message });
      }
    }
    if (done.length) {
      audit(db, { actorId: user.id, action: 'tags.edited', target: label, detail: { files: done.length, failed: failed.length }, ip: clientIp(req) });
      library.downloaded();
    }
    return { batch: done.length ? batch : null, changed: done, failed };
  });

  app.get('/api/admin/tags/history', async (req) => {
    need(req, 'library.edit');
    const rows = db
      .prepare(`SELECT batch, label, MIN(at) AS at, COUNT(*) AS files, MAX(undone_at) AS undone_at, users.username AS by
        FROM tag_edits LEFT JOIN users ON users.id = tag_edits.user_id GROUP BY batch ORDER BY at DESC LIMIT 50`)
      .all() as { batch: string; label: string; at: number; files: number; undone_at: number | null; by: string | null }[];
    return { edits: rows.map((r) => ({ batch: r.batch, label: r.label, at: r.at, files: r.files, undoneAt: r.undone_at, by: r.by })) };
  });

  /** Put a Save's files back as they were. */
  app.post<{ Params: { batch: string } }>('/api/admin/tags/undo/:batch', async (req) => {
    const { user } = need(req, 'library.edit');
    const rows = db.prepare('SELECT * FROM tag_edits WHERE batch = ? AND undone_at IS NULL').all(req.params.batch) as unknown as EditRow[];
    if (!rows.length) throw new HttpError(404, 'Nothing to undo there');
    const failed: { path: string; error: string }[] = [];
    let undone = 0;
    for (const r of rows) {
      try {
        await writeTags(file(r.path), JSON.parse(r.before) as Tags);
        db.prepare('UPDATE tag_edits SET undone_at = ? WHERE id = ?').run(Date.now(), r.id);
        undone++;
      } catch (e) {
        failed.push({ path: r.path, error: (e as Error).message });
      }
    }
    audit(db, { actorId: user.id, action: 'tags.undone', target: rows[0].label, detail: { files: undone, failed: failed.length }, ip: clientIp(req) });
    if (undone) library.downloaded();
    return { undone, failed };
  });
}
