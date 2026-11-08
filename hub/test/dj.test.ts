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

test('AI DJ: web search is off until turned on, kids only with their own switch, searches are counted', async () => {
  const script = scripted([
    (req) => {
      assert.equal(req.web, undefined, 'off by default');
      assert.match(req.system, /can’t browse the web/);
      return text('Paste the list.');
    },
    (req) => {
      assert.deepEqual(req.web, { maxSearches: 2 });
      assert.match(req.system, /web_search/);
      return {
        content: [
          { type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: { query: 'top EDM hits' } },
          { type: 'web_search_tool_result', tool_use_id: 'srv_1', content: [] },
          { type: 'text', text: 'Here are this week’s top EDM hits.', citations: null },
        ] as unknown as DjResponse['content'],
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, webSearches: 2 },
      };
    },
    (req) => {
      assert.equal(req.web, undefined, 'kids stay off');
      return text('ok');
    },
    (req) => {
      assert.deepEqual(req.web, { maxSearches: 2 });
      return text('ok');
    },
  ]);
  const { app, tokens, ids } = await seeded({}, {}, { djProvider: script.factory });
  await json(app, 'PUT', '/api/admin/dj', { token: tokens.admin, body: { enabled: true, apiKey: 'k' } });
  for (const who of ['member', 'kid'] as const) await json(app, 'PUT', `/api/admin/dj/users/${ids[who]}`, { token: tokens.admin, body: { enabled: true, monthlyLimit: null } });

  await json(app, 'POST', '/api/dj/chat', { token: tokens.member, body: { message: 'top EDM hits?' } });
  assert.equal((await json(app, 'PUT', '/api/admin/dj', { token: tokens.admin, body: { webMaxSearches: 50 } })).status, 400);
  assert.equal((await json(app, 'PUT', '/api/admin/dj', { token: tokens.admin, body: { webMaxSearches: 2 } })).status, 200);
  assert.equal((await json(app, 'GET', '/api/dj', { token: tokens.member })).body.web, false, 'the cap alone doesn’t turn it on');
  const features = (await json(app, 'GET', '/api/admin/features', { token: tokens.admin })).body.features;
  assert.deepEqual(features.djWeb, { on: false, kids: false });
  await json(app, 'PUT', '/api/admin/features', { token: tokens.admin, body: { features: { djWeb: { on: true } } } });
  assert.equal((await json(app, 'GET', '/api/dj', { token: tokens.member })).body.web, true);
  assert.equal((await json(app, 'GET', '/api/dj', { token: tokens.kid })).body.web, false);

  const r = await json(app, 'POST', '/api/dj/chat', { token: tokens.member, body: { message: 'top EDM hits?' } });
  assert.equal(r.body.reply, 'Here are this week’s top EDM hits.');
  const chat = await json(app, 'GET', `/api/dj/chats/${r.body.chat.id}`, { token: tokens.member });
  assert.deepEqual(chat.body.messages[1].tools, ['web_search'], 'web searches show in the chat');
  // first call: 1000 in, 500 out on Opus 5.5; second: 2 searches at $10 per 1,000
  assert.ok(Math.abs(r.body.spent - ((1000 * 4 + 500 * 20) / 1e6 + 0.02)) < 1e-9, `spent ${r.body.spent}`);

  await json(app, 'POST', '/api/dj/chat', { token: tokens.kid, body: { message: 'hi' } });
  await json(app, 'PUT', '/api/admin/features', { token: tokens.admin, body: { features: { djWeb: { kids: true } } } });
  await json(app, 'POST', '/api/dj/chat', { token: tokens.kid, body: { message: 'hi' } });
});

