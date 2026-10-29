import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.ts';
import { json, seeded } from './helpers.ts';

const ARL = 'arl-secret-0123456789abcdef';
const PLEX = 'plex-owner-token-xyz';
const SW_PASS = 'subwave-admin-pass';

async function withServices() {
  const hub = await seeded();
  const { app, tokens } = hub;
  const add = async (body: object) => {
    const r = await json(app, 'POST', '/api/admin/services', { token: tokens.admin, body });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.service as { id: number; secretsSet: string[] };
  };
  const plex = await add({ kind: 'plex', name: 'Plex', url: 'http://plex:32400/', secrets: { token: PLEX } });
  const abs = await add({ kind: 'audiobookshelf', name: 'Books', url: 'http://abs:13378', access: 'chosen', secrets: { token: 'abs-shared' } });
  const sw = await add({ kind: 'subwave', name: 'Radio', url: 'http://sw:7700', secrets: { username: 'admin', password: SW_PASS }, config: { apiUrl: 'http://sw:7701' } });
  const dm = await add({ kind: 'deemix', name: 'deemix', url: 'http://deemix:6595', secrets: { arl: ARL }, config: { bitrate: 9 } });
  return { ...hub, plex, abs, sw, dm };
}

const mine = async (app: Parameters<typeof json>[0], token: string) =>
  (await json(app, 'GET', '/api/me/services', { token })).body.services as { kind: string; url: string; secrets: Record<string, string>; ownLogin: boolean; config: Record<string, unknown> }[];

test('admins see which secrets are set, never their values', async () => {
  const { app, tokens, plex } = await withServices();
  assert.deepEqual(plex.secretsSet, ['token']);
  const list = await json(app, 'GET', '/api/admin/services', { token: tokens.admin });
  const text = JSON.stringify(list.body);
  for (const s of [ARL, PLEX, SW_PASS]) assert.ok(!text.includes(s), `admin list leaks ${s}`);
  assert.equal(list.body.services[0].url, 'http://plex:32400', 'trailing slash trimmed');
});

test('secrets are sealed in the database and absent from the audit log', async () => {
  const { app, db, tokens } = await withServices();
  const dump = JSON.stringify(db.prepare('SELECT * FROM services').all());
  for (const s of [ARL, PLEX, SW_PASS]) assert.ok(!dump.includes(s), `database holds ${s} in the clear`);
  const log = JSON.stringify((await json(app, 'GET', '/api/admin/audit', { token: tokens.admin })).body);
  assert.ok(log.includes('service.created'));
  for (const s of [ARL, PLEX, SW_PASS]) assert.ok(!log.includes(s), `audit leaks ${s}`);
});

test('each person gets only the servers and logins they may use', async () => {
  const { app, tokens } = await withServices();
  const admin = await mine(app, tokens.admin);
  assert.deepEqual(admin.map((s) => s.kind).sort(), ['audiobookshelf', 'deemix', 'plex', 'subwave']);
  assert.equal(admin.find((s) => s.kind === 'deemix')!.secrets.arl, ARL);
  assert.equal(admin.find((s) => s.kind === 'subwave')!.secrets.password, SW_PASS);

  const member = await mine(app, tokens.member);
  assert.deepEqual(member.map((s) => s.kind).sort(), ['plex', 'subwave'], 'no deemix without Autodownload, no chosen-only ABS');
  const sw = member.find((s) => s.kind === 'subwave')!;
  assert.equal(sw.secrets.password, undefined, 'SUB/WAVE admin login stays with admins');
  assert.equal(sw.secrets.username, undefined);
  assert.equal(sw.config.apiUrl, 'http://sw:7701');
  assert.ok(!JSON.stringify(member).includes(ARL));
  assert.ok(!JSON.stringify(await mine(app, tokens.kid)).includes(SW_PASS));
});

test('Autodownload hands a member the download tools; kids never get them', async () => {
  const { app, tokens, ids } = await withServices();
  await json(app, 'PATCH', `/api/admin/users/${ids.member}`, { token: tokens.admin, body: { autodownload: true } });
  assert.ok((await mine(app, tokens.member)).some((s) => s.kind === 'deemix'));
  await json(app, 'PATCH', `/api/admin/users/${ids.member}`, { token: tokens.admin, body: { autodownload: false } });
  assert.ok(!(await mine(app, tokens.member)).some((s) => s.kind === 'deemix'), 'taking the switch away takes the login away');
  await json(app, 'PATCH', `/api/admin/users/${ids.kid}`, { token: tokens.admin, body: { autodownload: true } });
  assert.ok(!(await mine(app, tokens.kid)).some((s) => s.kind === 'deemix'));
});

