import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildApp } from '../src/app.ts';
import type { Config } from '../src/config.ts';
import { seal } from '../src/crypto.ts';
import { applyPendingRestore, openDb } from '../src/db.ts';
import { createUser } from '../src/users.ts';
import { ADMIN_PW, json } from './helpers.ts';

const KEY = Buffer.alloc(32, 7);

function hubAt(dir: string) {
  const db = openDb(join(dir, 'hub.db'));
  const config = {
    version: 'test', port: 0, host: '127.0.0.1', dataDir: dir, publicUrl: 'https://hub.test', secretKey: KEY, musicDir: '', navidromeMusicDir: '/music',
    ytdlpBin: 'yt-dlp', webDir: '', fanartKey: '', lastfmKey: '', lastfmSecret: '', dockerUrl: '', dockerContainers: [], sso: { enabled: false, trustedProxies: [], proxySecret: '', autoCreate: false, admins: [], adminGroup: '' },
  } as Config;
  let restarts = 0;
  const app = buildApp(db, config, { watchLibrary: false, restart: () => restarts++ });
  return { db, app, restarts: () => restarts };
}

const restore = (app: ReturnType<typeof hubAt>['app'], token: string, payload: Buffer, query = '') =>
  app.inject({ method: 'POST', url: `/api/admin/restore${query}`, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/vnd.sqlite3' }, payload });

test('restoring a backup swaps the database in on restart and keeps the old one', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wl-restore-'));
  const hub = hubAt(dir);
  const admin = (await json(hub.app, 'POST', '/auth/setup', { body: { username: 'boss', password: ADMIN_PW } })).body.token as string;
  await json(hub.app, 'POST', '/api/admin/users', { token: admin, body: { username: 'mia', role: 'member', password: 'mia-password-123' } });
  const backup = (await hub.app.inject({ method: 'GET', url: '/api/admin/backup', headers: { authorization: `Bearer ${admin}` } })).rawPayload;
  await json(hub.app, 'POST', '/api/admin/users', { token: admin, body: { username: 'late', role: 'member', password: 'late-password-123' } });

  assert.equal((await restore(hub.app, admin, Buffer.from('not a database at all'))).statusCode, 400);
  const member = (await json(hub.app, 'POST', '/auth/login', { body: { username: 'mia', password: 'mia-password-123' } })).body.token as string;
  assert.equal((await restore(hub.app, member, backup)).statusCode, 403);

  const r = await restore(hub.app, admin, backup);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().users, 2);
  assert.ok(existsSync(join(dir, 'hub.db.restore')));
  await new Promise((done) => setTimeout(done, 400));
  assert.equal(hub.restarts(), 1);

  // what main.ts does on the next start
  await hub.app.close();
  hub.db.close();
  const kept = applyPendingRestore(join(dir, 'hub.db'));
  assert.ok(kept && existsSync(kept));
  const db = openDb(join(dir, 'hub.db'));
  assert.deepEqual((db.prepare('SELECT username FROM users ORDER BY username').all() as { username: string }[]).map((u) => u.username), ['boss', 'mia']);
  const old = openDb(kept!);
  assert.ok(old.prepare("SELECT 1 FROM users WHERE username = 'late'").get());
  old.close();
  db.close();
  assert.equal(applyPendingRestore(join(dir, 'hub.db')), null);
});

test('a backup locked with another secret key, from a newer Hub, or with no admin is refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wl-restore-'));
  const hub = hubAt(dir);
  const admin = (await json(hub.app, 'POST', '/auth/setup', { body: { username: 'boss', password: ADMIN_PW } })).body.token as string;

  const make = (fn: (db: ReturnType<typeof openDb>) => void) => {
    const file = join(mkdtempSync(join(tmpdir(), 'wl-bk-')), 'b.db');
    const b = openDb(file);
    fn(b);
    b.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    b.close();
    return readFileSync(file);
  };
  const otherKey = make((b) => {
    createUser(b, { username: 'old', role: 'admin', passwordHash: null });
    b.prepare("INSERT INTO services (id, kind, name, url, access, config, secrets, position, created_at, updated_at) VALUES (1, 'navidrome', 'N', 'http://n', 'everyone', '{}', ?, 0, 0, 0)")
      .run(seal(Buffer.alloc(32, 9), '{"password":"x"}', 'service:1'));
  });
  const r = await restore(hub.app, admin, otherKey);
  assert.equal(r.statusCode, 409, r.body);
  assert.match(r.json().error, /different secret key/);
  const forced = await restore(hub.app, admin, otherKey, '?force=1');
  assert.equal(forced.statusCode, 200, forced.body);
  assert.equal(forced.json().keyMismatch, true);

  const noAdmin = make((b) => createUser(b, { username: 'm', role: 'member', passwordHash: null }));
  assert.match((await restore(hub.app, admin, noAdmin)).json().error, /no admin/);

  const newer = make((b) => {
    createUser(b, { username: 'old', role: 'admin', passwordHash: null });
    b.exec('PRAGMA user_version = 999');
  });
  assert.match((await restore(hub.app, admin, newer)).json().error, /newer Hub/);
  await hub.app.close();
  hub.db.close();
});
