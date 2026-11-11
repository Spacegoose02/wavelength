import assert from 'node:assert/strict';
import { test } from 'node:test';
import { json, seeded } from './helpers.ts';

const song = (id: string) => ({ id, sourceId: 'hub-1', kind: 'track', title: `Song ${id}`, artist: 'Band', duration: 200 });

test('a party: guests follow the host, add songs, and control only when allowed', async () => {
  const { app, tokens } = await seeded();
  const host = tokens.admin, guest = tokens.member, kid = tokens.kid;
  const p = (await json(app, 'POST', '/api/together', { token: host, body: { name: 'Road trip' } })).body;
  assert.equal(p.isHost, true);
  assert.equal(p.guestsAdd, true);
  assert.equal(p.guestsControl, false);

  assert.deepEqual((await json(app, 'GET', '/api/together', { token: guest })).body.parties.map((x: { name: string; joined: boolean }) => [x.name, x.joined]), [['Road trip', false]]);
  const joined = (await json(app, 'POST', `/api/together/${p.id}/join`, { token: guest })).body;
  assert.equal(joined.isHost, false);
  assert.equal(joined.members.length, 2);

  // the guest waits; the host starts playing
  const waiting = json(app, 'GET', `/api/together/${p.id}/wait?version=${joined.version}&timeout=2000`, { token: guest });
  await json(app, 'PUT', `/api/together/${p.id}/state`, { token: host, body: { queue: [song('a'), song('b')], index: 0, position: 12, duration: 200, playing: true } });
  const seen = (await waiting).body.party;
  assert.equal(seen.state.index, 0);
  assert.equal(seen.state.position, 12);
  assert.equal(seen.state.playing, true);
  assert.ok(seen.now >= seen.state.at);

  // guests may only send what the guestsControl / guestsAdd switches allow
  assert.equal((await json(app, 'PUT', `/api/together/${p.id}/state`, { token: guest, body: { queue: [] } })).status, 403);
  assert.equal((await json(app, 'POST', `/api/together/${p.id}/request`, { token: guest, body: { action: 'next' } })).status, 403);
  assert.equal((await json(app, 'POST', `/api/together/${p.id}/request`, { token: guest, body: { action: 'add', tracks: [song('c')] } })).status, 200);
  const host1 = (await json(app, 'GET', `/api/together/${p.id}/wait?version=999&timeout=10`, { token: host })).body;
  assert.deepEqual(host1.requests.map((r: { action: string; from: string }) => [r.action, r.from]), [['add', 'mia']]);
  assert.equal(host1.requests[0].tracks[0].id, 'c');

  await json(app, 'PATCH', `/api/together/${p.id}`, { token: host, body: { guestsControl: true, guestsAdd: false } });
  assert.equal((await json(app, 'POST', `/api/together/${p.id}/request`, { token: guest, body: { action: 'next' } })).status, 200);
  assert.equal((await json(app, 'POST', `/api/together/${p.id}/request`, { token: guest, body: { action: 'add', tracks: [song('d')] } })).status, 403);
  assert.equal((await json(app, 'PATCH', `/api/together/${p.id}`, { token: guest, body: { guestsAdd: true } })).status, 403);

  // someone who hasn't joined can't do anything in it
  assert.equal((await json(app, 'POST', `/api/together/${p.id}/request`, { token: kid, body: { action: 'add', tracks: [song('e')] } })).status, 404);
  assert.equal((await json(app, 'GET', `/api/together/${p.id}/wait?timeout=10`, { token: kid })).body.party, null);

  // the guest leaves; then the host ends it for everyone
  await json(app, 'POST', `/api/together/${p.id}/join`, { token: kid });
  await json(app, 'POST', `/api/together/${p.id}/leave`, { token: guest });
  const kidWait = json(app, 'GET', `/api/together/${p.id}/wait?version=999&timeout=2000`, { token: kid });
  await json(app, 'POST', `/api/together/${p.id}/leave`, { token: host });
  assert.equal((await kidWait).body.party, null);
  assert.deepEqual((await json(app, 'GET', '/api/together', { token: guest })).body.parties, []);
});

test('one party per device', async () => {
  const { app, tokens } = await seeded();
  const a = (await json(app, 'POST', '/api/together', { token: tokens.admin, body: {} })).body;
  assert.equal(a.name, "boss's party");
  assert.equal((await json(app, 'POST', '/api/together', { token: tokens.admin, body: {} })).status, 409);
  const b = (await json(app, 'POST', '/api/together', { token: tokens.member, body: {} })).body;
  assert.equal((await json(app, 'POST', `/api/together/${b.id}/join`, { token: tokens.admin })).status, 409);
  assert.equal((await json(app, 'GET', '/api/together')).status, 401);
});