test('chosen servers and personal logins', async () => {
  const { app, tokens, ids, abs, plex } = await withServices();
  // give the member the Audiobookshelf server with their own key
  const put = await json(app, 'PUT', `/api/admin/services/${abs.id}/users/${ids.member}`, { token: tokens.admin, body: { secrets: { token: 'mia-own-abs' } } });
  assert.equal(put.status, 200);
  let m = (await mine(app, tokens.member)).find((s) => s.kind === 'audiobookshelf')!;
  assert.equal(m.secrets.token, 'mia-own-abs');
  assert.equal(m.ownLogin, true);
  // the kid isn't chosen
  assert.ok(!(await mine(app, tokens.kid)).some((s) => s.kind === 'audiobookshelf'));
  // a personal Plex token overrides the shared one for that person only
  await json(app, 'PUT', `/api/admin/services/${plex.id}/users/${ids.kid}`, { token: tokens.admin, body: { secrets: { token: 'kid-managed-user' } } });
  assert.equal((await mine(app, tokens.kid)).find((s) => s.kind === 'plex')!.secrets.token, 'kid-managed-user');
  assert.equal((await mine(app, tokens.member)).find((s) => s.kind === 'plex')!.secrets.token, PLEX);
  // only fields a person can own are accepted
  const bad = await json(app, 'PUT', `/api/admin/services/${plex.id}/users/${ids.kid}`, { token: tokens.admin, body: { secrets: { password: 'x' } } });
  assert.equal(bad.status, 400);
  // removing access takes it away on the next fetch
  await json(app, 'DELETE', `/api/admin/services/${abs.id}/users/${ids.member}`, { token: tokens.admin });
  m = (await mine(app, tokens.member)).find((s) => s.kind === 'audiobookshelf')!;
  assert.equal(m, undefined);
});

test('editing keeps secrets that were left out and clears ones set to empty', async () => {
  const { app, tokens, sw } = await withServices();
  const r = await json(app, 'PATCH', `/api/admin/services/${sw.id}`, { token: tokens.admin, body: { name: 'SUB/WAVE', secrets: { username: '' } } });
  assert.deepEqual(r.body.service.secretsSet, ['password']);
  assert.equal(r.body.service.name, 'SUB/WAVE');
  assert.equal((await mine(app, tokens.admin)).find((s) => s.kind === 'subwave')!.secrets.password, SW_PASS);
  const log = JSON.stringify((await json(app, 'GET', '/api/admin/audit', { token: tokens.admin })).body);
  assert.ok(log.includes('"changed":["name","username"]'));
});

test('one deemix per Hub, bad input refused', async () => {
  const { app, tokens } = await withServices();
  const again = await json(app, 'POST', '/api/admin/services', { token: tokens.admin, body: { kind: 'deemix', url: 'http://other:6595' } });
  assert.equal(again.status, 409);
  for (const body of [{ kind: 'navidrome', url: 'http://nd:4533' }, { kind: 'plex', url: 'ftp://x' }, { kind: 'plex', url: 'http://p', secrets: { arl: 'x' } }, { kind: 'plex', url: 'http://p', access: 'nobody' }]) {
    assert.equal((await json(app, 'POST', '/api/admin/services', { token: tokens.admin, body })).status, 400, JSON.stringify(body));
  }
});

test('a changed secret key makes old logins unreadable instead of crashing', async () => {
  const { db, tokens, config } = await withServices();
  // the same database opened by a Hub with a different WAVELENGTH_SECRET_KEY
  const app = buildApp(db, { ...config, secretKey: Buffer.alloc(32, 9) });
  const list = await json(app, 'GET', '/api/admin/services', { token: tokens.admin });
  assert.equal(list.status, 200);
  assert.ok(list.body.services.every((s: { unreadable: boolean; secretsSet: string[] }) => s.unreadable && !s.secretsSet.length));
  assert.equal((await mine(app, tokens.admin)).find((s) => s.kind === 'deemix')!.secrets.arl, undefined);
});
