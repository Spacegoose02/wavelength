import { randomBytes } from 'node:crypto';
import { HttpError } from '../http.ts';
import type { DjContentBlock, DjMessage, DjProvider, DjRequest, ProviderFactory } from './provider.ts';

/**
 * Ollama, on your own server (docs/AI-DJ.md "Ollama"). Free to run, so its calls cost nothing in the DJ's
 * spending. Chats are stored in Anthropic's message format (agent.ts), so this turns them into Ollama's
 * /api/chat messages on the way out and its answer back into text and tool_use blocks on the way in. That also
 * lets a chat carry on when an admin switches provider.
 *
 * Ollama can't search the web itself: with a key for ollama.com's web search the DJ gets `web_search` and
 * `web_fetch` as Hub tools instead (tools.ts).
 */

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
  tool_name?: string;
}

/** Anthropic-style messages → Ollama's. Thinking and the provider's own server tools are left out. */
export function toOllama(system: string, messages: DjMessage[]): OllamaMessage[] {
  const out: OllamaMessage[] = [{ role: 'system', content: system }];
  const names = new Map<string, string>();
  for (const m of messages) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    if (m.role === 'assistant') {
      const text: string[] = [];
      const calls: NonNullable<OllamaMessage['tool_calls']> = [];
      for (const b of m.content ?? []) {
        if (b.type === 'text') text.push(b.text);
        else if (b.type === 'tool_use') {
          names.set(b.id, b.name);
          calls.push({ function: { name: b.name, arguments: (b.input && typeof b.input === 'object' ? b.input : {}) as Record<string, unknown> } });
        }
      }
      out.push({ role: 'assistant', content: text.join('\n'), ...(calls.length && { tool_calls: calls }) });
      continue;
    }
    const text: string[] = [];
    for (const b of m.content ?? []) {
      if (b.type === 'text') text.push(b.text);
      else if (b.type === 'tool_result') {
        const body = typeof b.content === 'string' ? b.content : (b.content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join('\n');
        out.push({ role: 'tool', content: b.is_error ? `Error: ${body}` : body, ...(names.get(b.tool_use_id) && { tool_name: names.get(b.tool_use_id) }) });
      }
    }
    if (text.length) out.push({ role: 'user', content: text.join('\n') });
  }
  return out;
}

const toolId = () => `toolu_ollama_${randomBytes(9).toString('base64url')}`;

