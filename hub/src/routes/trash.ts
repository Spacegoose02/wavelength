import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import { tx, type Db } from '../db.ts';
import { clientIp, HttpError, need } from '../http.ts';
import { getScanSettings } from '../library.ts';
import { AUDIO_EXT, libraryFile } from '../tags.ts';
import { navidromeAdmin } from './navidrome.ts';

/**
 * Deleting albums (admins, `library.edit`). Nothing is deleted straight away: the album's files move into a
 * hidden folder in the music library (`.wavelength-trash`, which Navidrome skips), and can be put back from
 * Settings → Server → Deleted albums for 30 days. After that they're removed for good.
 */

export const TRASH_DIR = '.wavelength-trash';
const KEEP_MS = 30 * 24 * 3600_000;

interface TrashRow { id: number; batch: string; label: string; path: string; trash_path: string; files: number; at: number }

/** Music files anywhere under a folder. */
function audioUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && AUDIO_EXT.test(e.name))
    .map((e) => join(e.parentPath, e.name));
}

/** Remove empty folders from `dir` up to (not including) the music folder, so Navidrome doesn't show them. */
function pruneEmpty(root: string, dir: string) {
  for (let d = dir; d.startsWith(root + '/') && d !== root; d = dirname(d)) {
    try {
      if (readdirSync(d).length) return;
      rmdirSync(d);
    } catch {
      return;
    }
  }
}

/** Remove trash older than 30 days. */
export function purgeTrash(db: Db, musicDir: string, now = Date.now()) {
  if (!musicDir) return 0;
  const old = db.prepare('SELECT DISTINCT batch FROM trash WHERE at < ? AND restored_at IS NULL AND purged_at IS NULL').all(now - KEEP_MS) as { batch: string }[];
  for (const { batch } of old) {
    rmSync(join(resolve(musicDir), TRASH_DIR, batch), { recursive: true, force: true });
    db.prepare('UPDATE trash SET purged_at = ? WHERE batch = ? AND restored_at IS NULL').run(now, batch);
  }
  return old.length;
}

