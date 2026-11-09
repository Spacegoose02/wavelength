import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import { tx, type Db } from '../db.ts';
import { clientIp, HttpError, need, str } from '../http.ts';
import { getScanSettings } from '../library.ts';
import { canWrite, findMatches, libraryFile, readTags, relPath, TAG_KEYS, writeTags, type Tags } from '../tags.ts';
import { numberedTitle } from '../trackTitles.ts';
import { libraryAdmin } from '../libraryAdmin.ts';
import { catalogWrote } from '../catalog.ts';

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

/** Files written at the same time in one Save: ffmpeg copies each whole file, so a few at once, not all. */
const WRITE_AT_ONCE = 4;

/**
 * Write tag changes to files as one Save (one batch in `tag_edits`, so it can be undone). Only tags that
 * actually change are written and kept, so undo puts back exactly those. `batch` is null when nothing changed.
 *
 * A big Save is sent in several requests so none of them runs long enough for a proxy in front of the Hub to give
 * up on it (a 504): pass the same `batch` id with each part and they stay one Save, undone together.
 */
export async function saveTagChanges(db: Db, musicDir: string, plan: { file: string; tags: Tags }[], label: string, userId: number | null, batch = randomBytes(8).toString('hex')) {
  const now = Date.now();
  const changed: string[] = [];
  const failed: { path: string; error: string }[] = [];
  const save = db.prepare('INSERT INTO tag_edits (batch, path, before, after, label, user_id, at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const one = async (p: { file: string; tags: Tags }) => {
    const rel = relPath(musicDir, p.file);
    try {
      const cur = await readTags(p.file);
      const after: Tags = {}, before: Tags = {};
      for (const k of TAG_KEYS) {
        if (p.tags[k] === undefined || (p.tags[k] ?? '') === (cur[k] ?? '') || !canWrite(p.file, k)) continue;
        after[k] = p.tags[k];
        before[k] = cur[k] ?? '';
      }
      if (!Object.keys(after).length) return;
      await writeTags(p.file, after);
      tx(db, () => {
        save.run(batch, rel, JSON.stringify(before), JSON.stringify(after), label, userId, now);
        catalogWrote(db, rel, after);
      });
      changed.push(rel);
    } catch (e) {
      failed.push({ path: rel, error: (e as Error).message });
    }
  };
  // the same file twice is one write (the later tags win), so two writes never race on one file
  const byFile = new Map<string, Tags>();
  for (const p of plan) byFile.set(p.file, { ...byFile.get(p.file), ...p.tags });
  const files = [...byFile].map(([file, tags]) => ({ file, tags }));
  for (let i = 0; i < files.length; i += WRITE_AT_ONCE) await Promise.all(files.slice(i, i + WRITE_AT_ONCE).map(one));
  return { batch: changed.length ? batch : null, changed, failed };
}

