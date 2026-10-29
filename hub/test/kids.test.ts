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
