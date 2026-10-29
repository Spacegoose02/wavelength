import { accessSync, constants, existsSync, readFileSync, rmSync, statfsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import { clientIp, need } from '../http.ts';
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
export function serverRoutes(app: FastifyInstance, { db, config }: Ctx) {
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
}
