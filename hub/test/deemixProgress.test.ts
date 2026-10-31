import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, test } from 'node:test';
import { buildApp } from '../src/app.ts';
import { DeemixWatch, describe } from '../src/deemixQueue.ts';
import { json, seeded } from './helpers.ts';

const servers: Server[] = [];
after(() => servers.forEach((s) => s.close()));

type Item = { uuid: string; type: string; id: string; title: string; artist: string; status: string; size: number; downloaded: number; failed: number; progress: number; bitrate: number; errors?: unknown[] };

/**
 * A stand-in deemix with deemix-gui's queue routes: getQueue (with queueOrder), addToQueue (refusing a link it
 * still has, like deemix), removeFromQueue and removeFinishedDownloads. Nothing moves unless the test moves it.
 */
async function fakeDeemix() {
  const st = { queue: {} as Record<string, Item>, order: [] as string[], calls: [] as string[] };
  const add = (i: Partial<Item> & { uuid: string }) => {
    const [type, id, bitrate] = i.uuid.split('_');
    st.queue[i.uuid] = { type, id, title: `T${id}`, artist: 'A', status: 'inQueue', size: 10, downloaded: 0, failed: 0, progress: 0, bitrate: Number(bitrate), ...i };
    st.order.push(i.uuid);
  };
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const u = new URL(req.url!, 'http://x');
      st.calls.push(u.pathname + u.search);
      let out: unknown = {};
      if (u.pathname === '/api/getQueue') out = { queue: structuredClone(st.queue), queueOrder: st.order };
      else if (u.pathname === '/api/getSettings') out = { settings: { albumNameTemplate: '%album%' } };
      else if (u.pathname === '/api/addToQueue') {
        const { url, bitrate } = JSON.parse(body);
        const [, type, id] = /deezer\.com\/(\w+)\/(\d+)/.exec(url)!;
        const uuid = `${type}_${id}_${bitrate}`;
        if (st.queue[uuid]) out = { result: false, errid: 'AlreadyInQueue' };
        else (add({ uuid }), (out = { result: true, data: { obj: [{ uuid }] } }));
      } else if (u.pathname === '/api/removeFromQueue') {
        const uuid = u.searchParams.get('uuid')!;
        delete st.queue[uuid];
        st.order = st.order.filter((x) => x !== uuid);
      } else if (u.pathname === '/api/removeFinishedDownloads') {
        for (const [k, i] of Object.entries(st.queue)) if (!['inQueue', 'downloading'].includes(i.status)) delete st.queue[k];
        st.order = st.order.filter((x) => st.queue[x]);
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  });
  servers.push(srv);
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, st, add };
}

async function withDeemix() {
  const dz = await fakeDeemix();
  const hub = await seeded();
  await json(hub.app, 'POST', '/api/admin/services', { token: hub.tokens.admin, body: { kind: 'deemix', url: dz.url, secrets: { arl: 'x' }, config: { bitrate: 3 } } });
  return { dz, ...hub };
}

test('the queue reads as places in line, songs done, and why songs failed', () => {
  let now = 1_000_000;
  const watch = new DeemixWatch(() => now, 60_000);
  const raw = {
    queueOrder: ['album_1_9', 'album_2_9', 'album_3_9', 'track_4_9'],
    queue: {
      album_1_9: { uuid: 'album_1_9', type: 'album', id: 1, title: 'One', status: 'downloading', size: 12, downloaded: 5, failed: 1, progress: 41.7, errors: [{ errid: 'notAvailable', data: { title: 'Song', artist: 'X' } }] },
      album_2_9: { uuid: 'album_2_9', type: 'album', id: 2, title: 'Two', status: 'inQueue', size: 8 },
      album_3_9: { uuid: 'album_3_9', type: 'album', id: 3, title: 'Three', status: 'inQueue', size: 8 },
      track_4_9: { uuid: 'track_4_9', type: 'track', id: 4, title: 'Four', status: 'failed', size: 1, failed: 1, errors: [{ message: 'Track not found' }] },
    },
  };
  const items = watch.read(raw);
  assert.deepEqual(items.map((i) => i.position), [null, 1, 2, null]);
  assert.deepEqual(items[0].errors, [{ title: 'Song', artist: 'X', message: 'Not available in your Deezer country or account' }]);
  assert.equal(describe(items[0]), 'Downloading · 5 of 12 songs · 1 failed');
  assert.equal(describe(items[1]), 'Waiting · next up');
  assert.equal(describe(items[2]), 'Waiting · 2 in line');
  assert.equal(describe(items[3]), 'Failed · Track not found');
  assert.ok(!items.some((i) => i.stalled));

  // nothing moves for longer than the stall time: the one in front is stuck
  now += 61_000;
  const later = watch.read(raw);
  assert.deepEqual(later.map((i) => i.stalled), [true, false, false, false]);
  // it moves again: not stuck
  now += 1000;
  raw.queue.album_1_9.downloaded = 6;
  assert.ok(!watch.read(raw).some((i) => i.stalled));
});