/** Ollama's answer → text and tool_use blocks, like Anthropic's. */
export function fromOllama(msg: { content?: string; tool_calls?: { function?: { name?: string; arguments?: unknown } }[] }): DjContentBlock[] {
  const blocks: DjContentBlock[] = [];
  // some models write their thinking into the answer
  const text = String(msg.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (text) blocks.push({ type: 'text', text, citations: null } as DjContentBlock);
  for (const c of msg.tool_calls ?? []) {
    const name = c.function?.name;
    if (!name) continue;
    let input = c.function?.arguments;
    if (typeof input === 'string') {
      try {
        input = JSON.parse(input);
      } catch {
        input = {};
      }
    }
    blocks.push({ type: 'tool_use', id: toolId(), name, input: input && typeof input === 'object' ? input : {} } as DjContentBlock);
  }
  return blocks;
}

export function ollamaProvider(fetcher: Fetch = (url, init) => fetch(url, init)): ProviderFactory {
  return (settings) => {
    const base = settings.ollamaUrl;
    const call = async (path: string, init: RequestInit, ms: number) => {
      if (!base) throw new HttpError(409, 'Add your Ollama server’s address in the AI DJ settings first');
      let res: Response;
      try {
        res = await fetcher(`${base}${path}`, { ...init, signal: AbortSignal.timeout(ms) });
      } catch (e) {
        throw new HttpError(502, (e as Error)?.name === 'TimeoutError' ? 'Ollama took too long to answer. A smaller model, or a GPU, is quicker' : `Couldn’t reach Ollama at ${base}`);
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const why = body.error ?? `${res.status}`;
        throw new HttpError(502, /not found/i.test(why) ? `Ollama doesn’t have ${settings.ollamaModel}. Run: ollama pull ${settings.ollamaModel}` : `Ollama said: ${why.slice(0, 300)}`);
      }
      return res;
    };

    const provider: DjProvider = {
      async create(req: DjRequest) {
        const tools = req.noTools ? [] : req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description ?? '', parameters: t.input_schema } }));
        const quick = (req.effort ?? settings.effort) === 'low';
        const body = (think: boolean | undefined) => JSON.stringify({
          model: settings.ollamaModel,
          messages: toOllama(req.system, req.messages),
          ...(tools.length && { tools }),
          stream: false,
          // short lines don't need thinking; the chat thinks when the model can
          ...(think !== undefined && { think }),
          options: { num_ctx: settings.ollamaContext, num_predict: Math.min(req.maxTokens ?? 8000, 8000) },
        });
        const send = (think: boolean | undefined) => call('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: body(think) }, 300_000);
        let res: Response;
        try {
          res = await send(!quick);
        } catch (e) {
          // a model that can't think says so: ask again without
          if (e instanceof HttpError && /think/i.test(e.message)) res = await send(undefined);
          else throw e;
        }
        const r = (await res.json()) as { message?: { content?: string; tool_calls?: { function?: { name?: string; arguments?: unknown } }[] }; done_reason?: string; prompt_eval_count?: number; eval_count?: number };
        const content = fromOllama(r.message ?? {});
        const usesTools = content.some((b) => b.type === 'tool_use');
        return {
          content,
          stopReason: usesTools ? 'tool_use' : r.done_reason === 'length' ? 'max_tokens' : 'end_turn',
          model: `ollama:${settings.ollamaModel}`,
          usage: { input: r.prompt_eval_count ?? 0, output: r.eval_count ?? 0, cacheRead: 0, cacheWrite: 0 },
        };
      },
      async test() {
        const res = await call('/api/tags', { method: 'GET' }, 10_000);
        const { models = [] } = (await res.json().catch(() => ({}))) as { models?: { name: string; capabilities?: string[] }[] };
        const m = models.find((x) => x.name === settings.ollamaModel || x.name === `${settings.ollamaModel}:latest`);
        if (!m) throw new HttpError(502, `Ollama is running but doesn’t have ${settings.ollamaModel}. Run: ollama pull ${settings.ollamaModel}`);
        if (m.capabilities && !m.capabilities.includes('tools')) return `Connected. ${m.name} is ready, but it can’t use tools: fine for the talking DJ and DJ mode, not for the chat.`;
        return `Connected. ${m.name} is ready.`;
      },
    };
    return provider;
  };
}

/** The models on an Ollama server, for the admin page. */
export async function ollamaModels(base: string, fetcher: Fetch = (url, init) => fetch(url, init)): Promise<{ name: string; tools: boolean; size: number }[]> {
  const res = await fetcher(`${base}/api/tags`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${res.status}`);
  const { models = [] } = (await res.json()) as { models?: { name: string; size?: number; capabilities?: string[] }[] };
  return models
    .filter((m) => !m.capabilities || m.capabilities.includes('completion'))
    .map((m) => ({ name: m.name, tools: !m.capabilities || m.capabilities.includes('tools'), size: m.size ?? 0 }));
}

/** ollama.com's web search and fetch (needs a free Ollama account's API key). */
export function ollamaWeb(key: string, fetcher: Fetch = (url, init) => fetch(url, init)) {
  const post = async (path: string, body: unknown) => {
    let res: Response;
    try {
      res = await fetcher(`https://ollama.com${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new HttpError(502, 'Couldn’t reach Ollama’s web search');
    }
    if (res.status === 401 || res.status === 403) throw new HttpError(502, 'Ollama’s web search refused the key saved on the Hub');
    if (!res.ok) throw new HttpError(502, `Ollama’s web search said ${res.status}`);
    return res.json() as Promise<Record<string, unknown>>;
  };
  return {
    async search(query: string) {
      const r = await post('/api/web_search', { query, max_results: 5 });
      return ((r.results ?? []) as { title?: string; url?: string; content?: string }[]).map((x) => ({ title: x.title, url: x.url, content: String(x.content ?? '').slice(0, 1500) }));
    },
    async fetch(url: string) {
      const r = await post('/api/web_fetch', { url });
      return { title: r.title, content: String(r.content ?? '').slice(0, 30_000), links: ((r.links ?? []) as string[]).slice(0, 40) };
    },
  };
}