test('AI DJ: the talking DJ writes a short link between songs, only with the switch on', async () => {
  const script = scripted([(req) => {
    assert.equal(req.tools.length, 0);
    assert.equal(req.effort, 'low');
    assert.match(String(req.messages[0].content), /That was "Dreams" by Fleetwood Mac.*Coming up: "Hey Jude" by The Beatles/);
    return text('That was **Dreams**. Here is Hey Jude, Sam.');
  }]);
  const { app, tokens, ids, db } = await seeded({}, {}, { djProvider: script.factory });
  await json(app, 'PUT', '/api/admin/dj', { token: tokens.admin, body: { enabled: true, apiKey: 'sk-ant-x-1234' } });
  await json(app, 'PUT', `/api/admin/dj/users/${ids.member}`, { token: tokens.admin, body: { enabled: true } });
  const body = { previous: { title: 'Dreams', artist: 'Fleetwood Mac' }, next: { title: 'Hey Jude', artist: 'The Beatles' }, name: 'Sam' };

  const off = await json(app, 'POST', '/api/dj/patter', { token: tokens.member, body });
  assert.equal(off.status, 403, 'the talking DJ is off until an admin turns it on');
  assert.equal(off.body.feature, 'djVoice');

  const features = (await json(app, 'GET', '/api/admin/features', { token: tokens.admin })).body.features;
  await json(app, 'PUT', '/api/admin/features', { token: tokens.admin, body: { features: { ...features, djVoice: { on: true, kids: false } } } });
  assert.equal((await json(app, 'POST', '/api/dj/patter', { token: tokens.member, body: { next: {} } })).status, 400);
  const r = await json(app, 'POST', '/api/dj/patter', { token: tokens.member, body });
  assert.equal(r.status, 200);
  assert.equal(r.body.text, 'That was Dreams. Here is Hey Jude, Sam.');
  assert.ok(r.body.spent > 0, 'counted against the allowance');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM dj_usage WHERE conversation_id IS NULL').get() as { n: number }).n, 1);
});

