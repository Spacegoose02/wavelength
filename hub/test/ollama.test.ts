import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fromOllama, toOllama } from '../src/dj/ollama.ts';
import type { DjResponse, ProviderFactory } from '../src/dj/provider.ts';
import { json, seeded } from './helpers.ts';

const never: ProviderFactory = () => ({
  async create() {
    throw new Error('Anthropic must not be called');
  },
  async test() {
    return 'no';
  },
});

test('Ollama: messages go out in its format and answers come back as blocks', () => {
  const msgs = toOllama('sys', [
    { role: 'user', content: 'play Drake' },
    { role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm', signature: 'x' }, { type: 'text', text: 'Looking.' }, { type: 'tool_use', id: 't1', name: 'search_library', input: { query: 'Drake' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"songs":[]}' }, { type: 'tool_result', tool_use_id: 't9', content: 'nope', is_error: true }] },
  ] as any);
  assert.deepEqual(msgs, [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'play Drake' },
    { role: 'assistant', content: 'Looking.', tool_calls: [{ function: { name: 'search_library', arguments: { query: 'Drake' } } }] },
    { role: 'tool', content: '{"songs":[]}', tool_name: 'search_library' },
    { role: 'tool', content: 'Error: nope' },
  ]);
  const blocks = fromOllama({ content: '<think>let me see</think> Here you go.', tool_calls: [{ function: { name: 'play', arguments: '{"refs":["t1"],"mode":"now"}' } }] }) as any[];
  assert.equal(blocks[0].text, 'Here you go.');
  assert.equal(blocks[1].type, 'tool_use');
  assert.match(blocks[1].id, /^toolu_ollama_/);
  assert.deepEqual(blocks[1].input, { refs: ['t1'], mode: 'now' });
});

