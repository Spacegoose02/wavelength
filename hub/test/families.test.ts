import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getApiKey } from '../src/dj/settings.ts';
import { keyFor } from '../src/families.ts';
import { json, seeded } from './helpers.ts';

/** Two families: the admin's (with mia and kit) and the Smiths (sam, their manager, and sid, a kid). */
async function twoFamilies(extra: Parameters<typeof seeded>[1] = {}) {
  const hub = await seeded({}, extra);
  const { app, tokens, ids } = hub;
  const mine = (await json(app, 'POST', '/api/admin/families', { token: tokens.admin, body: { name: 'Underwoods' } })).body.family;
  const smiths = (await json(app, 'POST', '/api/admin/families', { token: tokens.admin, body: { name: 'Smiths', canRegister: true, kidControls: true, ownKeys: true, maxPeople: 3 } })).body.family;
  for (const id of [ids.admin, ids.member, ids.kid]) await json(app, 'PUT', `/api/admin/users/${id}/family`, { token: tokens.admin, body: { familyId: mine.id } });
  const sam = (await json(app, 'POST', '/api/admin/users', { token: tokens.admin, body: { username: 'sam', role: 'member', password: 'sam-password-123' } })).body.user;
  await json(app, 'PUT', `/api/admin/users/${sam.id}/family`, { token: tokens.admin, body: { familyId: smiths.id, manager: true } });
  const samToken = (await json(app, 'POST', '/auth/login', { body: { username: 'sam', password: 'sam-password-123', deviceName: 'TV' } })).body.token as string;
  return { ...hub, mine, smiths, sam, samToken };
}

test('only the Hub admin sees and changes families; managers only do what their family allows', async () => {
  const { app, tokens, ids, smiths, mine, samToken } = await twoFamilies();
  assert.equal((await json(app, 'GET', '/api/admin/families', { token: tokens.member })).status, 403);
  assert.equal((await json(app, 'GET', '/api/admin/families', { token: samToken })).status, 403, 'a manager isn’t the admin');
  assert.equal((await json(app, 'GET', '/api/family', { token: tokens.member })).status, 403, 'members never see family settings');
  assert.equal((await json(app, 'POST', '/api/admin/families', { token: tokens.admin, body: { name: 'smiths' } })).status, 409);

  const fam = await json(app, 'GET', '/api/family', { token: samToken });
  assert.equal(fam.status, 200);
  assert.equal(fam.body.family.name, 'Smiths');
  assert.ok(Array.isArray(fam.body.keys));

  // registering: a kid into their own family, not an admin, and not past the family's most people
  const sid = await json(app, 'POST', '/api/family/users', { token: samToken, body: { username: 'sid', role: 'kid', password: 'sid-password-123' } });
  assert.equal(sid.status, 200);
  assert.equal((await json(app, 'GET', '/api/admin/users', { token: tokens.admin })).body.users.find((u: { username: string }) => u.username === 'sid').familyId, smiths.id);
  assert.equal((await json(app, 'POST', '/api/family/users', { token: samToken, body: { username: 'boss2', role: 'admin', password: 'x-password-123' } })).status, 400);
  const inv = await json(app, 'POST', '/api/admin/invites', { token: samToken, body: { role: 'member' } });
  assert.equal(inv.status, 200);
  assert.equal((await json(app, 'POST', '/auth/invite', { body: { code: inv.body.code, username: 'sue', password: 'sue-password-123' } })).status, 200);
  assert.equal((await json(app, 'GET', '/api/family', { token: samToken })).body.people.length, 3, 'sue joined the Smiths');
  assert.equal((await json(app, 'POST', '/api/family/users', { token: samToken, body: { username: 'sky', role: 'kid', password: 'sky-password-123' } })).status, 409, 'full');
  assert.equal((await json(app, 'POST', '/api/admin/invites', { token: samToken, body: { role: 'admin' } })).status, 400);

  // a manager can't touch other families' people
  assert.equal((await json(app, 'PATCH', `/api/family/users/${ids.kid}`, { token: samToken, body: { displayName: 'Hacked' } })).status, 404);
  assert.equal((await json(app, 'PATCH', `/api/family/users/${sid.body.user.id}`, { token: samToken, body: { displayName: 'Sidney' } })).body.user.displayName, 'Sidney');

  // kid controls: their family's kids only, and their own grown-up PIN
  const kids = await json(app, 'GET', '/api/admin/kids?day=2026-11-01', { token: samToken });
  assert.deepEqual(kids.body.kids.map((k: { displayName: string }) => k.displayName), ['Sidney']);
  assert.equal((await json(app, 'PUT', `/api/admin/kids/${ids.kid}`, { token: samToken, body: { dailyMinutes: 5 } })).status, 404);
  assert.equal((await json(app, 'PUT', `/api/admin/kids/${sid.body.user.id}`, { token: samToken, body: { dailyMinutes: 45 } })).status, 200);
  assert.equal((await json(app, 'PUT', '/api/admin/kid-pin', { token: samToken, body: { pin: '2468' } })).status, 200);
  await json(app, 'PUT', '/api/admin/kid-pin', { token: tokens.admin, body: { pin: '1357' } });
  const sidToken = (await json(app, 'POST', '/auth/login', { body: { username: 'sid', password: 'sid-password-123' } })).body.token;
  assert.equal((await json(app, 'POST', '/api/kid/unlock', { token: sidToken, body: { pin: '1357' } })).status, 403, 'the Smiths’ kids use the Smiths’ PIN');
  assert.equal((await json(app, 'POST', '/api/kid/unlock', { token: sidToken, body: { pin: '2468' } })).status, 200);
  assert.equal((await json(app, 'POST', '/api/kid/unlock', { token: tokens.kid, body: { pin: '1357' } })).status, 200, 'everyone else keeps the Hub’s');

  // the admin takes a power away
  await json(app, 'PATCH', `/api/admin/families/${smiths.id}`, { token: tokens.admin, body: { kidControls: false, canRegister: false } });
  assert.equal((await json(app, 'GET', '/api/admin/kids?day=2026-11-01', { token: samToken })).status, 403);
  assert.equal((await json(app, 'POST', '/api/family/users', { token: samToken, body: { username: 'sal', role: 'kid', password: 'sal-password-123' } })).status, 403);
  assert.equal((await json(app, 'GET', '/api/admin/kids?day=2026-11-01', { token: tokens.admin })).body.kids.length, 2, 'the admin sees every kid');
  void mine;
});