test('Downloads shows deemix progress, and cancels, retries and clears downloads', async () => {
  const { dz, app, tokens } = await withDeemix();
  dz.add({ uuid: 'album_10_3', status: 'downloading', downloaded: 3 });
  dz.add({ uuid: 'album_11_3', status: 'failed', errors: [{ message: 'Album not found' }] });
  dz.add({ uuid: 'album_12_3', status: 'completed', downloaded: 10 });

  assert.equal((await json(app, 'GET', '/api/downloads/deemix/progress', { token: tokens.kid })).status, 403);
  const p = await json(app, 'GET', '/api/downloads/deemix/progress', { token: tokens.admin });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.deepEqual(p.body.items.map((i: { uuid: string; downloaded: number }) => [i.uuid, i.downloaded]), [['album_10_3', 3], ['album_11_3', 0], ['album_12_3', 10]]);
  assert.equal(p.body.items[1].errors[0].message, 'Album not found');
  assert.deepEqual(p.body.clean, []);

  // retry: the failed one comes off deemix's list and goes back on
  const r = await json(app, 'POST', '/api/downloads/deemix/queue/album_11_3/retry', { token: tokens.admin });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(dz.st.queue.album_11_3.status, 'inQueue');
  assert.equal((await json(app, 'POST', '/api/downloads/deemix/queue/album_99_3/retry', { token: tokens.admin })).status, 404);

  // cancel the one downloading
  assert.equal((await json(app, 'POST', '/api/downloads/deemix/queue/album_10_3/cancel', { token: tokens.admin })).status, 200);
  assert.ok(!dz.st.queue.album_10_3);

  // clear finished: the completed one goes, the waiting one stays
  assert.equal((await json(app, 'POST', '/api/downloads/deemix/queue/clear', { token: tokens.admin })).status, 200);
  assert.deepEqual(Object.keys(dz.st.queue), ['album_11_3']);
});

test('approving a failed request again works even though deemix still lists the failed download', async () => {
  const { dz, app, tokens } = await withDeemix();
  dz.add({ uuid: 'album_20_3', status: 'failed' });
  const r = await json(app, 'POST', '/api/requests', { token: tokens.admin, body: { link: 'https://www.deezer.com/album/20', kind: 'album', title: 'X', artist: 'Y' } });
  assert.equal(r.body.request.status, 'approved', JSON.stringify(r.body));
  assert.equal(dz.st.queue.album_20_3.status, 'inQueue', 'the old failed one was replaced');

  // still waiting or downloading: left alone, not an error
  const again = await json(app, 'POST', '/api/downloads/deemix/queue', { token: tokens.admin, body: { link: 'https://www.deezer.com/album/20' } });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(dz.st.calls.filter((c) => c.startsWith('/api/removeFromQueue')).length, 1);
});