export function trashRoutes(app: FastifyInstance, { db, config, library }: Ctx) {
  const root = () => {
    if (!config.musicDir) throw new HttpError(501, 'The Hub has no music folder. Map your music share to /music (WAVELENGTH_MUSIC_DIR)');
    return resolve(config.musicDir);
  };

  const timer = setInterval(() => purgeTrash(db, config.musicDir), 6 * 3600_000);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));
  try {
    purgeTrash(db, config.musicDir);
  } catch {
    // a music folder that isn't there yet; tried again later
  }

  /** Delete an album (Navidrome album id): its files go to the trash. */
  app.delete<{ Params: { id: string } }>('/api/admin/library/album/:id', async (req) => {
    const { user } = need(req, 'library.edit');
    const music = root();
    const s = getScanSettings(db, config.secretKey);
    if (!s) throw new HttpError(409, 'Add the Navidrome admin login under Settings → Server first');
    const songs = await (await navidromeAdmin(s.url, s.username, s.password)).albumSongs(req.params.id.slice(0, 100));
    const files = new Set<string>();
    for (const song of songs) {
      try {
        files.add(libraryFile(music, config.navidromeMusicDir, String(song.path ?? '')));
      } catch {
        // already gone, or outside the music folder: nothing to move
      }
    }
    if (!files.size) throw new HttpError(404, 'The Hub can’t find any of that album’s files in its music folder');
    const first = songs[0];
    const label = `${first.albumArtist || first.artist || 'Unknown artist'} – ${first.album || 'Unknown album'}`.slice(0, 200);

    // A folder that holds only this album moves whole (with its cover and other files); otherwise just the songs.
    const moves: { from: string; files: number }[] = [];
    const movable = (dir: string) => dir.startsWith(music + '/') && !relative(music, dir).split('/').includes(TRASH_DIR) && audioUnder(dir).every((f) => files.has(f));
    // the folder all of it is in (an album with CD1/CD2 folders moves as one)
    let common = dirname([...files][0]);
    while (![...files].every((f) => f.startsWith(common + '/'))) common = dirname(common);
    const dirs = new Map<string, string[]>();
    if (movable(common)) dirs.set(common, [...files]);
    else for (const f of files) dirs.set(dirname(f), [...(dirs.get(dirname(f)) ?? []), f]);
    for (const [dir, own] of dirs) {
      if (movable(dir)) moves.push({ from: dir, files: own.length });
      else for (const f of own) moves.push({ from: f, files: 1 });
    }

    const batch = randomBytes(8).toString('hex');
    const now = Date.now();
    const trash = join(music, TRASH_DIR);
    mkdirSync(trash, { recursive: true });
    // Navidrome skips hidden folders; .ndignore makes sure
    if (!existsSync(join(trash, '.ndignore'))) writeFileSync(join(trash, '.ndignore'), '');
    const insert = db.prepare('INSERT INTO trash (batch, label, path, trash_path, files, user_id, at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    let moved = 0;
    const failed: string[] = [];
    for (const m of moves) {
      const rel = relative(music, m.from);
      const to = join(trash, batch, rel);
      try {
        mkdirSync(dirname(to), { recursive: true });
        renameSync(m.from, to);
        tx(db, () => insert.run(batch, label, rel, relative(music, to), m.files, user.id, now));
        moved += m.files;
        pruneEmpty(music, dirname(m.from));
      } catch (e) {
        failed.push(`${rel}: ${(e as Error).message}`);
      }
    }
    if (!moved) throw new HttpError(500, `Couldn’t move the album’s files: ${failed[0] ?? 'unknown error'}`);
    audit(db, { actorId: user.id, action: 'album.deleted', target: label, detail: { files: moved, failed: failed.length }, ip: clientIp(req) });
    library.downloaded();
    return { batch, label, files: moved, failed };
  });

  /** Deleted albums that can still be put back, and recently restored or purged ones. */
  app.get('/api/admin/trash', async (req) => {
    need(req, 'library.edit');
    const rows = db
      .prepare(`SELECT batch, label, MIN(at) AS at, SUM(files) AS files, MAX(restored_at) AS restored_at, MAX(purged_at) AS purged_at, users.username AS by
        FROM trash LEFT JOIN users ON users.id = trash.user_id WHERE at > ? GROUP BY batch ORDER BY at DESC LIMIT 100`)
      .all(Date.now() - 2 * KEEP_MS) as { batch: string; label: string; at: number; files: number; restored_at: number | null; purged_at: number | null; by: string | null }[];
    return {
      albums: rows.map((r) => ({
        batch: r.batch, label: r.label, at: r.at, files: r.files, by: r.by, restoredAt: r.restored_at, purgedAt: r.purged_at, purgeAt: r.at + KEEP_MS,
      })),
    };
  });

  /** Put a deleted album back where it was. */
  app.post<{ Params: { batch: string } }>('/api/admin/trash/:batch/restore', async (req) => {
    const { user } = need(req, 'library.edit');
    const music = root();
    const rows = db.prepare('SELECT * FROM trash WHERE batch = ? AND restored_at IS NULL AND purged_at IS NULL').all(req.params.batch) as unknown as TrashRow[];
    if (!rows.length) throw new HttpError(404, 'Nothing to put back there');
    let restored = 0;
    const failed: string[] = [];
    for (const r of rows) {
      const from = resolve(music, r.trash_path), to = resolve(music, r.path);
      if (!from.startsWith(music + '/') || !to.startsWith(music + '/')) continue;
      try {
        if (existsSync(to)) throw new Error('something else is there now');
        mkdirSync(dirname(to), { recursive: true });
        renameSync(from, to);
        db.prepare('UPDATE trash SET restored_at = ? WHERE id = ?').run(Date.now(), r.id);
        restored += r.files;
      } catch (e) {
        failed.push(`${r.path}: ${(e as Error).message}`);
      }
    }
    if (!failed.length) rmSync(join(music, TRASH_DIR, req.params.batch), { recursive: true, force: true });
    audit(db, { actorId: user.id, action: 'album.restored', target: rows[0].label, detail: { files: restored, failed: failed.length }, ip: clientIp(req) });
    if (restored) library.downloaded();
    return { files: restored, failed };
  });

  /** Remove a deleted album for good now, instead of after 30 days. */
  app.delete<{ Params: { batch: string } }>('/api/admin/trash/:batch', async (req) => {
    const { user } = need(req, 'library.edit');
    const music = root();
    const rows = db.prepare('SELECT label FROM trash WHERE batch = ? AND restored_at IS NULL AND purged_at IS NULL').all(req.params.batch) as { label: string }[];
    if (!rows.length || !/^[0-9a-f]{16}$/.test(req.params.batch)) throw new HttpError(404, 'Nothing to remove there');
    rmSync(join(music, TRASH_DIR, req.params.batch), { recursive: true, force: true });
    db.prepare('UPDATE trash SET purged_at = ? WHERE batch = ? AND restored_at IS NULL').run(Date.now(), req.params.batch);
    audit(db, { actorId: user.id, action: 'album.purged', target: rows[0].label, ip: clientIp(req) });
    return { ok: true };
  });
}
