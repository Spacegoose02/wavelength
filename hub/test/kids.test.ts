import assert from 'node:assert/strict';
import { test } from 'node:test';
import { json, seeded } from './helpers.ts';

const DAY = '2026-10-29';

test('an admin sets a kid’s bedtime and daily limit; listening adds up across devices', async () => {
  const { app, tokens, ids } = await seeded();
  const put = (body: unknown, token = tokens.admin, id = ids.kid) => json(app, 'PUT', `/api/admin/kids/${id}`, { token, body });

  const r = await put({ bedtimeFrom: '20:30', bedtimeTo: '07:00', dailyMinutes: 90 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await put({ dailyMinutes: 60 })).body.rules.bedtimeFrom, '20:30', 'leaving a field out keeps it');
  assert.equal((await put({ bedtimeFrom: '25:00' })).status, 400);
  assert.equal((await put({ bedtimeFrom: null })).status, 400, 'bedtime needs both ends');
  assert.equal((await put({ dailyMinutes: -5 })).status, 400);
  assert.equal((await put({ dailyMinutes: 30 }, tokens.admin, ids.member)).status, 400, 'only kids');
  assert.equal((await put({ dailyMinutes: 30 }, tokens.member)).status, 403);
  assert.equal((await put({ dailyMinutes: 999 }, tokens.kid)).status, 403, 'a kid cannot change their own limit');

  const me = await json(app, 'GET', `/api/me/kid?day=${DAY}`, { token: tokens.kid });
  assert.deepEqual(me.body.rules, { bedtimeFrom: '20:30', bedtimeTo: '07:00', dailyMinutes: 60 });
  assert.equal(me.body.kid, true);

  await json(app, 'POST', '/api/me/listened', { token: tokens.kid, body: { day: DAY, seconds: 60 } });
  const more = await json(app, 'POST', '/api/me/listened', { token: tokens.kid, body: { day: DAY, seconds: 100000 } });
  assert.equal(more.body.usedSeconds, 360, 'one report counts at most 5 minutes');
  assert.equal((await json(app, 'POST', '/api/me/listened', { token: tokens.kid, body: { day: 'today', seconds: 5 } })).status, 400);

  const admin = await json(app, 'GET', `/api/admin/kids?day=${DAY}`, { token: tokens.admin });
  assert.equal(admin.body.kids.length, 1);
  assert.equal(admin.body.kids[0].usedSeconds, 360);
  assert.equal(admin.body.kids[0].rules.dailyMinutes, 60);
  assert.equal((await json(app, 'GET', `/api/admin/kids?day=${DAY}`, { token: tokens.kid })).status, 403);
});

test('the grown-up PIN', async () => {
  const { app, tokens } = await seeded();
  const unlock = (pin: unknown) => json(app, 'POST', '/api/kid/unlock', { token: tokens.kid, body: { pin } });
  assert.equal((await unlock('1234')).status, 404, 'no PIN yet');
  assert.equal((await json(app, 'PUT', '/api/admin/kid-pin', { token: tokens.kid, body: { pin: '0000' } })).status, 403);
  assert.equal((await json(app, 'PUT', '/api/admin/kid-pin', { token: tokens.admin, body: { pin: '12a4' } })).status, 400);
  assert.equal((await json(app, 'PUT', '/api/admin/kid-pin', { token: tokens.admin, body: { pin: '2468' } })).status, 200);
  assert.equal((await json(app, 'GET', `/api/me/kid?day=${DAY}`, { token: tokens.kid })).body.pinSet, true);

  assert.equal((await unlock('1111')).status, 403);
  assert.equal((await unlock('2468')).status, 200);
  for (let i = 0; i < 10; i++) await unlock('0000');
  assert.equal((await unlock('2468')).status, 429, 'guessing is slowed down');

  const log = JSON.stringify((await json(app, 'GET', '/api/admin/audit', { token: tokens.admin })).body);
  assert.ok(log.includes('kid.pin_failed') && log.includes('kid.unlocked') && !log.includes('2468'));
  await json(app, 'PUT', '/api/admin/kid-pin', { token: tokens.admin, body: { pin: null } });
  assert.equal((await json(app, 'GET', `/api/me/kid?day=${DAY}`, { token: tokens.kid })).body.pinSet, false);
});

