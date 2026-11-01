import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DjRequest, DjResponse, ProviderFactory } from '../src/dj/provider.ts';
import { parseJson } from '../src/dj/station.ts';
import type { MixLookups } from '../src/mixes.ts';
import { json, seeded } from './helpers.ts';

const DAY = 86_400_000;
const look: MixLookups = {
  related: async (a) => (a === 'Drake' ? ['Future', 'Rihanna'] : a === 'Future' ? ['Drake', 'Travis'] : []),
  top: async (a) => [{ title: `${a} hit`, artist: a }, { title: `${a} deep cut`, artist: a }, { title: `${a} single`, artist: a }],
};

function scripted(answer: (req: DjRequest) => string) {
  const seen: DjRequest[] = [];
  const factory: ProviderFactory = (settings) => ({
    async create(req) {
      seen.push(structuredClone(req));
      return { content: [{ type: 'text', text: answer(req), citations: null }] as DjResponse['content'], stopReason: 'end_turn', model: settings.model, usage: { input: 500, output: 50, cacheRead: 0, cacheWrite: 0 } };
    },
    async test() {
      return 'ok';
    },
  });
  return { factory, seen };
}

test('DJ mode: segments from mixes and the charts, an intro each, requests picked by the AI', async () => {
  const ai = scripted((req) => {
    const ask = String(req.messages[0].content);
    if (ask.includes('The listener asked')) return 'Sure! ```json\n{"title": "Kitchen grooves", "intro": "Something **smooth** for the cooking.", "songs": [{"title": "Two", "artist": "Drake"}, {"title": "Not Mine", "artist": "Someone"}, {"title": "Two", "artist": "drake"}]}\n```';
    return 'Here come your favourites, Sam.';
  });
  const chart = async (kid: boolean) => [
    { title: 'Chart One', artist: 'Popstar' },
    { title: 'Chart Two', artist: 'Popstar' },
    { title: 'Chart Three', artist: 'Band' },
    ...(kid ? [] : [{ title: 'Chart Rude', artist: 'Rapper' }]),
  ];
  const { app, db, tokens, ids } = await seeded({}, {}, { djProvider: ai.factory, mixLookups: look, stationChart: chart });
  await json(app, 'PUT', '/api/admin/dj', { token: tokens.admin, body: { enabled: true, apiKey: 'sk-ant-x' } });
  await json(app, 'PUT', `/api/admin/dj/users/${ids.member}`, { token: tokens.admin, body: { enabled: true, monthlyLimit: null } });
  const station = (body: unknown) => json(app, 'POST', '/api/dj/station', { token: tokens.member, body });

  assert.equal((await station({})).status, 403, 'off until the DJ mode feature is on');
  await json(app, 'PUT', '/api/admin/features', { token: tokens.admin, body: { features: { djMode: { on: true } } } });

  // no plays yet: favourites, new for you and throwbacks are empty, so it moves on to the charts
  let r = await station({ kind: 'favourites', talk: false });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.kind, 'tophits');
  assert.equal(r.body.intro, null, 'no intro when the app says not to talk');
  assert.deepEqual(r.body.songs.map((s: any) => s.title), ['Chart One', 'Chart Two', 'Chart Three', 'Chart Rude']);
  assert.equal(ai.seen.length, 0, 'picking songs costs nothing');

  const play = db.prepare('INSERT INTO plays (user_id, played_at, title, artist, album, seconds, track) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const now = Date.now();
  let n = 0;
  for (let i = 0; i < 4; i++) for (const [t, a] of [['One', 'Drake'], ['Two', 'Drake'], ['Three', 'Future'], ['Four', 'Future'], ['Five', 'Drake'], ['Six', 'Future']]) play.run(ids.member, now - DAY - ++n * 60_000, t, a, 'Al', 200, '{}');
  for (let i = 0; i < 5; i++) for (const t of ['Old A', 'Old B', 'Old C', 'Old D', 'Old E', 'Old F']) play.run(ids.member, now - 400 * DAY + ++n * 60_000, t, 'Oldies', 'Al', 200, '{}');

  db.prepare('DELETE FROM mixes').run(); // the next day's mixes
  r = await station({ kind: 'favourites', name: 'Sam', recent: [{ title: 'One', artist: 'Drake' }] });
  assert.equal(r.body.kind, 'favourites');
  assert.equal(r.body.title, 'Your favourites');
  assert.equal(r.body.intro, 'Here come your favourites, Sam.');
  const titles = r.body.songs.map((s: any) => s.title);
  assert.ok(titles.includes('Two') && !titles.includes('One'), `recent songs are left out: ${titles}`);
  assert.match(String(ai.seen.at(-1)!.messages[0].content), /Your favourites/);
  assert.match(ai.seen.at(-1)!.system, /Sam/);
  assert.equal(ai.seen.at(-1)!.tools.length, 0);

  // the rotation: after favourites comes "new for you", then throwbacks
  r = await station({ previous: 'favourites', talk: false });
  assert.equal(r.body.kind, 'discover');
  assert.ok(r.body.songs.some((s: any) => ['Rihanna', 'Travis'].includes(s.artist)), 'artists like theirs');
  assert.ok(r.body.songs.every((s: any) => !['One', 'Two', 'Three', 'Four', 'Five', 'Six'].includes(s.title)), 'nothing they play a lot');
  r = await station({ previous: 'discover', talk: false });
  assert.equal(r.body.kind, 'throwbacks');
  assert.ok(r.body.songs.every((s: any) => s.artist === 'Oldies'));

  // a request: the AI picks from what they play (and a few it knows), deduped, its intro cleaned up for the voice
  r = await station({ ask: 'something chill for cooking' });
  assert.equal(r.body.kind, 'ask');
  assert.equal(r.body.title, 'Kitchen grooves');
  assert.equal(r.body.intro, 'Something smooth for the cooking.');
  assert.deepEqual(r.body.songs, [{ title: 'Two', artist: 'Drake' }, { title: 'Not Mine', artist: 'Someone' }]);
  assert.match(String(ai.seen.at(-1)!.messages[0].content), /Two — Drake/);
  assert.ok(r.body.spent > 0, 'counted against the allowance');

  // kids: the DJ has to be on for them, and the chart drops explicit songs
  await json(app, 'PUT', '/api/admin/features', { token: tokens.admin, body: { features: { djMode: { kids: true } } } });
  await json(app, 'PUT', `/api/admin/dj/users/${ids.kid}`, { token: tokens.admin, body: { enabled: true } });
  const k = await json(app, 'POST', '/api/dj/station', { token: tokens.kid, body: { kind: 'tophits', talk: false } });
  assert.equal(k.status, 200, JSON.stringify(k.body));
  assert.deepEqual(k.body.songs.map((s: any) => s.title), ['Chart One', 'Chart Two', 'Chart Three']);
});

test('DJ mode: reads JSON out of chatty answers', () => {
  assert.deepEqual(parseJson('Here you go:\n{"a": 1}\nEnjoy'), { a: 1 });
  assert.equal(parseJson('no json here'), null);
  assert.equal(parseJson('{broken'), null);
});
