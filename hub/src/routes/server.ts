import { accessSync, constants, existsSync, readFileSync, renameSync, rmSync, statfsSync, statSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import { unseal } from '../crypto.ts';
import { SCHEMA_VERSION } from '../db.ts';
import { clientIp, HttpError, need, str } from '../http.ts';
import { getScanSettings, navidrome, saveScanSettings } from '../library.ts';
import { run } from '../ytdlp.ts';

const STARTED = Date.now();
const DAY = 24 * 3600_000;

/** Free and total bytes on the disk holding `dir`, or null when it can't be read. */
function disk(dir: string) {
  try {
    const s = statfsSync(dir);
    return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
  } catch {
    return null;
  }
}

const size = (file: string) => (existsSync(file) ? statSync(file).size : 0);

let ytdlp: { at: number; version: string | null } | undefined;
async function ytdlpVersion(bin: string) {
  if (ytdlp && Date.now() - ytdlp.at < 10 * 60_000) return ytdlp.version;
  const r = await Promise.race([run(bin, ['--version']), new Promise<null>((done) => setTimeout(() => done(null), 8000))]).catch(() => null);
  ytdlp = { at: Date.now(), version: r && r.code === 0 ? r.out.trim().slice(0, 40) : null };
  return ytdlp.version;
}

/**
 * The admin server page (docs/USERS-AND-ADMIN.md Phase 6): how the Hub is doing, and a backup of its
 * database. Admins only (`server.view`).
 */
export function serverRoutes(app: FastifyInstance, { db, config, library, restart }: Ctx) {
  const dbFile = join(config.dataDir, 'hub.db');
  const count = (sql: string, ...args: (string | number)[]) => (db.prepare(sql).get(...args) as { n: number }).n;

  app.get('/api/admin/server', async (req) => {
    need(req, 'server.view');
    let musicWritable = false;
    if (config.musicDir) {
      try {
        accessSync(config.musicDir, constants.W_OK);
        musicWritable = true;
      } catch {
        /* read-only or missing */
      }
    }
    return {
      version: config.version,
      node: process.version,
      startedAt: STARTED,
      publicUrl: config.publicUrl,
      sso: config.sso.enabled,
      web: !!config.webDir && existsSync(join(config.webDir, 'index.html')),
      data: { dir: config.dataDir, dbBytes: size(dbFile) + size(`${dbFile}-wal`), disk: disk(config.dataDir) },
      music: config.musicDir ? { dir: config.musicDir, exists: existsSync(config.musicDir), writable: musicWritable, disk: disk(config.musicDir) } : null,
      ytdlp: await ytdlpVersion(config.ytdlpBin),
      counts: {
        users: count('SELECT COUNT(*) AS n FROM users WHERE disabled = 0'),
        admins: count("SELECT COUNT(*) AS n FROM users WHERE disabled = 0 AND role = 'admin'"),
        kids: count("SELECT COUNT(*) AS n FROM users WHERE disabled = 0 AND role = 'kid'"),
        devices: count('SELECT COUNT(*) AS n FROM devices WHERE revoked_at IS NULL'),
        activeToday: count('SELECT COUNT(DISTINCT user_id) AS n FROM devices WHERE revoked_at IS NULL AND last_seen_at > ?', Date.now() - DAY),
        pendingRequests: count("SELECT COUNT(*) AS n FROM requests WHERE status = 'pending'"),
        services: count('SELECT COUNT(*) AS n FROM services'),
        flags: count('SELECT COUNT(*) AS n FROM content_flags'),
        ratedAlbums: count("SELECT COUNT(*) AS n FROM ratings WHERE kind = 'album'"),
      },
    };
  });

  // ---- library: Navidrome rescans after downloads (library.ts) ----

  app.get('/api/admin/library', async (req) => {
    need(req, 'server.view');
    return library.status();
  });

  /** The Navidrome admin login the Hub scans with; checked before it's saved. Kept sealed, never sent to devices. */
  app.put('/api/admin/library/navidrome', async (req) => {
    const { user } = need(req, 'keys.manage');
    const b = req.body ?? {};
    const url = str(b, 'url', 300).replace(/\/+$/, '');
    const username = str(b, 'username', 100);
    let password = str(b, 'password', 200);
    if (!/^https?:\/\/\S+$/i.test(url)) throw new HttpError(400, 'Navidrome address must start with http:// or https://');
    if (!username) throw new HttpError(400, 'Enter the Navidrome admin username');
    // keep the saved password when only the address or username changes
    if (!password) password = getScanSettings(db, config.secretKey)?.password ?? '';
    if (!password) throw new HttpError(400, 'Enter the Navidrome admin password');
    const s = { url, username, password };
    const me = await navidrome(s, 'getUser', { username }).catch((e: Error) => {
      throw new HttpError(400, e.message);
    });
    if (!me.user?.adminRole) throw new HttpError(400, `${username} isn't a Navidrome admin, so it can't start a scan`);
    saveScanSettings(db, config.secretKey, s);
    audit(db, { actorId: user.id, action: 'library.navidrome_set', target: url, ip: clientIp(req) });
    return library.status();
  });

  app.delete('/api/admin/library/navidrome', async (req) => {
    const { user } = need(req, 'keys.manage');
    saveScanSettings(db, config.secretKey, null);
    audit(db, { actorId: user.id, action: 'library.navidrome_removed', ip: clientIp(req) });
    return library.status();
  });

  /** Scan now. Answers straight away; the scan carries on in the background. */
  app.post('/api/admin/library/scan', async (req) => {
    const { user } = need(req, 'server.view');
    if (!getScanSettings(db, config.secretKey)) throw new HttpError(409, 'Add a Navidrome admin login first');
    void library.scan().catch(() => undefined);
    audit(db, { actorId: user.id, action: 'library.scan', ip: clientIp(req) });
    return { ...library.status(), scanning: true };
  });

  /**
   * A consistent copy of the database. Server logins in it stay encrypted with the Hub's secret key
   * (secret.key in the data folder, or WAVELENGTH_SECRET_KEY), which is not in the backup: keep that safe too.
   */
  app.get('/api/admin/backup', async (req, reply) => {
    const { user } = need(req, 'server.view');
    const tmp = join(config.dataDir, `backup-${process.pid}-${Date.now()}.db`);
    let bytes: Buffer;
    try {
      db.prepare('VACUUM INTO ?').run(tmp);
      bytes = readFileSync(tmp);
    } finally {
      rmSync(tmp, { force: true });
    }
    audit(db, { actorId: user.id, action: 'hub.backup', detail: { bytes: bytes.length }, ip: clientIp(req) });
    const day = new Date().toISOString().slice(0, 10);
    return reply
      .header('content-type', 'application/vnd.sqlite3')
      .header('content-disposition', `attachment; filename="wavelength-hub-${day}.db"`)
      .header('cache-control', 'no-store')
      .send(bytes);
  });

  /**
   * Restore a backup from GET /api/admin/backup: the file is checked, staged next to the database, and the
   * Hub restarts to swap it in (db.ts applyPendingRestore). The current database is kept beside it.
   * `?force=1` restores even when the backup's server logins were sealed with a different secret key.
   */
  app.post<{ Querystring: { force?: string } }>('/api/admin/restore', { bodyLimit: 256 * 1024 * 1024 }, async (req) => {
    const { user } = need(req, 'server.view');
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.subarray(0, 16).toString('latin1') !== 'SQLite format 3\0') {
      throw new HttpError(400, 'That isn’t a Wavelength Hub backup. Choose the .db file from Download backup');
    }
    const tmp = `${dbFile}.restore-check`;
    writeFileSync(tmp, body);
    let summary: { users: number; admins: number; version: number; keyMismatch: boolean };
    try {
      summary = checkBackup(tmp, config.secretKey);
    } catch (e) {
      rmSync(tmp, { force: true });
      throw e;
    }
    if (summary.keyMismatch && req.query.force !== '1') {
      rmSync(tmp, { force: true });
      throw new HttpError(409, 'This backup’s server logins were locked with a different secret key, so they wouldn’t open on this Hub. Restore anyway and add them again, or start the Hub with the old secret.key first');
    }
    renameSync(tmp, `${dbFile}.restore`);
    audit(db, { actorId: user.id, action: 'hub.restore_staged', detail: { bytes: body.length, users: summary.users, schema: summary.version }, ip: clientIp(req) });
    setTimeout(restart, 300);
    return { ok: true, restarting: true, ...summary };
  });
}

