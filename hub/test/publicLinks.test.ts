import assert from 'node:assert/strict';
import { test } from 'node:test';
import { json, seeded } from './helpers.ts';

test('public links: behind the switch, names only, anyone can view, owners take them down', async () => {
  const { app, tokens, db } = await seeded();
  const body = {
    kind: 'playlist', title: 'Road trip <script>', subtitle: '2 songs', cover: 'https://nas/rest/getCoverArt?id=1&u=me&t=abc&s=salt',
    note: 'for the drive',
    payload: { tracks: [{ title: 'Dreams', artist: 'Fleetwood Mac', album: 'Rumours', duration: 257, streamUrl: 'https://nas/rest/stream?u=me&t=secret' }, { title: 'Go Your Own Way', artist: 'Fleetwood Mac' }] },
  };
  const off = await json(app, 'POST', '/api/public-links', { token: tokens.member, body });
  assert.equal(off.status, 403, 'off by default');

  const features = (await json(app, 'GET', '/api/admin/features', { token: tokens.admin })).body.features;
  await json(app, 'PUT', '/api/admin/features', { token: tokens.admin, body: { features: { ...features, publicShares: { on: true, kids: true } } } });
  assert.equal((await json(app, 'POST', '/api/public-links', { token: tokens.kid, body })).status, 403, 'never kids');

  const made = await json(app, 'POST', '/api/public-links', { token: tokens.member, body: { ...body, days: 7 } });
  assert.equal(made.status, 200);
  assert.equal(made.body.link.cover, null, 'a cover with a login in it is dropped');
  assert.match(made.body.url, /\/s\/[\w-]{16}$/);
  const stored = (db.prepare('SELECT payload FROM public_links').get() as { payload: string }).payload;
  assert.ok(!stored.includes('secret') && !stored.includes('streamUrl'), 'only names are kept');

  const page = await app.inject({ method: 'GET', url: `/s/${made.body.link.token}` });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /Dreams/);
  assert.match(page.body, /Road trip &lt;script&gt;/, 'escaped');
  assert.match(page.body, /open\.spotify\.com\/search\/Fleetwood%20Mac%20Dreams/);
  assert.match(String(page.headers['content-security-policy']), /default-src 'none'/);

  const mine = await json(app, 'GET', '/api/public-links', { token: tokens.member });
  assert.equal(mine.body.links[0].views, 1);
  assert.equal(mine.body.links[0].songs, 2);

  assert.equal((await json(app, 'DELETE', `/api/public-links/${made.body.link.token}`, { token: tokens.kid })).status, 404, 'not theirs');
  assert.equal((await json(app, 'DELETE', `/api/public-links/${made.body.link.token}`, { token: tokens.member })).status, 200);
  assert.equal((await app.inject({ method: 'GET', url: `/s/${made.body.link.token}` })).statusCode, 404);

  // switching the feature off hides links that are still saved
  const again = await json(app, 'POST', '/api/public-links', { token: tokens.member, body: { kind: 'artist', title: 'Adele', cover: 'https://e-cdns-images.dzcdn.net/images/artist/x/500x500.jpg' } });
  assert.equal(again.body.link.cover, 'https://e-cdns-images.dzcdn.net/images/artist/x/500x500.jpg');
  assert.equal((await app.inject({ method: 'GET', url: `/s/${again.body.link.token}` })).statusCode, 200);
  await json(app, 'PUT', '/api/admin/features', { token: tokens.admin, body: { features: { publicShares: { on: false } } } });
  assert.equal((await app.inject({ method: 'GET', url: `/s/${again.body.link.token}` })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: '/s/../../etc' })).statusCode, 404);
});
