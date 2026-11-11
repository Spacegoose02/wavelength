import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { after, test } from 'node:test';
import { importFromNavidrome } from '../src/radioStations.ts';
import { json, seeded } from './helpers.ts';

const servers: Server[] = [];
after(() => servers.forEach((s) => s.close()));
const md5 = (s: string) => createHash('md5').update(s).digest('hex');

/** A fake Navidrome with two stations; records the calls that reach it. */
async function fakeNavidrome() {
  const calls: string[] = [];
  const srv = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x');
    const method = url.pathname.replace('/rest/', '');
    calls.push(method);
    res.writeHead(200, { 'content-type': 'application/json' });
    if (method === 'getInternetRadioStations') {
      return res.end(JSON.stringify({ 'subsonic-response': { status: 'ok', internetRadioStations: { internetRadioStation: [
        { id: 'nd-r1', name: 'KEXP', streamUrl: 'https://kexp.example/stream', homePageUrl: 'https://kexp.org' },
        { id: 'nd-r2', name: 'Jazz FM', streamUrl: 'https://jazz.example/live' },
      ] } } }));
    }
    res.end(JSON.stringify({ 'subsonic-response': { status: 'ok', user: { adminRole: true } } }));
  });
  servers.push(srv);
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, calls };
}

test('the Hub copies Navidrome’s radio stations once, keeps their ids, and admins change them', async () => {
  const nd = await fakeNavidrome();
  const { app, db, config, tokens, ids } = await seeded();
  // before the copy the app keeps asking Navidrome
  assert.deepEqual((await json(app, 'GET', '/api/radio/stations', { token: tokens.member })).body, { imported: false, importedAt: null, stations: [] });
  assert.equal(await importFromNavidrome(db, config.secretKey), null, 'no Navidrome admin login yet');

  const s = await json(app, 'POST', '/api/admin/services', { token: tokens.admin, body: { kind: 'navidrome', url: nd.url, config: { relay: 'everyone' }, secrets: { adminUsername: 'admin', adminPassword: 'pw' } } });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.equal((await json(app, 'POST', '/api/admin/radio/import', { token: tokens.member })).status, 403);
  const imp = await json(app, 'POST', '/api/admin/radio/import', { token: tokens.admin });
  assert.equal(imp.status, 200, JSON.stringify(imp.body));
  assert.deepEqual(imp.body.result, { added: 2, total: 2 });
  const list = (await json(app, 'GET', '/api/radio/stations', { token: tokens.kid })).body;
  assert.equal(list.imported, true);
  assert.deepEqual(list.stations.map((x: { id: string; name: string }) => [x.id, x.name]), [['nd-r2', 'Jazz FM'], ['nd-r1', 'KEXP']], 'Navidrome’s ids kept');
  // a second copy adds nothing twice
  assert.deepEqual((await json(app, 'POST', '/api/admin/radio/import', { token: tokens.admin })).body.result, { added: 0, total: 2 });

  // admins add, change and delete; others can't
  assert.equal((await json(app, 'POST', '/api/admin/radio/stations', { token: tokens.member, body: { name: 'X', streamUrl: 'https://x.example' } })).status, 403);
  assert.equal((await json(app, 'POST', '/api/admin/radio/stations', { token: tokens.admin, body: { name: 'X', streamUrl: 'ftp://x' } })).status, 400);
  const added = await json(app, 'POST', '/api/admin/radio/stations', { token: tokens.admin, body: { name: 'Radio Paradise', streamUrl: 'https://rp.example/flac' } });
  assert.equal(added.status, 200);
  const rp = added.body.station.id;
  assert.equal((await json(app, 'PUT', `/api/admin/radio/stations/${rp}`, { token: tokens.admin, body: { name: 'Radio Paradise FLAC' } })).body.station.name, 'Radio Paradise FLAC');
  // a logo for the card: kept, changed, taken off; only http(s) links
  assert.equal((await json(app, 'PUT', `/api/admin/radio/stations/${rp}`, { token: tokens.admin, body: { logoUrl: 'javascript:alert(1)' } })).status, 400);
  assert.equal((await json(app, 'PUT', `/api/admin/radio/stations/${rp}`, { token: tokens.member, body: { logoUrl: 'https://rp.example/logo.png' } })).status, 403);
  assert.equal((await json(app, 'PUT', `/api/admin/radio/stations/${rp}`, { token: tokens.admin, body: { logoUrl: 'https://rp.example/logo.png' } })).body.station.logoUrl, 'https://rp.example/logo.png');
  assert.equal((await json(app, 'GET', '/api/radio/stations', { token: tokens.kid })).body.stations.find((x: { id: string }) => x.id === rp).logoUrl, 'https://rp.example/logo.png', 'everyone sees it');
  assert.equal((await json(app, 'PUT', `/api/admin/radio/stations/${rp}`, { token: tokens.admin, body: { logoUrl: '' } })).body.station.logoUrl, '');
  const withLogo = await json(app, 'POST', '/api/admin/radio/stations', { token: tokens.admin, body: { name: 'Z100', streamUrl: 'https://stream.revma.ihrhls.com/zc1469', logoUrl: 'https://i.example/z100.png' } });
  assert.equal(withLogo.body.station.logoUrl, 'https://i.example/z100.png');
  await json(app, 'DELETE', `/api/admin/radio/stations/${withLogo.body.station.id}`, { token: tokens.admin });
  assert.equal((await json(app, 'DELETE', `/api/admin/radio/stations/nd-r2`, { token: tokens.admin })).body.stations.length, 2);
  assert.equal((await json(app, 'DELETE', `/api/admin/radio/stations/nd-r2`, { token: tokens.admin })).status, 404);

  // devices going through the Hub get the Hub's list, and Navidrome isn't asked
  await json(app, 'PUT', `/api/admin/services/${s.body.service.id}/users/${ids.member}`, { token: tokens.admin, body: { secrets: { username: 'mia', password: 'mia-pw' } } });
  await json(app, 'PUT', `/api/admin/services/${s.body.service.id}/users/${ids.admin}`, { token: tokens.admin, body: { secrets: { username: 'boss', password: 'boss-pw' } } });
  const rest = async (token: string, method: string, params: Record<string, string> = {}) => {
    const login = (await json(app, 'GET', '/api/me/services', { token })).body.services[0];
    const r = await app.inject({ method: 'GET', url: `/nd/${s.body.service.id}/rest/${method}?${new URLSearchParams({ u: login.secrets.username, t: md5(login.secrets.password + 'ab'), s: 'ab', v: '1.16.1', c: 't', f: 'json', ...params })}` });
    return r.json()['subsonic-response'];
  };
  nd.calls.length = 0;
  const relayed = await rest(tokens.member, 'getInternetRadioStations');
  assert.deepEqual(relayed.internetRadioStations.internetRadioStation.map((x: { name: string }) => x.name), ['KEXP', 'Radio Paradise FLAC']);
  assert.equal((await rest(tokens.member, 'createInternetRadioStation', { name: 'Nope', streamUrl: 'https://n.example' })).status, 'failed', 'members can’t add');
  assert.equal((await rest(tokens.admin, 'createInternetRadioStation', { name: 'BBC 6', streamUrl: 'https://bbc.example/6', homepageUrl: 'https://bbc.co.uk' })).status, 'ok');
  assert.equal((await rest(tokens.admin, 'deleteInternetRadioStation', { id: 'nope' })).error.code, 70);
  assert.deepEqual((await json(app, 'GET', '/api/radio/stations', { token: tokens.member })).body.stations.map((x: { name: string }) => x.name), ['BBC 6', 'KEXP', 'Radio Paradise FLAC']);
  assert.deepEqual(nd.calls.filter((m) => m.includes('Radio')), [], 'Navidrome wasn’t asked about stations');
});
