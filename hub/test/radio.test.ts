import assert from 'node:assert/strict';
import { createServer, type Server, type Socket } from 'node:net';
import { after, test } from 'node:test';
import { parseIcyMetadata as appParse, readIcyTitle as appRead } from '../../src/lib/icy.ts';
import { parseIcyMetadata, readStationTitle, StationTitles } from '../src/radio.ts';
import { json, seeded } from './helpers.ts';

const servers: Server[] = [];
after(() => servers.forEach((s) => s.close()));

/** One ICY metadata block: length byte, then the text padded with NULs to a multiple of 16. */
function block(text: string | Buffer) {
  const body = typeof text === 'string' ? Buffer.from(text, 'utf8') : text;
  const len = Math.ceil(body.length / 16);
  return Buffer.concat([Buffer.from([len]), body, Buffer.alloc(len * 16 - body.length)]);
}

/** A fake station: answers every connection with `reply(path)` and counts connections. */
async function station(reply: (path: string) => Buffer | string) {
  const seen: string[] = [];
  const srv = createServer((sock: Socket) => {
    let head = '';
    sock.on('data', (d) => {
      head += d.toString('latin1');
      if (!head.includes('\r\n\r\n')) return;
      seen.push(head);
      const path = head.split(' ')[1];
      const out = reply(path);
      // dribble it out in small pieces, as a real stream would arrive
      const buf = Buffer.from(out as Buffer);
      for (let i = 0; i < buf.length; i += 7) sock.write(buf.subarray(i, i + 7));
      sock.on('error', () => undefined);
    });
  });
  servers.push(srv);
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, seen };
}

const audio = (n: number) => Buffer.alloc(n, 0xff);
const icyStream = (status: string, metaint: number, title: string | Buffer) =>
  Buffer.concat([Buffer.from(`${status}\r\ncontent-type: audio/mpeg\r\nicy-metaint: ${metaint}\r\n\r\n`), audio(metaint), block(title), audio(500)]);

const CASES: [string, Buffer, string | undefined][] = [
  ['plain', block("StreamTitle='Daft Punk - One More Time';StreamUrl='';"), 'Daft Punk - One More Time'],
  ['apostrophe', block("StreamTitle='Zedd - Don't Let Me Go';StreamUrl='http://x';"), "Zedd - Don't Let Me Go"],
  ['last key', block("StreamTitle='Avicii - Levels';"), 'Avicii - Levels'],
  ['Latin-1', block(Buffer.concat([Buffer.from("StreamTitle='Beyonc"), Buffer.from([0xe9]), Buffer.from(" - Halo';")])), 'Beyoncé - Halo'],
  ['UTF-8', block("StreamTitle='Sigur Rós - Hoppípolla';"), 'Sigur Rós - Hoppípolla'],
  ['placeholder', block("StreamTitle=' - ';"), ''],
  ['unknown', block("StreamTitle='Unknown';"), ''],
  ['no title', block("StreamUrl='http://x';"), undefined],
];

test('ICY metadata blocks: the Hub and the app read titles the same way', async () => {
  for (const [name, b, want] of CASES) {
    const text = b.subarray(1);
    assert.equal(parseIcyMetadata(text), want, `hub: ${name}`);
    assert.equal(appParse(text), want, `app: ${name}`);
  }
});

test('the app reads the first title from a stream, in whatever pieces it arrives', async () => {
  const bytes = Buffer.concat([audio(100), block("StreamTitle='Deadmau5 - Strobe';"), audio(300)]);
  const stream = () =>
    new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < bytes.length; i += 9) c.enqueue(new Uint8Array(bytes.subarray(i, i + 9)));
      },
    });
  assert.equal(await appRead('100', stream()), 'Deadmau5 - Strobe');
  assert.equal(await appRead(null, stream()), undefined, 'no icy-metaint: no in-stream titles');
  assert.equal(await appRead('100', new ReadableStream({ start: (c) => c.enqueue(new Uint8Array(Buffer.concat([audio(100), Buffer.from([0])]))) })), '', 'empty block');
});

test('the Hub reads titles from HTTP and old "ICY 200 OK" stations, following redirects', async () => {
  const icecast = await station(() => icyStream('HTTP/1.0 200 OK', 64, "StreamTitle='Tiësto - Adagio for Strings';"));
  assert.deepEqual(await readStationTitle(`${icecast.url}/live`), { icy: true, title: 'Tiësto - Adagio for Strings' });
  assert.match(icecast.seen[0], /^GET \/live HTTP\/1\.0\r\n/);
  assert.match(icecast.seen[0], /Icy-MetaData: 1/);

  const shoutcast = await station(() => icyStream('ICY 200 OK', 8192, "StreamTitle='Eric Prydz - Opus';"));
  assert.deepEqual(await readStationTitle(`${shoutcast.url}/;`), { icy: true, title: 'Eric Prydz - Opus' });

  const moved = await station((p) => (p === '/old' ? `HTTP/1.1 302 Found\r\nLocation: ${shoutcast.url}/stream\r\n\r\n` : 'HTTP/1.1 404 Not Found\r\n\r\n'));
  assert.equal((await readStationTitle(`${moved.url}/old`)).title, 'Eric Prydz - Opus');
  await assert.rejects(readStationTitle(`${moved.url}/gone`), /answered 404/);

  const silent = await station(() => Buffer.concat([Buffer.from('HTTP/1.0 200 OK\r\ncontent-type: audio/mpeg\r\n\r\n'), audio(1000)]));
  assert.deepEqual(await readStationTitle(silent.url), { icy: false, title: '' }, 'no icy-metaint');

  await assert.rejects(readStationTitle('ftp://example.com/x'), /http/);
  await assert.rejects(readStationTitle('http://user:pw@example.com/x'), /http/);
});

test('GET /api/radio/now-playing: signed in only, one station read shared for 10 s', async () => {
  const fm = await station(() => icyStream('HTTP/1.0 200 OK', 32, "StreamTitle='Fred again.. - Delilah';"));
  const { app, tokens } = await seeded();
  const url = `/api/radio/now-playing?url=${encodeURIComponent(`${fm.url}/edm`)}`;
  assert.equal((await json(app, 'GET', url)).status, 401);
  const r = await json(app, 'GET', url, { token: tokens.kid });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { icy: true, title: 'Fred again.. - Delilah' });
  await json(app, 'GET', url, { token: tokens.member });
  assert.equal(fm.seen.length, 1, 'second ask comes from the cache');
  assert.equal((await json(app, 'GET', '/api/radio/now-playing?url=file%3A%2F%2F%2Fetc%2Fpasswd', { token: tokens.member })).status, 400);
  assert.equal((await json(app, 'GET', `/api/radio/now-playing?url=${encodeURIComponent('http://127.0.0.1:1/x')}`, { token: tokens.member })).status, 502);
});

test('StationTitles forgets a failed read so the next ask tries again', async () => {
  let calls = 0;
  const titles = new StationTitles(async () => {
    calls++;
    if (calls === 1) throw new Error('down');
    return { icy: true, title: 'x' };
  });
  await assert.rejects(titles.get('http://a'));
  await new Promise((r) => setImmediate(r));
  assert.equal((await titles.get('http://a')).title, 'x');
  assert.equal(calls, 2);
});