test('requests show their download progress, and fail with a reason when deemix loses them', async () => {
  const { dz, app, tokens, db } = await withDeemix();
  const r = await json(app, 'POST', '/api/requests', { token: tokens.admin, body: { link: 'https://www.deezer.com/album/30', kind: 'album', title: 'X', artist: 'Y' } });
  const id = r.body.request.id;
  Object.assign(dz.st.queue.album_30_3, { status: 'downloading', downloaded: 4, failed: 1, progress: 50, errors: [{ errid: 'notEncoded', data: { title: 'Intro' } }] });
  await app.hubLibrary.tick();
  const mine = async () => (await json(app, 'GET', '/api/requests', { token: tokens.admin })).body.requests.find((x: { id: number }) => x.id === id);
  const p = (await mine()).progress;
  assert.equal(p.label, 'Downloading · 4 of 10 songs · 1 failed');
  assert.deepEqual([p.done, p.total, p.failed, p.percent], [4, 10, 1, 50]);
  assert.equal(p.errors[0].message, 'Deezer has no file for it yet');

  // deemix restarted and forgot it: not "Downloading" for ever
  delete dz.st.queue.album_30_3;
  await app.hubLibrary.tick();
  assert.equal((await mine()).status, 'approved', 'not straight away');
  db.prepare('UPDATE requests SET decided_at = ? WHERE id = ?').run(Date.now() - 2 * 3600_000, id);
  await app.hubLibrary.tick();
  const lost = await mine();
  assert.equal(lost.status, 'failed');
  assert.match(lost.reason, /no longer has it/);
});

test('a clean version waiting on a stuck deemix says so, can be cancelled, and survives a Hub restart', async () => {
  const { dz, app, tokens, db, config } = await withDeemix();
  app.hubClean.pollMs = 10;
  app.hubClean.watch.stallMs = 30;
  dz.add({ uuid: 'album_40_3', status: 'downloading', downloaded: 2 });

  await json(app, 'POST', '/api/downloads/deemix/clean', { token: tokens.admin, body: { link: 'https://www.deezer.com/album/41' } });
  await json(app, 'POST', '/api/downloads/deemix/clean', { token: tokens.admin, body: { link: 'https://www.deezer.com/album/42' } });
  const jobs = async () => (await json(app, 'GET', '/api/downloads/deemix/progress', { token: tokens.admin })).body.clean;
  let first;
  for (let i = 0; i < 100; i++) {
    first = (await jobs())[0];
    if (first.stuck) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(first.stuck, true, JSON.stringify(first));
  assert.match(first.detail, /deemix looks stuck on “T40”/);
  assert.deepEqual((await jobs()).map((j: { position: number }) => j.position), [1, 2]);
  assert.equal(Object.keys(dz.st.queue).length, 1, 'nothing queued under someone else’s download');

  // a Hub restart keeps the line
  const again = buildApp(db, config, { watchLibrary: false });
  assert.deepEqual(again.hubClean.list().map((j) => j.link), ['https://www.deezer.com/album/41', 'https://www.deezer.com/album/42']);
  await json(again, 'DELETE', '/api/downloads/deemix/clean', { token: tokens.admin, body: { link: 'https://www.deezer.com/album/41' } });
  await json(again, 'DELETE', '/api/downloads/deemix/clean', { token: tokens.admin, body: { link: 'https://www.deezer.com/album/42' } });
  assert.equal((await json(again, 'DELETE', '/api/downloads/deemix/clean', { token: tokens.admin, body: { link: 'https://www.deezer.com/album/42' } })).status, 404);
  await again.close();

  // cancelling the stuck download lets the clean version through (on to swapping deemix's folder name)
  await json(app, 'DELETE', '/api/downloads/deemix/clean', { token: tokens.admin, body: { link: 'https://www.deezer.com/album/42' } });
  assert.ok(!dz.st.calls.includes('/api/getSettings'));
  await json(app, 'POST', '/api/downloads/deemix/queue/album_40_3/cancel', { token: tokens.admin });
  await app.hubClean.idle();
  assert.ok(dz.st.calls.includes('/api/getSettings'), 'went ahead once deemix was free');
  assert.equal(app.hubClean.list().find((j) => j.link.endsWith('/41'))?.state === 'waiting', false);
});