test('Talking DJ voices: device by default, Kokoro and OpenAI on the Hub, OpenAI counted, keys never shown', async () => {
  const calls: { url: string; body: Record<string, unknown> | null; auth: string | null }[] = [];
  const ttsFetch = async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null, auth: headers.get('authorization') });
    if (url.endsWith('/v1/audio/voices')) return Response.json({ voices: [{ id: 'am_michael', name: 'am_michael' }, 'af_heart', { id: 'bad name!' }], default_voice: 'af_heart' });
    if (url.includes('kokoro-down')) throw new TypeError('fetch failed');
    return new Response(new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } });
  };
  const { app, tokens, ids, db } = await seeded({}, {}, { djProvider: scripted([]).factory, ttsFetch });
  await json(app, 'PUT', '/api/admin/dj', { token: tokens.admin, body: { enabled: true, apiKey: 'sk-ant-x-1234' } });
  await json(app, 'PUT', `/api/admin/dj/users/${ids.member}`, { token: tokens.admin, body: { enabled: true, monthlyLimit: null } });
  const speak = (body: unknown) => app.inject({ method: 'POST', url: '/api/dj/speak', headers: { authorization: `Bearer ${tokens.member}` }, payload: body as object });

  assert.equal((await json(app, 'GET', '/api/dj/voice', { token: tokens.member })).status, 403, 'needs the talking DJ feature');
  await json(app, 'PUT', '/api/admin/features', { token: tokens.admin, body: { features: { djVoice: { on: true } } } });
  assert.deepEqual((await json(app, 'GET', '/api/dj/voice', { token: tokens.member })).body, { engine: 'device', voices: [], default: '' });
  assert.equal((await speak({ text: 'hi' })).statusCode, 409, 'no Hub voice until an admin picks one');

  // Kokoro: the list comes from its container, the speech from its OpenAI-style endpoint
  assert.equal((await json(app, 'PUT', '/api/admin/dj', { token: tokens.admin, body: { voice: { engine: 'robot' } } })).status, 400);
  await json(app, 'PUT', '/api/admin/dj', { token: tokens.admin, body: { voice: { engine: 'kokoro', kokoroUrl: 'http://kokoro:8880/' } } });
  const info = (await json(app, 'GET', '/api/dj/voice', { token: tokens.member })).body;
  assert.deepEqual(info, { engine: 'kokoro', voices: ['af_heart', 'am_michael'], default: 'am_michael' });
  const r = await speak({ text: '  That was Dreams.  Here is Hey Jude. ', voice: 'af_heart', speed: 3, style: 'hype' });
  assert.equal(r.statusCode, 200);
  assert.match(String(r.headers['content-type']), /audio\/mpeg/);
  assert.equal(r.rawPayload.length, 6);
  assert.deepEqual(calls.at(-1), { url: 'http://kokoro:8880/v1/audio/speech', auth: null, body: { model: 'kokoro', input: 'That was Dreams. Here is Hey Jude.', voice: 'af_heart', response_format: 'mp3', speed: 1.4, stream: false } });
  assert.equal((await speak({ text: 'x'.repeat(601) })).statusCode, 400);
  await json(app, 'PUT', '/api/admin/dj', { token: tokens.admin, body: { voice: { kokoroUrl: 'http://kokoro-down:8880' } } });
  const down = await speak({ text: 'hi' });
  assert.equal(down.statusCode, 502);
  assert.match(down.json().error, /Kokoro can’t be reached.*container running/);

  // OpenAI: needs its own key, sends the DJ style, and is billed per character
  await json(app, 'PUT', '/api/admin/dj', { token: tokens.admin, body: { voice: { engine: 'openai', openaiVoice: 'coral' } } });
  assert.equal((await speak({ text: 'hi' })).statusCode, 409);
  const saved = await json(app, 'PUT', '/api/admin/dj', { token: tokens.admin, body: { openaiKey: 'sk-openai-secret-9876' } });
  assert.deepEqual(saved.body.openaiKey, { set: true, hint: '…9876', unreadable: false });
  assert.ok(!JSON.stringify(saved.body).includes('sk-openai-secret'), 'the OpenAI key never leaves the Hub');
  const line = 'Here comes the drop, Sam!';
  assert.equal((await speak({ text: line, voice: 'not-a-voice', style: 'hype' })).statusCode, 200);
  const sent = calls.at(-1)!;
  assert.equal(sent.url, 'https://api.openai.com/v1/audio/speech');
  assert.equal(sent.auth, 'Bearer sk-openai-secret-9876');
  assert.equal(sent.body?.voice, 'coral', 'an unknown voice falls back to the admin’s pick');
  assert.equal(sent.body?.model, 'gpt-4o-mini-tts');
  assert.match(String(sent.body?.instructions), /high-energy/);
  const usage = db.prepare("SELECT model, cost FROM dj_usage WHERE user_id = ? AND model LIKE 'openai:%'").all(ids.member) as { model: string; cost: number }[];
  assert.deepEqual(usage.map((u) => ({ ...u })), [{ model: 'openai:gpt-4o-mini-tts', cost: (line.length * 15) / 1e6 }]);

  // admins can hear it without spending anyone's allowance; listeners can't use the admin route
  const test = await app.inject({ method: 'POST', url: '/api/admin/dj/voice/test', headers: { authorization: `Bearer ${tokens.admin}` }, payload: { voice: 'nova' } });
  assert.equal(test.statusCode, 200);
  assert.equal(calls.at(-1)?.body?.voice, 'nova');
  assert.equal((await json(app, 'POST', '/api/admin/dj/voice/test', { token: tokens.member, body: {} })).status, 403);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM dj_usage WHERE model LIKE 'openai:%'").get() as { n: number }).n, 1);
});

test('Lyrics translation: one call per song and language for the house, line for line', async () => {
  const script = scripted([
    (req) => {
      assert.match(req.system, /into English/);
      assert.deepEqual(JSON.parse(String(req.messages[0].content)), ['Hola', '', 'Te quiero']);
      return text('```json\n["Hello", "", "I love you"]\n```');
    },
    () => text('["just one"]'), // wrong number of lines
    (req) => {
      assert.match(req.system, /romanize/);
      return text('["annyeong", "", "saranghae"]');
    },
  ]);
  const { app, tokens, ids } = await seeded({}, {}, { djProvider: script.factory });
  await json(app, 'PUT', '/api/admin/dj', { token: tokens.admin, body: { enabled: true, apiKey: 'sk-ant-x-1234' } });
  for (const id of [ids.member, ids.admin]) await json(app, 'PUT', `/api/admin/dj/users/${id}`, { token: tokens.admin, body: { enabled: true } });
  const ask = (token: string, body: object) => json(app, 'POST', '/api/lyrics/translate', { token, body });
  const body = { key: 'artist|song|180', lines: ['Hola', '', 'Te quiero'], mode: 'translate', to: 'English' };

  const r = await ask(tokens.member, body);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.lines, ['Hello', '', 'I love you']);
  assert.equal(r.body.cached, false);
  // someone else in the house gets it free
  const again = await ask(tokens.admin, body);
  assert.deepEqual([again.body.lines[2], again.body.cached], ['I love you', true]);
  assert.equal(script.seen.length, 1);

  assert.equal((await ask(tokens.member, { ...body, key: 'other' })).status, 502);
  assert.deepEqual((await ask(tokens.member, { ...body, key: 'k2', mode: 'romanize', lines: ['안녕', '', '사랑해'] })).body.lines, ['annyeong', '', 'saranghae']);
  assert.equal((await ask(tokens.member, { ...body, to: '' })).status, 400);
  assert.equal((await ask(tokens.member, { key: 'x', lines: [] })).status, 400);

  const features = (await json(app, 'GET', '/api/admin/features', { token: tokens.admin })).body.features;
  await json(app, 'PUT', '/api/admin/features', { token: tokens.admin, body: { features: { ...features, lyricsTranslate: { on: false, kids: false } } } });
  assert.equal((await ask(tokens.member, body)).status, 403);
});

