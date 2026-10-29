import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { ART_APIS } from '../src/artwork.ts';
import { json, seeded } from './helpers.ts';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 2)]);

const servers: Server[] = [];
after(() => servers.forEach((s) => s.close()));

/** Stands in for Deezer, Apple, MusicBrainz, the Cover Art Archive and the image hosts. */
async function fakeApis() {
  const seen: string[] = [];
  let base = '';
  const srv = createServer((req, res) => {
    const url = req.url!;
    seen.push(url);
    const send = (body: unknown, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.startsWith('/deezer/search/album')) return send({ data: [{ title: 'Abbey Road', artist: { name: 'The Beatles' }, cover_medium: `${base}/img/dz-250.jpg`, cover_xl: `${base}/img/dz.jpg` }] });
    if (url.startsWith('/deezer/search/artist')) {
      return send({ data: [
        { name: 'The Beatles', nb_fan: 1000, picture_medium: `${base}/img/b-250.jpg`, picture_xl: `${base}/img/b.jpg` },
        { name: 'Nobody', picture_xl: 'https://e-cdns-images.dzcdn.net/images/artist//1000x1000-000000-80-0-0.jpg' },
      ] });
    }
    if (url.startsWith('/itunes/search')) return res.writeHead(503).end();
    if (url.startsWith('/mb/ws/2/release-group')) return send({ 'release-groups': [{ id: 'rg-1', title: 'Abbey Road', 'artist-credit': [{ name: 'The Beatles' }], 'first-release-date': '1969-09-26' }, { id: 'rg-2', title: 'Abbey Road (Live)' }] });
    if (url === '/caa/release-group/rg-1') return send({ images: [{ front: true, image: `${base}/img/caa.jpg`, thumbnails: { 250: `${base}/img/caa-250.jpg`, 1200: `${base}/img/caa-1200.jpg` } }] });
    if (url.startsWith('/caa/')) return send({}, 404);
    if (url === '/img/moved.jpg') return res.writeHead(302, { location: '/img/dz.jpg' }).end();
    if (url === '/img/page.html') return res.writeHead(200, { 'content-type': 'text/html' }).end('<html>not a picture</html>');
    if (url.startsWith('/img/')) return res.writeHead(200, { 'content-type': 'image/jpeg' }).end(JPEG);
    send({}, 404);
  });
  servers.push(srv);
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  Object.assign(ART_APIS, { deezer: `${base}/deezer`, itunes: `${base}/itunes`, musicbrainz: `${base}/mb`, caa: `${base}/caa`, fanart: `${base}/fanart` });
  return { base, seen };
}

test('an admin looks up album and artist art on several services', async () => {
  await fakeApis();
  const { app, tokens } = await seeded();
  const album = await json(app, 'GET', '/api/admin/artwork/search?kind=album&artist=The%20Beatles&album=Abbey%20Road', { token: tokens.admin });
  assert.equal(album.status, 200, JSON.stringify(album.body));
  assert.deepEqual(album.body.candidates.map((c: { source: string }) => c.source), ['Deezer', 'Cover Art Archive'], 'release groups without art are left out');
  assert.match(album.body.candidates[1].url, /caa-1200/);
  assert.deepEqual(album.body.failed, ['Apple Music'], 'a service that is down is named, not fatal');

  const artist = await json(app, 'GET', '/api/admin/artwork/search?kind=artist&artist=The%20Beatles', { token: tokens.admin });
  assert.equal(artist.body.candidates.length, 1, "Deezer's placeholder picture is skipped");
  assert.equal(artist.body.candidates[0].title, 'The Beatles');

  assert.equal((await json(app, 'GET', '/api/admin/artwork/search?kind=album&artist=x', { token: tokens.admin })).status, 400);
  assert.equal((await json(app, 'GET', '/api/admin/artwork/search?kind=artist&artist=x', { token: tokens.member })).status, 403);
});

test('picked art is saved on the Hub and served to every device', async () => {
  const { base } = await fakeApis();
  const dataDir = mkdtempSync(join(tmpdir(), 'wl-art-'));
  const { app, tokens } = await seeded({}, { dataDir });

  const set = await json(app, 'PUT', '/api/admin/artwork', { token: tokens.admin, body: { kind: 'album', artist: 'The Beatles', album: 'Abbey Road', url: `${base}/img/moved.jpg`, source: 'Deezer' } });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.artwork.source, 'Deezer');
  const url = set.body.artwork.url as string;
  assert.match(url, /^\/api\/art\/[0-9a-f]{32}\.jpg$/);

  // everyone signed in gets the list; the picture itself loads without a token (it's an <img>)
  const list = await json(app, 'GET', '/api/artwork', { token: tokens.kid });
  assert.equal(list.body.artwork[0].album, 'Abbey Road');
  assert.equal((await json(app, 'GET', '/api/artwork')).status, 401);
  const img = await app.inject({ method: 'GET', url });
  assert.equal(img.statusCode, 200);
  assert.equal(img.headers['content-type'], 'image/jpeg');
  assert.ok(img.rawPayload.equals(JPEG));
  assert.equal((await app.inject({ method: 'GET', url: '/api/art/..%2fhub.db' })).statusCode, 404);

  // an upload replaces it (names match case-insensitively) and the old file goes
  const up = await json(app, 'PUT', '/api/admin/artwork', { token: tokens.admin, body: { kind: 'album', artist: 'the beatles', album: 'ABBEY ROAD', image: `data:image/png;base64,${PNG.toString('base64')}` } });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.equal(up.body.artwork.source, 'upload');
  assert.match(up.body.artwork.url, /\.png$/);
  assert.equal((await json(app, 'GET', '/api/artwork', { token: tokens.admin })).body.artwork.length, 1);
  assert.deepEqual(readdirSync(join(dataDir, 'artwork')), [up.body.artwork.url.split('/').pop()]);

  // not a picture, nothing sent, not an admin
  assert.equal((await json(app, 'PUT', '/api/admin/artwork', { token: tokens.admin, body: { kind: 'artist', artist: 'X', url: `${base}/img/page.html` } })).status, 415);
  assert.equal((await json(app, 'PUT', '/api/admin/artwork', { token: tokens.admin, body: { kind: 'artist', artist: 'X', image: Buffer.from('hello').toString('base64') } })).status, 415);
  assert.equal((await json(app, 'PUT', '/api/admin/artwork', { token: tokens.admin, body: { kind: 'artist', artist: 'X' } })).status, 400);
  assert.equal((await json(app, 'PUT', '/api/admin/artwork', { token: tokens.admin, body: { kind: 'artist', artist: 'X', url: 'file:///etc/passwd' } })).status, 400);
  assert.equal((await json(app, 'PUT', '/api/admin/artwork', { token: tokens.member, body: { kind: 'artist', artist: 'X', url: `${base}/img/b.jpg` } })).status, 403);

  // back to the server's own
  const id = up.body.artwork.id;
  assert.equal((await json(app, 'DELETE', `/api/admin/artwork/${id}`, { token: tokens.admin })).status, 200);
  assert.equal((await json(app, 'GET', '/api/artwork', { token: tokens.admin })).body.artwork.length, 0);
  assert.ok(!existsSync(join(dataDir, 'artwork', up.body.artwork.url.split('/').pop())));

  const log = JSON.stringify((await json(app, 'GET', '/api/admin/audit', { token: tokens.admin })).body);
  assert.ok(log.includes('artwork.set') && log.includes('artwork.reset') && log.includes('Abbey Road'));
});