export function tagRoutes(app: FastifyInstance, { db, config, library, catalog }: Ctx) {
  const file = (path: string) => libraryFile(config.musicDir, config.navidromeMusicDir, path);
  const admin = () => libraryAdmin(db, config.secretKey, catalog);

  /** An album's songs (Navidrome album id), with the tags in their files. */
  app.get<{ Params: { id: string } }>('/api/admin/tags/album/:id', async (req) => {
    need(req, 'library.edit');
    const nd = await admin();
    const songs = await nd.albumSongs(req.params.id.slice(0, 100));
    if (!songs.length) throw new HttpError(404, 'Navidrome has no songs for that album');
    const out = [];
    for (const song of songs) {
      const f = file(String(song.path ?? ''));
      out.push({ id: song.id, path: relPath(config.musicDir, f), tags: await readTags(f) });
    }
    return { songs: out };
  });

  /**
   * One song (Navidrome song id) with the tags in its file, for the app's Edit song dialog. Found in the catalog,
   * else among its album's songs (`?album=`, the Navidrome album id) when the catalog doesn't know it yet.
   */
  app.get<{ Params: { id: string }; Querystring: { album?: string } }>('/api/admin/tags/song/:id', async (req) => {
    need(req, 'library.edit');
    const id = req.params.id.slice(0, 100), album = (req.query.album ?? '').slice(0, 100);
    let path = catalog.usable() ? catalog.songPath(id) : undefined;
    if (!path && album) path = (await (await admin()).albumSongs(album)).find((s) => String(s.id) === id)?.path;
    if (!path) throw new HttpError(404, 'The Hub can’t find that song’s file. Navidrome may not have scanned it yet');
    const f = file(String(path));
    return { id, path: relPath(config.musicDir, f), tags: await readTags(f) };
  });

  /**
   * Several albums' songs at once (Navidrome album ids, `?ids=a,b`), for editing an artist across all their
   * albums. Each song says which album it's on.
   */
  app.get<{ Querystring: { ids?: string } }>('/api/admin/tags/albums', async (req) => {
    need(req, 'library.edit');
    const ids = [...new Set((req.query.ids ?? '').split(',').map((x) => x.trim().slice(0, 100)).filter(Boolean))];
    if (!ids.length || ids.length > 200) throw new HttpError(400, 'Send 1 to 200 album ids');
    const nd = await admin();
    const out: { id: string; albumId: string; path: string; tags: Tags }[] = [];
    const missing: string[] = [];
    for (const albumId of ids) {
      const songs = await nd.albumSongs(albumId);
      const files = songs.map((song) => {
        try {
          return { song, f: file(String(song.path ?? '')) };
        } catch {
          missing.push(String(song.path ?? song.title ?? ''));
          return null;
        }
      }).filter((x) => !!x);
      // a few at a time: ffprobe per file
      for (let i = 0; i < files.length; i += 8) {
        const part = await Promise.all(files.slice(i, i + 8).map(async ({ song, f }) => ({ id: String(song.id), albumId, path: relPath(config.musicDir, f), tags: await readTags(f) })));
        out.push(...part);
      }
      if (out.length > 5000) throw new HttpError(400, 'That’s more than 5000 songs; edit fewer albums at once');
    }
    return { songs: out, missing };
  });

  /**
   * Library care → Numbered titles: songs whose title starts with their track number ("04 - God's Plan"), from
   * Navidrome's own list of songs, one page (`offset`, `limit` up to 5000) at a time. No file is opened, so a
   * whole library takes seconds instead of reading every file; the Save that fixes them reads each file first.
   */
  app.get<{ Querystring: { offset?: string; limit?: string } }>('/api/admin/tags/numbered', async (req) => {
    need(req, 'library.edit');
    const offset = Math.max(0, Number.parseInt(req.query.offset ?? '0', 10) || 0);
    const limit = Math.min(5000, Math.max(1, Number.parseInt(req.query.limit ?? '2000', 10) || 2000));
    const nd = await admin();
    const { songs, total } = await nd.songs(offset, offset + limit);
    const fixes: { path: string; albumId: string; artist: string; album: string; from: string; to: string }[] = [];
    for (const s of songs) {
      const hit = numberedTitle(s.title, s.trackNumber || undefined);
      if (!hit) continue;
      let f: string;
      try {
        f = file(s.path);
      } catch {
        continue;
      }
      fixes.push({ path: relPath(config.musicDir, f), albumId: s.albumId, artist: s.albumArtist || s.artist, album: s.album, from: s.title, to: hit.title });
    }
    return { fixes, scanned: songs.length, total };
  });

  /** Artist and genre names already in the library (and in recent edits), for the editor's suggestions. */
  let names: { at: number; artists: string[]; genres: string[] } | undefined;
  app.get('/api/admin/tags/values', async (req) => {
    need(req, 'library.edit');
    if (!names || Date.now() - names.at > 5 * 60_000) {
      const got = getScanSettings(db, config.secretKey) ? await (await admin()).names().catch(() => ({ artists: [], genres: [] })) : { artists: [], genres: [] };
      names = { at: Date.now(), ...got };
    }
    // names saved since Navidrome last scanned
    const artists = new Set(names.artists), genres = new Set(names.genres);
    for (const r of db.prepare('SELECT after FROM tag_edits WHERE undone_at IS NULL ORDER BY id DESC LIMIT 2000').all() as { after: string }[]) {
      const t = JSON.parse(r.after) as Tags;
      if (t.artist) artists.add(t.artist);
      if (t.albumArtist) artists.add(t.albumArtist);
      if (t.genre) genres.add(t.genre);
    }
    const sorted = (x: Set<string>) => [...x].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    return { artists: sorted(artists), genres: sorted(genres) };
  });

  app.get<{ Querystring: { artist?: string; album?: string } }>('/api/admin/tags/match', async (req) => {
    need(req, 'library.edit');
    const artist = (req.query.artist ?? '').trim().slice(0, 200), album = (req.query.album ?? '').trim().slice(0, 200);
    if (!artist || !album) throw new HttpError(400, 'artist and album are needed');
    return { candidates: await findMatches(artist, album, config.version) };
  });

  /** `{ label, changes: [{ path, tags }] }`: one Save. Only the tags given change. */
  app.put('/api/admin/tags', { bodyLimit: 8 * 1024 * 1024 }, async (req) => {
    const { user } = need(req, 'library.edit');
    const body = req.body as { changes?: unknown } | null;
    const changes = body?.changes;
    if (!Array.isArray(changes) || !changes.length || changes.length > 5000) throw new HttpError(400, 'Send 1 to 5000 changes');
    const label = str(body, 'label', 200) || 'Tags';
    // one part of a bigger Save (see saveTagChanges)
    const part = (body as { batch?: unknown }).batch;
    if (part !== undefined && (typeof part !== 'string' || !/^[0-9a-f]{16}$/.test(part))) throw new HttpError(400, 'batch must be the id of a Save');
    const plan = changes.map((c: Record<string, unknown>) => {
      const path = typeof c?.path === 'string' ? c.path : '';
      return { file: file(path), tags: readTagsBody(c.tags) };
    });
    const { batch, changed: done, failed } = await saveTagChanges(db, config.musicDir, plan, label, user.id, part);
    if (done.length) {
      audit(db, { actorId: user.id, action: 'tags.edited', target: label, detail: { files: done.length, failed: failed.length }, ip: clientIp(req) });
      library.changed();
    }
    return { batch, changed: done, failed };
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
        catalogWrote(db, r.path, JSON.parse(r.before) as Tags);
        db.prepare('UPDATE tag_edits SET undone_at = ? WHERE id = ?').run(Date.now(), r.id);
        undone++;
      } catch (e) {
        failed.push({ path: r.path, error: (e as Error).message });
      }
    }
    audit(db, { actorId: user.id, action: 'tags.undone', target: rows[0].label, detail: { files: undone, failed: failed.length }, ip: clientIp(req) });
    if (undone) library.changed();
    return { undone, failed };
  });
}