test('Guest Jam: a link anyone can open to see the queue and add songs from the library', async () => {
  const { createServer } = await import('node:http');
  const LIB = [
    { id: 'n1', title: 'Dancing Queen', artist: 'ABBA', album: 'Arrival', duration: 230 },
    { id: 'n2', title: 'Dirty Song', artist: 'Rude Band', explicitStatus: 'explicit' },
  ];
  const srv = createServer((req, res) => {
    const u = new URL(req.url!, 'http://x');
    const ok = (extra: object) => ({ 'subsonic-response': { status: 'ok', version: '1.16.1', ...extra } });
    let body: unknown = ok({});
    if (u.pathname === '/rest/getUser') body = ok({ user: { username: 'admin', adminRole: true } });
    if (u.pathname === '/rest/search3') body = ok({ searchResult3: { song: u.searchParams.get('songOffset') === '0' ? LIB : [] } });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
    const { app, tokens } = await seeded();
    await json(app, 'PUT', '/api/admin/library/navidrome', { token: tokens.admin, body: { url, username: 'admin', password: 'pw' } });
    const p = (await json(app, 'POST', '/api/together', { token: tokens.admin, body: { name: 'Kitchen' } })).body;
    assert.equal(p.jam, null);
    // only the host makes the link
    await json(app, 'POST', `/api/together/${p.id}/join`, { token: tokens.member });
    assert.equal((await json(app, 'POST', `/api/together/${p.id}/jam`, { token: tokens.member, body: { on: true } })).status, 403);
    const on = (await json(app, 'POST', `/api/together/${p.id}/jam`, { token: tokens.admin, body: { on: true } })).body;
    assert.match(on.jam, /\/jam\/[\w-]{12}$/);
    const code = on.jam.split('/jam/')[1];
    // guests don't see the link
    assert.equal((await json(app, 'GET', `/api/together/${p.id}/wait?version=0&timeout=10`, { token: tokens.member })).body.party.jam, undefined);

    const page = await app.inject({ method: 'GET', url: `/jam/${code}` });
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /Kitchen/);
    assert.equal((await app.inject({ method: 'GET', url: '/jam/nope' })).statusCode, 404);

    await json(app, 'PUT', `/api/together/${p.id}/state`, { token: tokens.admin, body: { queue: [song('a'), song('b')], index: 0, position: 1, duration: 200, playing: true } });
    const st = (await json(app, 'GET', `/api/jam/${code}`)).body;
    assert.deepEqual(st.now, { title: 'Song a', artist: 'Band' });
    assert.deepEqual(st.next, [{ title: 'Song b', artist: 'Band' }]);
    assert.equal(JSON.stringify(st).includes('sourceId'), false);

    const found = (await json(app, 'GET', `/api/jam/${code}/search?q=dancing%20quen`)).body.songs;
    assert.deepEqual(found.map((s: { id: string }) => s.id), ['n1']);
    assert.equal((await json(app, 'POST', `/api/jam/${code}/add`, { body: { id: 'n1' } })).status, 400); // no name
    assert.equal((await json(app, 'POST', `/api/jam/${code}/add`, { body: { id: 'zzz', name: 'Sam' } })).status, 404);
    assert.equal((await json(app, 'POST', `/api/jam/${code}/add`, { body: { id: 'n1', name: 'Sam' } })).status, 200);
    const host = (await json(app, 'GET', `/api/together/${p.id}/wait?version=999&timeout=10`, { token: tokens.admin })).body;
    assert.equal(host.requests[0].from, 'Sam (guest)');
    assert.equal(host.requests[0].tracks[0].id, 'n1');
    assert.equal(host.requests[0].tracks[0].hubServer, url);

    // with a kid in the party, explicit songs are left out
    assert.equal((await json(app, 'GET', `/api/jam/${code}/search?q=dirty`)).body.songs.length, 1);
    await json(app, 'POST', `/api/together/${p.id}/join`, { token: tokens.kid });
    assert.equal((await json(app, 'GET', `/api/jam/${code}/search?q=dirty`)).body.songs.length, 0);
    assert.equal((await json(app, 'POST', `/api/jam/${code}/add`, { body: { id: 'n2', name: 'Sam' } })).status, 403);

    // the host turns guest adds off, then the link off
    await json(app, 'PATCH', `/api/together/${p.id}`, { token: tokens.admin, body: { guestsAdd: false } });
    assert.equal((await json(app, 'POST', `/api/jam/${code}/add`, { body: { id: 'n1', name: 'Sam' } })).status, 403);
    await json(app, 'POST', `/api/together/${p.id}/jam`, { token: tokens.admin, body: { on: false } });
    assert.equal((await json(app, 'GET', `/api/jam/${code}`)).status, 404);
  } finally {
    srv.close();
  }
});