/** Is this file a backup this Hub can take? Throws a 400 saying why not. */
function checkBackup(file: string, key: Buffer) {
  let b: DatabaseSync;
  try {
    b = new DatabaseSync(file, { readOnly: true });
  } catch {
    throw new HttpError(400, 'That backup can’t be opened');
  }
  try {
    const ok = (b.prepare('PRAGMA quick_check').get() as { quick_check: string }).quick_check;
    if (ok !== 'ok') throw new HttpError(400, 'That backup is damaged');
    const version = (b.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    const has = (t: string) => !!b.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
    if (!version || !has('users')) throw new HttpError(400, 'That isn’t a Wavelength Hub backup');
    if (version > SCHEMA_VERSION) throw new HttpError(400, 'That backup is from a newer Hub. Update this Hub first');
    const users = (b.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
    const admins = (b.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0").get() as { n: number }).n;
    if (!admins) throw new HttpError(400, 'That backup has no admin account, so nobody could manage the Hub after restoring it');
    let keyMismatch = false;
    if (has('services')) {
      for (const r of b.prepare('SELECT id, secrets FROM services WHERE secrets IS NOT NULL').all() as { id: number; secrets: string }[]) {
        try {
          unseal(key, r.secrets, `service:${r.id}`);
        } catch {
          keyMismatch = true;
          break;
        }
      }
    }
    return { users, admins, version, keyMismatch };
  } finally {
    b.close();
  }
}
