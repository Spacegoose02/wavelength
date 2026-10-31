import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DjRequest, DjResponse, ProviderFactory } from '../src/dj/provider.ts';
import { json, seeded } from './helpers.ts';

/** A provider that answers from a script and remembers what it was sent. */
function scripted(steps: ((req: DjRequest) => Partial<DjResponse>)[]) {
  const seen: { req: DjRequest; apiKey: string; model: string }[] = [];
  let i = 0;
  const factory: ProviderFactory = (settings, apiKey) => ({
    async create(req) {
      seen.push({ req: structuredClone(req), apiKey, model: settings.model });
      const step = steps[i++];
      if (!step) throw new Error('script ran out');
      return { content: [], stopReason: 'end_turn', model: settings.model, usage: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 }, ...step(req) };
    },
    async test() {
      return `ok ${settings.model}`;
    },
  });
  return { factory, seen };
}

const text = (t: string) => ({ content: [{ type: 'text', text: t, citations: null }] as DjResponse['content'] });
const toolUse = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input, caller: { type: 'direct' } }) as unknown as DjResponse['content'][number];

test('AI DJ: off by default, on per account, kids only when switched on', async () => {
  const { app, tokens, ids } = await seeded({}, {}, { djProvider: scripted([]).factory });
  let me = await json(app, 'GET', '/api/dj', { token: tokens.member });
  assert.equal(me.body.available, false);
  assert.match(me.body.reason, /turned off/);
  assert.equal((await json(app, 'POST', '/api/dj/chat', { token: tokens.member, body: { message: 'hi' } })).status, 403);

  // the key is kept sealed and never shown back
  const saved = await json(app, 'PUT', '/api/admin/dj', { token: tokens.admin, body: { enabled: true, apiKey: 'sk-ant-secret-1234', model: 'claude-sonnet-5-5' } });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.key, { set: true, hint: '…1234', unreadable: false });
  assert.ok(!JSON.stringify(saved.body).includes('sk-ant-secret'), 'the key never leaves the Hub');
  assert.equal(saved.body.settings.model, 'claude-sonnet-5-5');
  assert.equal(saved.body.price.input, 2);

  me = await json(app, 'GET', '/api/dj', { token: tokens.member });
  assert.equal(me.body.available, false, 'still off for the account');
  assert.match(me.body.reason, /your account/);

  const on = await json(app, 'PUT', `/api/admin/dj/users/${ids.member}`, { token: tokens.admin, body: { enabled: true } });
  assert.deepEqual(on.body.access, { enabled: true, monthlyLimit: 5 }, 'gets the default limit');
  assert.equal((await json(app, 'GET', '/api/dj', { token: tokens.member })).body.available, true);
  assert.equal((await json(app, 'GET', '/api/dj', { token: tokens.kid })).body.available, false, 'kids stay off');

  await json(app, 'PUT', `/api/admin/dj/users/${ids.kid}`, { token: tokens.admin, body: { enabled: true, monthlyLimit: null } });
  assert.equal((await json(app, 'GET', '/api/dj', { token: tokens.kid })).body.available, true);

  assert.equal((await json(app, 'PUT', '/api/admin/dj', { token: tokens.admin, body: { effort: 'turbo' } })).status, 400);
  assert.equal((await json(app, 'PUT', '/api/admin/dj', { token: tokens.member, body: { enabled: false } })).status, 403);
  assert.equal((await json(app, 'POST', '/api/admin/dj/test', { token: tokens.admin, body: {} })).body.message, 'ok claude-sonnet-5-5');

  // removing the key stops it
  await json(app, 'PUT', '/api/admin/dj', { token: tokens.admin, body: { apiKey: '' } });
  assert.match((await json(app, 'GET', '/api/dj', { token: tokens.member })).body.reason, /no API key/);
});