test('shared keys: a family’s own wins over the whole Hub’s, which wins over the environment; devices get the Discord ID', async () => {
  const { app, db, config, tokens, ids, smiths, sam, samToken } = await twoFamilies({ fanartKey: 'env-fanart' });
  const k = config.secretKey;
  assert.equal(keyFor(db, k, ids.member, 'fanart', config.fanartKey), 'env-fanart');
  assert.equal((await json(app, 'PUT', '/api/admin/keys', { token: tokens.admin, body: { values: { fanart: 'hub-fanart', discordAppId: '123456789012' } } })).status, 200);
  assert.equal((await json(app, 'PUT', '/api/admin/keys', { token: tokens.admin, body: { values: { anthropic: 'x' } } })).status, 400, 'the whole Hub’s AI key lives in Settings → AI DJ');
  assert.equal((await json(app, 'PUT', '/api/admin/keys', { token: tokens.member, body: { values: { fanart: 'x' } } })).status, 403);
  assert.equal(keyFor(db, k, ids.member, 'fanart', config.fanartKey), 'hub-fanart');

  const fam = await json(app, 'PUT', '/api/family/keys', { token: samToken, body: { values: { fanart: 'smith-fanart', anthropic: 'sk-ant-smiths', discordAppId: '999999999999' } } });
  assert.equal(fam.status, 200);
  assert.ok(!JSON.stringify(fam.body).includes('sk-ant-smiths'), 'never sent back');
  assert.equal(keyFor(db, k, sam.id, 'fanart'), 'smith-fanart');
  assert.equal(keyFor(db, k, ids.member, 'fanart'), 'hub-fanart', 'other families keep the Hub’s');
  assert.equal(getApiKey(db, k, 'apiKey', sam.id), 'sk-ant-smiths');
  assert.equal(getApiKey(db, k, 'apiKey', ids.member), null);
  assert.equal((await json(app, 'PUT', '/api/family/keys', { token: tokens.member, body: { values: { fanart: 'x' } } })).status, 403);

  assert.equal((await json(app, 'GET', '/api/me', { token: samToken })).body.shared.discordAppId, '999999999999');
  assert.equal((await json(app, 'GET', '/api/me', { token: tokens.member })).body.shared.discordAppId, '123456789012');

  // deleting a family drops its keys
  await json(app, 'DELETE', `/api/admin/families/${smiths.id}`, { token: tokens.admin });
  assert.equal(keyFor(db, k, sam.id, 'fanart'), 'hub-fanart');
});