test('voice requests: the Hub turns a recording into words with Whisper or OpenAI', async () => {
  const calls: { url: string; model: string | null; auth: string | null; file: number }[] = [];
  const ttsFetch = async (url: string, init?: RequestInit) => {
    const f = init?.body as FormData;
    const file = f?.get?.('file') as Blob | null;
    calls.push({ url, model: (f?.get?.('model') as string) ?? null, auth: new Headers(init?.headers).get('authorization'), file: file ? file.size : 0 });
    if (url.includes('whisper-down')) throw new TypeError('fetch failed');
    return Response.json({ text: '  play   something for a road trip ' });
  };
  const { app, tokens, ids } = await seeded({}, {}, { djProvider: scripted([]).factory, ttsFetch });
  await json(app, 'PUT', '/api/admin/dj', { token: tokens.admin, body: { enabled: true, apiKey: 'sk-ant-x-1234' } });
  await json(app, 'PUT', `/api/admin/dj/users/${ids.member}`, { token: tokens.admin, body: { enabled: true, monthlyLimit: null } });
  const listen = (seconds = 3) => app.inject({ method: 'POST', url: `/api/dj/listen?seconds=${seconds}`, headers: { authorization: `Bearer ${tokens.member}`, 'content-type': 'audio/webm;codecs=opus' }, payload: Buffer.from([1, 2, 3, 4]) });

  assert.deepEqual((await json(app, 'GET', '/api/dj/listen', { token: tokens.member })).body, { engine: 'device' });
  assert.equal((await listen()).statusCode, 409, 'the device listens until an admin picks Whisper or OpenAI');

  assert.equal((await json(app, 'PUT', '/api/admin/dj', { token: tokens.admin, body: { voice: { listen: 'ears' } } })).status, 400);
  await json(app, 'PUT', '/api/admin/dj', { token: tokens.admin, body: { voice: { listen: 'whisper', whisperUrl: 'http://whisper:8000/' } } });
  const r = await listen();
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { text: 'play something for a road trip' });
  assert.deepEqual(calls.at(-1), { url: 'http://whisper:8000/v1/audio/transcriptions', model: 'Systran/faster-whisper-small', auth: null, file: 4 });

  await json(app, 'PUT', '/api/admin/dj', { token: tokens.admin, body: { voice: { whisperUrl: 'http://whisper-down:8000' } } });
  const down = await listen();
  assert.equal(down.statusCode, 502);
  assert.match(down.json().error, /Whisper can’t be reached.*container running/);

  await json(app, 'PUT', '/api/admin/dj', { token: tokens.admin, body: { voice: { listen: 'openai' } } });
  assert.equal((await listen()).statusCode, 409, 'OpenAI needs its key');
  await json(app, 'PUT', '/api/admin/dj', { token: tokens.admin, body: { openaiKey: 'sk-openai-secret-9876' } });
  assert.equal((await listen(12)).statusCode, 200);
  assert.equal(calls.at(-1)?.url, 'https://api.openai.com/v1/audio/transcriptions');
  assert.equal(calls.at(-1)?.auth, 'Bearer sk-openai-secret-9876');
  assert.equal(calls.at(-1)?.model, 'gpt-4o-mini-transcribe');
});
