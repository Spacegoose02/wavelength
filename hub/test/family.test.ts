import assert from 'node:assert/strict';
import { test } from 'node:test';
import { json, seeded } from './helpers.ts';

test('parents approve their own kids’ requests, and nobody else’s', async () => {
  const { app, tokens, ids } = await seeded();
  const ask = (token: string, title: string) => json(app, 'POST', '/api/requests', { token, body: { link: `https://www.deezer.com/album/${title.length}`, kind: 'album', title, artist: 'Band' } });

  assert.equal((await json(app, 'GET', '/api/admin/requests', { token: tokens.member })).status, 403, 'not a parent yet');
  assert.equal((await json(app, 'PUT', `/api/admin/users/${ids.kid}/guardians`, { token: tokens.member, body: { ids: [ids.member] } })).status, 403);
  assert.equal((await json(app, 'PUT', `/api/admin/users/${ids.member}/guardians`, { token: tokens.admin, body: { ids: [ids.admin] } })).status, 400, 'only kids have parents');
  assert.equal((await json(app, 'PUT', `/api/admin/users/${ids.kid}/guardians`, { token: tokens.admin, body: { ids: [ids.kid] } })).status, 400, 'a kid can’t be a parent');
  const set = await json(app, 'PUT', `/api/admin/users/${ids.kid}/guardians`, { token: tokens.admin, body: { ids: [ids.member] } });
  assert.equal(set.status, 200);
  assert.deepEqual(set.body.user.guardians, [ids.member]);
  assert.deepEqual((await json(app, 'GET', '/api/me', { token: tokens.member })).body.kids, [{ id: ids.kid, displayName: set.body.user.displayName }]);

  const kidAsk = (await ask(tokens.kid, 'Kid Album')).body.request;
  const memberAsk = (await ask(tokens.member, 'Grown-up Album')).body.request;
  const notes = (await json(app, 'GET', '/api/notifications?after=0', { token: tokens.member })).body.notifications;
  assert.ok(notes.some((n: { kind: string; body: string }) => n.kind === 'request.new' && /Kid Album/.test(n.body)), 'the parent hears about it');

  const list = (await json(app, 'GET', '/api/admin/requests?status=pending', { token: tokens.member })).body.requests;
  assert.deepEqual(list.map((r: { id: number }) => r.id), [kidAsk.id], 'only their kid’s');
  assert.equal((await json(app, 'GET', '/api/requests/counts', { token: tokens.member })).body.pending, 1);
  assert.equal((await json(app, 'POST', `/api/admin/requests/${memberAsk.id}/reject`, { token: tokens.member, body: {} })).status, 404, 'not their own or anyone else’s');
  const no = await json(app, 'POST', `/api/admin/requests/${kidAsk.id}/reject`, { token: tokens.member, body: { reason: 'Not this one' } });
  assert.equal(no.status, 200);
  assert.equal(no.body.request.status, 'rejected');
  assert.equal((await json(app, 'DELETE', `/api/admin/requests/${kidAsk.id}`, { token: tokens.member })).status, 403, 'deleting stays with admins');

  // no longer a parent
  await json(app, 'PUT', `/api/admin/users/${ids.kid}/guardians`, { token: tokens.admin, body: { ids: [] } });
  assert.equal((await json(app, 'GET', '/api/admin/requests', { token: tokens.member })).status, 403);
});
