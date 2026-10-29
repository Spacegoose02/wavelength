import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pruneNotices } from '../src/notify.ts';
import { json, seeded } from './helpers.ts';

test('people get notified about their requests and what is shared with them', async () => {
  const { app, db, tokens } = await seeded();
  const feed = async (who: string, after?: number) =>
    (await json(app, 'GET', `/api/notifications${after === undefined ? '' : `?after=${after}`}`, { token: tokens[who] })).body as
      { notifications: { id: number; kind: string; title: string; body: string }[]; last: number };

  // a fresh device only learns where to start
  assert.deepEqual(await feed('kid'), { notifications: [], last: 0 });
  assert.equal((await json(app, 'GET', '/api/notifications?after=0')).status, 401);

  const ask = async (title: string) =>
    (await json(app, 'POST', '/api/requests', { token: tokens.kid, body: { link: `https://www.deezer.com/album/${title.length}${title.charCodeAt(0)}`, kind: 'album', title, artist: 'Daft Punk' } })).body.request;
  const r1 = await ask('Discovery');
  const r2 = await ask('Homework');
  const r3 = await ask('Alive');

  // admins hear about new requests; the member and the kid don't
  const a = await feed('admin', 0);
  assert.deepEqual(a.notifications.map((n) => [n.kind, n.body]), [['request.new', 'Discovery by Daft Punk'], ['request.new', 'Homework by Daft Punk'], ['request.new', 'Alive by Daft Punk']]);
  assert.match(a.notifications[0].title, /^New request from /);
  assert.equal((await feed('member', 0)).notifications.length, 0);

  await json(app, 'POST', `/api/admin/requests/${r1.id}/reject`, { token: tokens.admin, body: { reason: 'Not on a school night' } });
  await json(app, 'POST', `/api/admin/requests/${r2.id}/have`, { token: tokens.admin });
  // a finished download becomes ready once the library has it (no Navidrome here: straight away)
  db.prepare("UPDATE requests SET status = 'approved', downloaded_at = ? WHERE id = ?").run(Date.now() - 1000, r3.id);
  app.hubLibrary.downloaded();

  const k = await feed('kid', 0);
  assert.deepEqual(k.notifications.map((n) => [n.kind, n.title, n.body]), [
    ['request.rejected', 'Request not approved', 'Discovery by Daft Punk: Not on a school night'],
    ['request.have', 'Already in the library', 'Homework by Daft Punk was there all along'],
    ['request.ready', 'Ready to play', 'Alive by Daft Punk is in the library'],
  ]);
  // only what's new after the last one seen
  assert.deepEqual(await feed('kid', k.last), { notifications: [], last: k.last });

  // sharing: to one person, or to everyone but yourself
  await json(app, 'POST', '/api/shares', { token: tokens.member, body: { to: null, kind: 'track', title: 'One More Time', payload: { tracks: [] } } });
  const kidId = (await json(app, 'GET', '/api/people', { token: tokens.member })).body.people.find((p: { kid: boolean }) => p.kid).id;
  await json(app, 'POST', '/api/shares', { token: tokens.member, body: { to: kidId, kind: 'playlist', title: 'Road trip', payload: { tracks: [] } } });
  const ks = await feed('kid', k.last);
  assert.deepEqual(ks.notifications.map((n) => [n.kind, n.body]), [['share', 'One More Time'], ['share', 'Road trip']]);
  assert.match(ks.notifications[0].title, / shared a song$/);
  assert.match(ks.notifications[1].title, / shared a playlist$/);
  assert.deepEqual((await feed('admin', a.last)).notifications.map((n) => n.body), ['One More Time']);
  assert.equal((await feed('member', 0)).notifications.length, 0, 'not told about your own share');

  // kept for 30 days
  pruneNotices(db, Date.now() + 31 * 86_400_000);
  assert.deepEqual(await feed('kid', ks.last), { notifications: [], last: 0 }, 'the device starts over');
});

test('someone with Autodownload isn’t told about their own requests, only when they’re ready', async () => {
  const { app, tokens } = await seeded();
  // no downloader set up: the admin's own request fails straight away, and they already know why
  const r = await json(app, 'POST', '/api/requests', { token: tokens.admin, body: { link: 'https://www.deezer.com/album/2', kind: 'album', title: 'Cross', artist: 'Justice' } });
  assert.equal(r.body.request.status, 'failed');
  assert.equal((await json(app, 'GET', '/api/notifications?after=0', { token: tokens.admin })).body.notifications.length, 0);
});