test('AI DJ: app tools go to the app, Hub tools run on the Hub, costs are counted', async () => {
  const script = scripted([
    () => ({
      stopReason: 'tool_use',
      content: [
        { type: 'text', text: 'Let me look.', citations: null } as DjResponse['content'][number],
        toolUse('tu_1', 'search_library', { query: 'Fleetwood Mac' }),
        toolUse('tu_2', 'listening_stats', { period: 'month' }),
      ],
    }),
    (req) => {
      const last = req.messages[req.messages.length - 1];
      assert.equal(last.role, 'user');
      const results = last.content as { tool_use_id: string; content: string; is_error?: boolean }[];
      assert.deepEqual(results.map((r) => r.tool_use_id), ['tu_1', 'tu_2'], 'results in the order the model asked');
      assert.match(results[0].content, /Dreams/);
      assert.match(results[1].content, /topArtists/);
      return { stopReason: 'tool_use', content: [toolUse('tu_3', 'play', { refs: ['t1'], mode: 'now' })] };
    },
    () => ({ ...text('Playing Dreams.'), usage: { input: 200, output: 20, cacheRead: 3000, cacheWrite: 0 } }),
    () => text('Second message answered.'),
  ]);
  const { app, tokens, ids, db } = await seeded({}, {}, { djProvider: script.factory });
  await json(app, 'PUT', '/api/admin/dj', { token: tokens.admin, body: { enabled: true, apiKey: 'sk-ant-xyz9' } });
  await json(app, 'PUT', `/api/admin/dj/users/${ids.member}`, { token: tokens.admin, body: { enabled: true } });

  let r = await json(app, 'POST', '/api/dj/chat', { token: tokens.member, body: { message: 'Play some Fleetwood Mac' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'tools');
  assert.deepEqual(r.body.calls, [{ id: 'tu_1', name: 'search_library', input: { query: 'Fleetwood Mac' } }], 'only the app tool goes to the app');
  assert.equal(r.body.reply, 'Let me look.');
  const chatId = r.body.chat.id;
  assert.equal(r.body.chat.title, 'Play some Fleetwood Mac');
  assert.equal(script.seen[0].apiKey, 'sk-ant-xyz9');
  assert.equal(script.seen[0].model, 'claude-opus-5-5', 'Opus 5.5 by default');

  assert.equal((await json(app, 'POST', '/api/dj/chat', { token: tokens.member, body: { chatId, message: 'hurry' } })).status, 409, 'waiting for the app');
  assert.equal((await json(app, 'GET', `/api/dj/chats/${chatId}`, { token: tokens.admin })).status, 403, 'not switched on for the admin');

  r = await json(app, 'POST', `/api/dj/chats/${chatId}/tools`, { token: tokens.member, body: { results: [{ id: 'tu_1', content: '{"tracks":[{"ref":"t1","title":"Dreams"}]}' }, { id: 'nope', content: 'x' }] } });
  assert.equal(r.body.status, 'tools');
  assert.equal(r.body.calls[0].name, 'play');
  r = await json(app, 'POST', `/api/dj/chats/${chatId}/tools`, { token: tokens.member, body: { results: [{ id: 'tu_3', content: 'Playing 1 song' }] } });
  assert.equal(r.body.status, 'done');
  assert.equal(r.body.reply, 'Let me look.\n\nPlaying Dreams.');

  // 3 calls on Opus 5.5 ($4 in, $20 out, $0.20 cache read per million)
  const expected = (1000 * 4 + 500 * 20) * 2 / 1e6 + (200 * 4 + 20 * 20 + 3000 * 0.2) / 1e6;
  assert.ok(Math.abs(r.body.spent - expected) < 1e-9, `spent ${r.body.spent}`);
  assert.equal(r.body.limit, 5);

  const chat = await json(app, 'GET', `/api/dj/chats/${chatId}`, { token: tokens.member });
  assert.deepEqual(chat.body.messages, [
    { role: 'user', text: 'Play some Fleetwood Mac' },
    { role: 'assistant', text: 'Let me look.\n\nPlaying Dreams.', tools: ['search_library', 'listening_stats', 'play'] },
  ]);
  assert.equal(chat.body.calls, null);

  r = await json(app, 'POST', '/api/dj/chat', { token: tokens.member, body: { chatId, message: 'thanks' } });
  assert.equal(r.body.reply, 'Second message answered.');
  const sent = script.seen[3].req.messages;
  assert.equal(sent.length, 7, 'the whole chat goes back, appended to');
  assert.deepEqual(sent[1], script.seen[1].req.messages[1], 'earlier turns unchanged');

  // someone else can't see it
  await json(app, 'PUT', `/api/admin/dj/users/${ids.admin}`, { token: tokens.admin, body: { enabled: true } });
  assert.equal((await json(app, 'GET', `/api/dj/chats/${chatId}`, { token: tokens.admin })).status, 404);

  const admin = await json(app, 'GET', '/api/admin/dj', { token: tokens.admin });
  const mia = admin.body.users.find((u: { id: number }) => u.id === ids.member);
  assert.equal(mia.calls, 4);
  assert.ok(mia.spent > 0);
  assert.equal(admin.body.month.byModel[0].model, 'claude-opus-5-5');

  // the monthly limit stops the next message
  await json(app, 'PUT', `/api/admin/dj/users/${ids.member}`, { token: tokens.admin, body: { monthlyLimit: 0.01 } });
  const over = await json(app, 'POST', '/api/dj/chat', { token: tokens.member, body: { message: 'more' } });
  assert.equal(over.status, 402);
  assert.match(over.body.error, /allowance/);
  // and the household limit
  await json(app, 'PUT', `/api/admin/dj/users/${ids.member}`, { token: tokens.admin, body: { monthlyLimit: null } });
  await json(app, 'PUT', '/api/admin/dj', { token: tokens.admin, body: { householdLimit: 0.01 } });
  assert.equal((await json(app, 'POST', '/api/dj/chat', { token: tokens.member, body: { message: 'more' } })).status, 402);

  assert.equal((await json(app, 'DELETE', `/api/dj/chats/${chatId}`, { token: tokens.member })).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM dj_conversations').get()!.n, 0, 'refused messages make no chat');
});

test('AI DJ: download requests go through the normal request queue', async () => {
  const script = scripted([
    () => ({ stopReason: 'tool_use', content: [toolUse('tu_1', 'request_download', { link: 'https://www.deezer.com/album/302127', kind: 'album', title: 'Discovery', artist: 'Daft Punk' })] }),
    (req) => {
      const res = (req.messages[req.messages.length - 1].content as { content: string }[])[0];
      assert.match(res.content, /pending/);
      return text('Asked for Discovery.');
    },
    () => ({ stopReason: 'tool_use', content: [toolUse('tu_2', 'request_download', { link: 'https://evil.example/x', kind: 'album', title: 'x', artist: 'y' })] }),
    (req) => {
      const res = (req.messages[req.messages.length - 1].content as { content: string; is_error?: boolean }[])[0];
      assert.equal(res.is_error, true, 'only Deezer links');
      return text('That link won’t work.');
    },
  ]);
  const { app, tokens, ids } = await seeded({}, {}, { djProvider: script.factory });
  await json(app, 'PUT', '/api/admin/dj', { token: tokens.admin, body: { enabled: true, apiKey: 'k' } });
  await json(app, 'PUT', `/api/admin/dj/users/${ids.kid}`, { token: tokens.admin, body: { enabled: true } });
  const r = await json(app, 'POST', '/api/dj/chat', { token: tokens.kid, body: { message: 'Get Discovery by Daft Punk' } });
  assert.equal(r.body.reply, 'Asked for Discovery.');
  assert.match(script.seen[0].req.system, /child/, 'kids get the family-friendly rules');
  const queue = await json(app, 'GET', '/api/admin/requests', { token: tokens.admin });
  assert.equal(queue.body.requests[0].title, 'Discovery');
  assert.equal(queue.body.requests[0].status, 'pending', 'waits for approval');
  assert.equal(queue.body.requests[0].note, 'Asked for through the AI DJ');
  await json(app, 'POST', '/api/dj/chat', { token: tokens.kid, body: { chatId: r.body.chat.id, message: 'and this' } });
});

test('AI DJ: a provider error leaves the chat usable', async () => {
  let fail = true;
  const factory: ProviderFactory = (settings) => ({
    async create() {
      if (fail) {
        fail = false;
        throw Object.assign(new Error('The AI provider is busy (rate limit). Try again in a minute'), { statusCode: 429 });
      }
      return { content: text('Back now.').content, stopReason: 'end_turn', model: settings.model, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } };
    },
    async test() {
      return '';
    },
  });
  const { app, tokens, ids } = await seeded({}, {}, { djProvider: factory });
  await json(app, 'PUT', '/api/admin/dj', { token: tokens.admin, body: { enabled: true, apiKey: 'k' } });
  await json(app, 'PUT', `/api/admin/dj/users/${ids.member}`, { token: tokens.admin, body: { enabled: true } });
  const first = await json(app, 'POST', '/api/dj/chat', { token: tokens.member, body: { message: 'hello' } });
  assert.equal(first.status, 429);
  const chats = (await json(app, 'GET', '/api/dj/chats', { token: tokens.member })).body.chats;
  const again = await json(app, 'POST', '/api/dj/chat', { token: tokens.member, body: { chatId: chats[0].id, message: 'hello?' } });
  assert.equal(again.body.reply, 'Back now.');
});