test('a parent switches to their own kid without a PIN, and their own PIN gets them back (no families needed)', async () => {
  const { app, tokens, ids } = await seeded();
  // mia is kit's parent; the Hub has no families and no grown-up PIN
  await json(app, 'PUT', `/api/admin/users/${ids.kid}/guardians`, { token: tokens.admin, body: { ids: [ids.member] } });

  const fam = await json(app, 'GET', '/api/me/family', { token: tokens.member });
  assert.deepEqual(fam.body.people.map((p: { id: number; parent: boolean; noPinNeeded: boolean }) => [p.id, p.parent, p.noPinNeeded]), [[ids.kid, true, true]], 'a parent sees their kid without a family');
  assert.deepEqual((await json(app, 'GET', '/api/me/family', { token: tokens.admin })).body.people, [], 'not someone else’s kid');

  // even when the kid set a switching PIN of their own
  await json(app, 'PUT', '/api/me/switch-pin', { token: tokens.kid, body: { pin: '1111' } });
  const sw = await json(app, 'POST', '/api/me/switch', { token: tokens.member, body: { userId: ids.kid, deviceName: 'Living room TV', platform: 'android' } });
  assert.equal(sw.status, 200, JSON.stringify(sw.body));
  assert.equal(sw.body.user.id, ids.kid);
  const kidTv = sw.body.token as string;
  assert.equal((await json(app, 'POST', '/api/me/switch', { token: tokens.admin, body: { userId: ids.kid } })).status, 404, 'only the kid’s parents, without a family');

  // leaving the kid profile: nothing set yet, so the device can't
  assert.equal((await json(app, 'GET', `/api/me/kid?day=${DAY}`, { token: kidTv })).body.pinSet, false);
  assert.equal((await json(app, 'POST', '/api/kid/unlock', { token: kidTv, body: { pin: '2468' } })).status, 404);
  assert.equal((await json(app, 'POST', '/api/me/switch', { token: kidTv, body: { userId: ids.member } })).status, 404, 'the kid can’t step into the parent');

  // the parent's switching PIN works as the grown-up PIN on their kid's devices
  await json(app, 'PUT', '/api/me/switch-pin', { token: tokens.member, body: { pin: '2468' } });
  assert.equal((await json(app, 'GET', `/api/me/kid?day=${DAY}`, { token: kidTv })).body.pinSet, true);
  assert.equal((await json(app, 'POST', '/api/kid/unlock', { token: kidTv, body: { pin: '1111' } })).status, 403, 'the kid’s own PIN isn’t a grown-up’s');
  assert.equal((await json(app, 'POST', '/api/kid/unlock', { token: kidTv, body: { pin: '2468' } })).status, 200);
  // a grown-up who isn't the kid's parent: their PIN doesn't count
  await json(app, 'PUT', '/api/me/switch-pin', { token: tokens.admin, body: { pin: '9999' } });
  assert.equal((await json(app, 'POST', '/api/kid/unlock', { token: kidTv, body: { pin: '9999' } })).status, 403);
  // the grown-up PIN still works alongside
  await json(app, 'PUT', '/api/admin/kid-pin', { token: tokens.admin, body: { pin: '5555' } });
  assert.equal((await json(app, 'POST', '/api/kid/unlock', { token: kidTv, body: { pin: '5555' } })).status, 200);
  assert.equal((await json(app, 'POST', '/api/kid/unlock', { token: kidTv, body: { pin: '2468' } })).status, 200);
  // a parent who is turned off no longer unlocks
  await json(app, 'PUT', `/api/admin/kid-pin`, { token: tokens.admin, body: { pin: null } });
  await json(app, 'PATCH', `/api/admin/users/${ids.member}`, { token: tokens.admin, body: { disabled: true } });
  assert.equal((await json(app, 'POST', '/api/kid/unlock', { token: kidTv, body: { pin: '2468' } })).status, 404);
});
