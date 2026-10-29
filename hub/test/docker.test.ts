import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { demux } from '../src/routes/docker.ts';
import { json, seeded } from './helpers.ts';

/** A stand-in for a Docker socket proxy: three containers, start/stop/restart, logs. */
async function fakeDocker() {
  const containers = [
    { Id: 'aaa111', Names: ['/navidrome'], Image: 'deluan/navidrome', State: 'running', Status: 'Up 2 hours', Created: 1_700_000_000 },
    { Id: 'bbb222', Names: ['/slskd'], Image: 'slskd/slskd', State: 'exited', Status: 'Exited (0) 1 hour ago', Created: 1_700_000_000 },
    { Id: 'ccc333', Names: ['/vaultwarden'], Image: 'vaultwarden/server', State: 'running', Status: 'Up 3 days', Created: 1_700_000_000 },
  ];
  const calls: string[] = [];
  const frame = (stream: number, s: string) => {
    const body = Buffer.from(s);
    const head = Buffer.alloc(8);
    head[0] = stream;
    head.writeUInt32BE(body.length, 4);
    return Buffer.concat([head, body]);
  };
  const server: Server = createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`);
    const url = new URL(req.url!, 'http://docker');
    if (url.pathname === '/containers/json') return res.end(JSON.stringify(containers));
    const m = url.pathname.match(/^\/containers\/(\w+)\/(start|stop|restart|logs)$/);
    const c = m && containers.find((x) => x.Id === m[1]);
    if (!m || !c) return res.writeHead(404).end(JSON.stringify({ message: 'No such container' }));
    if (m[2] === 'logs') return res.end(Buffer.concat([frame(1, 'listening on :4533\n'), frame(2, 'scan done\n')]));
    if (m[2] === 'start' && c.State === 'running') return res.writeHead(304).end();
    c.State = m[2] === 'stop' ? 'exited' : 'running';
    c.Status = c.State === 'running' ? 'Up 1 second' : 'Exited (0) 1 second ago';
    res.writeHead(204).end();
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls, close: () => server.close() };
}

test('admins see and control only the containers the Hub is allowed', async (t) => {
  const docker = await fakeDocker();
  t.after(docker.close);
  const { app, db, tokens } = await seeded({}, { dockerUrl: docker.url, dockerContainers: ['navidrome', 'slskd', 'lidarr'] });

  const list = await json(app, 'GET', '/api/admin/docker', { token: tokens.admin });
  assert.equal(list.status, 200);
  assert.equal(list.body.enabled, true);
  assert.deepEqual(list.body.containers.map((c: { name: string; state: string }) => [c.name, c.state]), [
    ['navidrome', 'running'],
    ['slskd', 'exited'],
    ['lidarr', 'missing'],
  ]);

  const started = await json(app, 'POST', '/api/admin/docker/slskd/start', { token: tokens.admin });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.state, 'running');
  assert.ok(docker.calls.includes('POST /containers/bbb222/start?t=10'));
  // already running: Docker says 304, which is fine
  assert.equal((await json(app, 'POST', '/api/admin/docker/slskd/start', { token: tokens.admin })).status, 200);
  assert.equal((await json(app, 'POST', '/api/admin/docker/navidrome/restart', { token: tokens.admin })).body.state, 'running');

  const logs = await json(app, 'GET', '/api/admin/docker/navidrome/logs?lines=50', { token: tokens.admin });
  assert.equal(logs.body.logs, 'listening on :4533\nscan done\n');
  assert.ok(docker.calls.some((c) => c.startsWith('GET /containers/aaa111/logs?') && c.includes('tail=50')));

  // not on the list: invisible and untouchable, even though Docker has it
  const before = docker.calls.length;
  assert.equal((await json(app, 'POST', '/api/admin/docker/vaultwarden/stop', { token: tokens.admin })).status, 404);
  assert.equal((await json(app, 'GET', '/api/admin/docker/vaultwarden/logs', { token: tokens.admin })).status, 404);
  assert.ok(!docker.calls.slice(before).some((c) => c.includes('ccc333')));
  assert.equal((await json(app, 'POST', '/api/admin/docker/navidrome/kill', { token: tokens.admin })).status, 400);

  // members and kids can't
  for (const who of ['member', 'kid'] as const) {
    assert.equal((await json(app, 'GET', '/api/admin/docker', { token: tokens[who] })).status, 403, who);
    assert.equal((await json(app, 'POST', '/api/admin/docker/navidrome/stop', { token: tokens[who] })).status, 403, who);
  }

  const actions = db.prepare(`SELECT action, target FROM audit WHERE action LIKE 'docker.%' ORDER BY id`).all();
  assert.deepEqual(actions.map((a) => `${a.action} ${a.target}`), ['docker.start slskd', 'docker.start slskd', 'docker.restart navidrome']);
});

test('Docker control is off unless configured, and says so when Docker is unreachable', async () => {
  const off = await seeded();
  assert.deepEqual((await json(off.app, 'GET', '/api/admin/docker', { token: off.tokens.admin })).body, { enabled: false, containers: [] });
  assert.equal((await json(off.app, 'POST', '/api/admin/docker/navidrome/start', { token: off.tokens.admin })).status, 501);

  const down = await seeded({}, { dockerUrl: 'http://127.0.0.1:1', dockerContainers: ['navidrome'] });
  const r = await json(down.app, 'GET', '/api/admin/docker', { token: down.tokens.admin });
  assert.equal(r.status, 502);
  assert.match(r.body.error, /Can't reach Docker/);
});

test('log frames are unwrapped; TTY logs pass through', () => {
  assert.equal(demux(Buffer.from('plain tty output\n')), 'plain tty output\n');
  const head = Buffer.alloc(8);
  head[0] = 1;
  head.writeUInt32BE(3, 4);
  assert.equal(demux(Buffer.concat([head, Buffer.from('hi\n')])), 'hi\n');
});