test('Last.fm: a family’s own API account, else the Hub’s, else the environment’s', async () => {
  const { app, tokens, samToken, ids, sam } = await twoFamilies({ lastfmKey: 'env-k', lastfmSecret: 'env-s' });
  const scrobbler = app.hubScrobbler;
  assert.deepEqual(scrobbler.lastfmAccount(ids.member), { key: 'env-k', secret: 'env-s' });
  await json(app, 'PUT', '/api/family/keys', { token: samToken, body: { values: { lastfmKey: 'fam-k' } } });
  assert.deepEqual(scrobbler.lastfmAccount(sam.id), { key: 'env-k', secret: 'env-s' }, 'half an account isn’t used');
  await json(app, 'PUT', '/api/family/keys', { token: samToken, body: { values: { lastfmSecret: 'fam-s' } } });
  assert.deepEqual(scrobbler.lastfmAccount(sam.id), { key: 'fam-k', secret: 'fam-s' });
  await json(app, 'PUT', '/api/admin/keys', { token: tokens.admin, body: { values: { lastfmKey: 'hub-k', lastfmSecret: 'hub-s' } } });
  assert.deepEqual(scrobbler.lastfmAccount(ids.member), { key: 'hub-k', secret: 'hub-s' });
});

test('switching profiles: within a family, with the other person’s PIN; kids can’t step into grown-ups', async () => {
  const { app, tokens, ids, samToken } = await twoFamilies();
  const people = await json(app, 'GET', '/api/me/family', { token: tokens.member });
  assert.deepEqual(people.body.people.map((p: { id: number }) => p.id).sort(), [ids.admin, ids.member, ids.kid].sort());
  assert.ok(!('canRegister' in people.body), 'no family settings for members');

  assert.equal((await json(app, 'POST', '/api/me/switch', { token: tokens.member, body: { userId: ids.admin } })).status, 409, 'no PIN set yet');
  assert.equal((await json(app, 'PUT', '/api/me/switch-pin', { token: tokens.admin, body: { pin: '12' } })).status, 400);
  await json(app, 'PUT', '/api/me/switch-pin', { token: tokens.admin, body: { pin: '4321' } });
  assert.equal((await json(app, 'POST', '/api/me/switch', { token: tokens.member, body: { userId: ids.admin, pin: '0000' } })).status, 403);
  const ok = await json(app, 'POST', '/api/me/switch', { token: tokens.member, body: { userId: ids.admin, pin: '4321' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.id, ids.admin);
  assert.equal(ok.body.device.name, 'Phone', 'named after the device it happened on');
  assert.equal((await json(app, 'GET', '/api/me', { token: ok.body.token })).body.user.id, ids.admin);

  // a grown-up switches to a kid without a PIN; the kid can't come back without one
  assert.equal((await json(app, 'POST', '/api/me/switch', { token: tokens.member, body: { userId: ids.kid } })).status, 200);
  assert.equal((await json(app, 'POST', '/api/me/switch', { token: tokens.kid, body: { userId: ids.member } })).status, 409);
  assert.equal((await json(app, 'POST', '/api/me/switch', { token: tokens.kid, body: { userId: ids.admin, pin: '4321' } })).status, 200, 'with the grown-up’s PIN');

  // never across families
  assert.equal((await json(app, 'POST', '/api/me/switch', { token: samToken, body: { userId: ids.kid } })).status, 404);
  assert.equal((await json(app, 'POST', '/api/me/switch', { token: samToken, body: { userId: ids.admin, pin: '4321' } })).status, 404);

  // the admin can take a forgotten PIN off
  await json(app, 'DELETE', `/api/admin/users/${ids.admin}/switch-pin`, { token: tokens.admin });
  assert.equal((await json(app, 'POST', '/api/me/switch', { token: tokens.member, body: { userId: ids.admin, pin: '4321' } })).status, 409);
});

test('a Hub server can be kept to some families', async () => {
  const { app, tokens, smiths, samToken } = await twoFamilies();
  const s = (await json(app, 'POST', '/api/admin/services', { token: tokens.admin, body: { kind: 'plex', name: 'Smith Plex', url: 'http://plex', access: 'everyone', secrets: { token: 't' } } })).body.service;
  assert.equal((await json(app, 'PUT', `/api/admin/services/${s.id}/families`, { token: tokens.member, body: { ids: [smiths.id] } })).status, 403);
  const set = await json(app, 'PUT', `/api/admin/services/${s.id}/families`, { token: tokens.admin, body: { ids: [smiths.id] } });
  assert.deepEqual(set.body.service.families, [smiths.id]);
  const names = async (token: string) => (await json(app, 'GET', '/api/me/services', { token })).body.services.map((x: { name: string }) => x.name);
  assert.deepEqual(await names(samToken), ['Smith Plex']);
  assert.deepEqual(await names(tokens.member), []);
  assert.deepEqual(await names(tokens.admin), ['Smith Plex'], 'admins always');
  await json(app, 'PUT', `/api/admin/services/${s.id}/families`, { token: tokens.admin, body: { ids: [] } });
  assert.deepEqual(await names(tokens.member), ['Smith Plex']);
});