test('Ollama: runs the chat for free, short lines on Ollama while the chat stays on Claude, web search through ollama.com', async () => {
  const calls: { url: string; body: any; auth: string | null }[] = [];
  let answers: any[] = [];
  const ollamaFetch = async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body, auth: new Headers(init?.headers).get('authorization') });
    if (url.endsWith('/api/tags')) return Response.json({ models: [{ name: 'qwen3.5:9b', size: 6594474711, capabilities: ['completion', 'tools', 'thinking'] }, { name: 'nomic-embed-text:latest', capabilities: ['embedding'] }] });
    if (url === 'https://ollama.com/api/web_search') return Response.json({ results: [{ title: 'Top EDM', url: 'https://example.com/edm', content: 'Song A by DJ B' }] });
    if (url.endsWith('/api/chat')) {
      const a = answers.shift();
      if (!a) throw new Error('no answer scripted');
      return a instanceof Response ? a : typeof a === 'function' ? a(body) : Response.json(a);
    }
    return new Response('{}', { status: 404 });
  };
  const anthropic: ProviderFactory = (settings) => ({
    async create() {
      return { content: [{ type: 'text', text: 'From Claude.', citations: null }] as DjResponse['content'], stopReason: 'end_turn', model: settings.model, usage: { input: 100, output: 10, cacheRead: 0, cacheWrite: 0 } };
    },
    async test() {
      return 'ok';
    },
  });
  const { app, db, tokens, ids } = await seeded({}, {}, { djProvider: anthropic, ollamaFetch });
  const admin = (body: unknown) => json(app, 'PUT', '/api/admin/dj', { token: tokens.admin, body });
  await json(app, 'PUT', `/api/admin/dj/users/${ids.member}`, { token: tokens.admin, body: { enabled: true, monthlyLimit: null } });

  // Ollama needs no API key, only its address
  assert.equal((await admin({ provider: 'ollama', ollamaUrl: 'ftp://x' })).status, 400);
  await admin({ enabled: true, provider: 'ollama', ollamaUrl: 'http://192.168.86.207:11434/' });
  assert.equal((await json(app, 'GET', '/api/dj', { token: tokens.member })).body.available, true);
  const models = await json(app, 'GET', '/api/admin/dj/ollama', { token: tokens.admin });
  assert.deepEqual(models.body.models, [{ name: 'qwen3.5:9b', tools: true, size: 6594474711 }], 'embedding models are left out');
  assert.match((await json(app, 'POST', '/api/admin/dj/test', { token: tokens.admin, body: {} })).body.message, /qwen3\.5:9b is ready/);

  // the chat: a tool call, its result, then the answer; the chat thinks, costs nothing
  answers = [
    { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'listening_stats', arguments: { period: 'week' } } }] }, done_reason: 'stop', prompt_eval_count: 900, eval_count: 20 },
    (body: any) => {
      assert.equal(body.messages.at(-1).role, 'tool');
      assert.equal(body.messages.at(-1).tool_name, 'listening_stats');
      return Response.json({ message: { role: 'assistant', content: 'You love Drake this week.' }, done_reason: 'stop', prompt_eval_count: 1000, eval_count: 15 });
    },
  ];
  const r = await json(app, 'POST', '/api/dj/chat', { token: tokens.member, body: { message: 'what did I play?' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.reply, 'You love Drake this week.');
  const first = calls.find((c) => c.url === 'http://192.168.86.207:11434/api/chat')!.body;
  assert.equal(first.model, 'qwen3.5:9b');
  assert.equal(first.stream, false);
  assert.equal(first.think, true);
  assert.equal(first.options.num_ctx, 16384);
  assert.ok(first.tools.some((t: any) => t.function.name === 'search_library'));
  assert.ok(!first.tools.some((t: any) => t.function.name === 'web_search'), 'no web search until it is on and has a key');
  assert.equal(r.body.spent, 0);
  const rows = db.prepare('SELECT model, cost FROM dj_usage').all() as { model: string; cost: number }[];
  assert.deepEqual(rows.map((x) => ({ ...x })), [{ model: 'ollama:qwen3.5:9b', cost: 0 }, { model: 'ollama:qwen3.5:9b', cost: 0 }]);

  // a model that can't think: asked again without
  answers = [
    new Response(JSON.stringify({ error: '"qwen2.5:14b" does not support thinking' }), { status: 400 }),
    { message: { content: 'Hi!' }, done_reason: 'stop' },
  ];
  await admin({ ollamaModel: 'qwen2.5:14b' });
  const again = await json(app, 'POST', '/api/dj/chat', { token: tokens.member, body: { message: 'hi' } });
  assert.equal(again.body.reply, 'Hi!', JSON.stringify(again.body));
  assert.equal(calls.filter((c) => c.url.endsWith('/api/chat')).at(-1)!.body.think, undefined);

  // web search: the key is sealed, and the Hub runs ollama.com's search as a tool
  await admin({ ollamaModel: 'qwen3.5:9b', ollamaKey: 'ollama-secret-key-77' });
  await json(app, 'PUT', '/api/admin/features', { token: tokens.admin, body: { features: { djWeb: { on: true } } } });
  const view = await json(app, 'GET', '/api/admin/dj', { token: tokens.admin });
  assert.deepEqual(view.body.ollamaKey, { set: true, hint: '…y-77', unreadable: false });
  assert.ok(!JSON.stringify(view.body).includes('ollama-secret'));
  answers = [
    (body: any) => {
      assert.ok(body.tools.some((t: any) => t.function.name === 'web_search'));
      assert.match(body.messages[0].content, /web_search/);
      return Response.json({ message: { content: '', tool_calls: [{ function: { name: 'web_search', arguments: { query: 'top EDM hits' } } }] } });
    },
    (body: any) => {
      assert.match(body.messages.at(-1).content, /Song A by DJ B/);
      return Response.json({ message: { content: 'Song A is big right now.' } });
    },
  ];
  const w = await json(app, 'POST', '/api/dj/chat', { token: tokens.member, body: { message: 'top EDM hits?' } });
  assert.equal(w.body.reply, 'Song A is big right now.');
  const search = calls.find((c) => c.url === 'https://ollama.com/api/web_search')!;
  assert.equal(search.auth, 'Bearer ollama-secret-key-77');
  assert.equal(search.body.query, 'top EDM hits');

  // Claude for the chat, Ollama for the short lines
  await admin({ provider: 'anthropic', apiKey: 'sk-ant-x', quickProvider: 'ollama' });
  await json(app, 'PUT', '/api/admin/features', { token: tokens.admin, body: { features: { djVoice: { on: true } } } });
  answers = [(body: any) => {
    assert.equal(body.think, false, 'short lines don’t think');
    assert.equal(body.tools, undefined);
    return Response.json({ message: { content: 'That was Dreams, here comes Hey Jude.' } });
  }];
  const line = await json(app, 'POST', '/api/dj/patter', { token: tokens.member, body: { next: { title: 'Hey Jude', artist: 'The Beatles' } } });
  assert.equal(line.body.text, 'That was Dreams, here comes Hey Jude.');
  assert.equal((await json(app, 'POST', '/api/dj/chat', { token: tokens.member, body: { message: 'hi' } })).body.reply, 'From Claude.');
  assert.match((await json(app, 'POST', '/api/admin/dj/test', { token: tokens.admin, body: { which: 'quick' } })).body.message, /ready/);
});

test('Ollama: says what to do when the model is missing or the server is down', async () => {
  const { app, tokens, ids } = await seeded({}, {}, {
    djProvider: never,
    ollamaFetch: async (url) => {
      if (url.includes('down')) throw new TypeError('fetch failed');
      if (url.endsWith('/api/tags')) return Response.json({ models: [] });
      return new Response(JSON.stringify({ error: 'model "llama9" not found, try pulling it first' }), { status: 404 });
    },
  });
  await json(app, 'PUT', '/api/admin/dj', { token: tokens.admin, body: { enabled: true, provider: 'ollama', ollamaUrl: 'http://ollama:11434', ollamaModel: 'llama9' } });
  await json(app, 'PUT', `/api/admin/dj/users/${ids.member}`, { token: tokens.admin, body: { enabled: true } });
  assert.match((await json(app, 'POST', '/api/admin/dj/test', { token: tokens.admin, body: {} })).body.error, /ollama pull llama9/);
  assert.match((await json(app, 'POST', '/api/dj/chat', { token: tokens.member, body: { message: 'hi' } })).body.error, /ollama pull llama9/);
  await json(app, 'PUT', '/api/admin/dj', { token: tokens.admin, body: { ollamaUrl: 'http://down:11434' } });
  assert.match((await json(app, 'POST', '/api/dj/chat', { token: tokens.member, body: { message: 'hi' } })).body.error, /Couldn’t reach Ollama/);
});
