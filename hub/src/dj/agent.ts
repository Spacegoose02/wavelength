import type { Config } from '../config.ts';
import type { Db } from '../db.ts';
import { HttpError } from '../http.ts';
import type { User } from '../users.ts';
import type { DjContentBlock, DjContentParam, DjMessage, DjProvider, ProviderFactory } from './provider.ts';
import { checkBudget, costOf, getApiKey, getSettings, priceOf, recordUsage } from './settings.ts';
import { ALL_TOOLS, isAppTool, isHubTool, runHubTool } from './tools.ts';

/**
 * The DJ's agent loop (docs/AI-DJ.md). One message from the listener can take several model calls: the model
 * calls tools, gets their results and carries on, until it answers. Hub tools run here straight away; app
 * tools are handed to the app (`status: 'tools'`), and the loop goes on when the app posts their results.
 *
 * Messages are stored exactly as the provider returned them and only ever appended to, so thinking blocks
 * and the prompt cache stay valid from one step to the next.
 */

/** Model calls per message the listener sends; the last one has to answer without tools. */
export const MAX_STEPS = 12;
/** Messages per chat; after that the app offers a new one, so a chat can't grow without end. */
export const MAX_TURNS = 40;
/** A tool result longer than this is cut. */
const MAX_RESULT = 24_000;
/** A chat bigger than this (stored JSON) is closed for new messages. */
const MAX_CHAT_BYTES = 1_500_000;

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

interface ToolResult {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

/** Waiting for the app: the calls it must run, and the Hub's own results for that step, kept until then. */
interface Pending {
  calls: ToolCall[];
  hubResults: ToolResult[];
  /** The order the model asked for them, so results go back in that order. */
  order: string[];
  steps: number;
  requests: number;
  /** Where this listener message's assistant text started, for the reply. */
  replyFrom: number;
}

export interface Chat {
  id: number;
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: number;
}

export interface TranscriptEntry {
  role: 'user' | 'assistant';
  text: string;
  /** Tools the DJ used to get to this answer. */
  tools?: string[];
}

export interface TurnResult {
  chat: Chat;
  status: 'done' | 'tools';
  /** The DJ's words since the listener's last message (also while waiting for tools). */
  reply: string;
  calls?: ToolCall[];
  /** The chat is full: the next message needs a new chat. */
  full?: boolean;
}

interface Row {
  id: number;
  user_id: number;
  title: string;
  messages: string;
  pending: string | null;
  turns: number;
  created_at: number;
  updated_at: number;
}

const toChat = (r: Row): Chat => ({ id: r.id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at, turns: r.turns });

function systemPrompt(user: User): string {
  const today = new Date().toISOString().slice(0, 10);
  const kid = user.role === 'kid';
  return [
    'You are the DJ inside Wavelength, a household music app. You help one listener find, play and organise music from their own library.',
    `The listener is ${user.displayName}. Today is ${today}.`,
    '',
    'How to work:',
    '- The library is what the listener owns. Only play or save songs and albums you got a ref for (t… or a…) from search_library, find_songs or library_albums in this chat. Never make refs up.',
    '- To build a playlist or a mix: pick songs (from what you know, listening_stats, similar_artists, artist_top_songs), check them with find_songs in one batch, then play or save the ones found. Aim for the size asked for, or about 25 songs.',
    '- Say which songs weren’t in the library when it matters, and offer to request missing albums. Only call request_download when the listener asked for it or said yes.',
    '- Missing albums: compare artist_discography with library_albums, list what is missing (studio albums first), and ask before requesting.',
    '- Keep replies short and friendly: a sentence or two, then a list when listing music. No long explanations of what you are about to do.',
    '- If a tool fails, say so plainly and suggest what to try.',
    kid
      ? '- This listener is a child. Keep everything family-friendly: never pick explicit songs or albums, and skip anything marked explicit. Their download requests go to a parent to approve.'
      : '',
  ].filter((l) => l !== '').join('\n');
}

/** The listener-facing text of one user or assistant message. */
function textOf(m: DjMessage): string {
  if (!m.content) return '';
  if (typeof m.content === 'string') return m.content;
  return m.content.map((b) => (b.type === 'text' ? b.text : '')).filter(Boolean).join('\n\n');
}

export function transcript(messages: DjMessage[]): TranscriptEntry[] {
  const out: TranscriptEntry[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      const text = textOf(m);
      if (text) out.push({ role: 'user', text });
      continue;
    }
    const tools = !m.content || typeof m.content === 'string' ? [] : m.content.filter((b) => b.type === 'tool_use').map((b) => (b as { name: string }).name);
    const text = textOf(m);
    const last = out[out.length - 1];
    if (last?.role === 'assistant') {
      if (text) last.text = last.text ? `${last.text}\n\n${text}` : text;
      if (tools.length) last.tools = [...(last.tools ?? []), ...tools];
    } else out.push({ role: 'assistant', text, ...(tools.length && { tools }) });
  }
  return out;
}

const clip = (v: unknown) => {
  const t = typeof v === 'string' ? v : JSON.stringify(v);
  return t.length > MAX_RESULT ? `${t.slice(0, MAX_RESULT)}… (cut)` : t;
};

export class DjAgent {
  private db: Db;
  private config: Config;
  private factory: ProviderFactory;
  /** Chats with a model call running, so two can't append at once. */
  private busy = new Set<number>();
  /** Make a download request as this person; set by routes/requests.ts. */
  request: (user: User, b: { link: string; kind: string; title: string; artist: string; note: string }) => Promise<{ status: string }> = async () => {
    throw new HttpError(503, 'Requests aren’t available');
  };

  constructor(db: Db, config: Config, factory: ProviderFactory) {
    this.db = db;
    this.config = config;
    this.factory = factory;
  }

  provider(): DjProvider {
    const key = getApiKey(this.db, this.config.secretKey);
    if (!key) throw new HttpError(409, 'Add an API key in the AI DJ settings first');
    return this.factory(getSettings(this.db), key);
  }

  list(userId: number): Chat[] {
    return (this.db.prepare('SELECT * FROM dj_conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100').all(userId) as unknown as Row[]).map(toChat);
  }

  private row(userId: number, id: number): Row {
    const r = this.db.prepare('SELECT * FROM dj_conversations WHERE id = ? AND user_id = ?').get(id, userId) as Row | undefined;
    if (!r) throw new HttpError(404, 'No such chat');
    return r;
  }

  get(userId: number, id: number) {
    const r = this.row(userId, id);
    const pending = r.pending ? (JSON.parse(r.pending) as Pending) : null;
    return { chat: toChat(r), messages: transcript(JSON.parse(r.messages) as DjMessage[]), calls: pending?.calls ?? null, full: this.full(r) };
  }

  delete(userId: number, id: number) {
    this.row(userId, id);
    this.db.prepare('DELETE FROM dj_conversations WHERE id = ?').run(id);
  }

  private full(r: Row) {
    return r.turns >= MAX_TURNS || r.messages.length > MAX_CHAT_BYTES;
  }

  /** The listener sends a message: a new chat when `chatId` is missing. */
  async send(user: User, chatId: number | null, text: string): Promise<TurnResult> {
    const message = text.trim().slice(0, 4000);
    if (!message) throw new HttpError(400, 'Say something to the DJ');
    checkBudget(this.db, user.id);
    let r: Row;
    if (chatId === null) {
      const now = Date.now();
      const title = message.replace(/\s+/g, ' ').slice(0, 60);
      const { lastInsertRowid } = this.db.prepare('INSERT INTO dj_conversations (user_id, title, messages, turns, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)')
        .run(user.id, title, '[]', now, now);
      r = this.row(user.id, Number(lastInsertRowid));
    } else r = this.row(user.id, chatId);
    if (r.pending) throw new HttpError(409, 'The DJ is still waiting for the app. Try again in a moment');
    if (this.full(r)) throw new HttpError(409, 'This chat is full. Start a new one');
    const messages = JSON.parse(r.messages) as DjMessage[];
    messages.push({ role: 'user', content: message });
    this.db.prepare('UPDATE dj_conversations SET turns = turns + 1 WHERE id = ?').run(r.id);
    return this.loop(user, r.id, messages, { steps: 0, requests: 0, replyFrom: messages.length });
  }

  /** The app answers the tool calls it was given. `results`: `{ id, content, isError? }` for each. */
  async toolResults(user: User, chatId: number, results: unknown): Promise<TurnResult> {
    const r = this.row(user.id, chatId);
    if (!r.pending) throw new HttpError(409, 'The DJ isn’t waiting for anything');
    const pending = JSON.parse(r.pending) as Pending;
    const got = new Map<string, ToolResult>();
    for (const x of Array.isArray(results) ? results : []) {
      const v = x as { id?: unknown; content?: unknown; isError?: unknown };
      if (typeof v.id !== 'string' || !pending.calls.some((c) => c.id === v.id)) continue;
      got.set(v.id, { type: 'tool_result', tool_use_id: v.id, content: clip(v.content ?? ''), ...(v.isError === true && { is_error: true }) });
    }
    // a call the app didn't answer (an older app, a crash) still needs a result
    for (const c of pending.calls) if (!got.has(c.id)) got.set(c.id, { type: 'tool_result', tool_use_id: c.id, content: 'The app didn’t run this', is_error: true });
    for (const h of pending.hubResults) got.set(h.tool_use_id, h);
    const messages = JSON.parse(r.messages) as DjMessage[];
    messages.push({ role: 'user', content: pending.order.map((id) => got.get(id)!) });
    this.db.prepare('UPDATE dj_conversations SET pending = NULL WHERE id = ?').run(r.id);
    return this.loop(user, r.id, messages, pending);
  }

  private save(id: number, messages: DjMessage[], pending: Pending | null) {
    this.db.prepare('UPDATE dj_conversations SET messages = ?, pending = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(messages), pending ? JSON.stringify(pending) : null, Date.now(), id);
  }

  private result(user: User, id: number, messages: DjMessage[], replyFrom: number, status: TurnResult['status'], calls?: ToolCall[]): TurnResult {
    const r = this.row(user.id, id);
    const reply = transcript(messages.slice(replyFrom)).filter((e) => e.role === 'assistant').map((e) => e.text).filter(Boolean).join('\n\n');
    return { chat: toChat(r), status, reply, ...(calls && { calls }), ...(this.full(r) && { full: true }) };
  }

  private async loop(user: User, id: number, messages: DjMessage[], state: { steps: number; requests: number; replyFrom: number }): Promise<TurnResult> {
    if (this.busy.has(id)) throw new HttpError(409, 'The DJ is already answering in this chat');
    this.busy.add(id);
    try {
      const provider = this.provider();
      const settings = getSettings(this.db);
      const system = systemPrompt(user);
      let { steps, requests } = state;
      for (;;) {
        checkBudget(this.db, user.id);
        steps++;
        const last = steps >= MAX_STEPS;
        let res;
        try {
          res = await provider.create({ system, tools: ALL_TOOLS, messages, noTools: last });
        } catch (e) {
          // keep what we have: the chat stays valid (a later message just follows on) and can be tried again
          this.save(id, messages, null);
          throw e;
        }
        recordUsage(this.db, user.id, id, res.model, res.usage, costOf(priceOf(settings, res.model) ?? priceOf(settings, settings.model), res.usage));
        messages.push({ role: 'assistant', content: res.content as unknown as DjContentParam[] });

        const uses = res.content.filter((b): b is Extract<DjContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
        if (res.stopReason === 'refusal') {
          // a declined turn can stop inside a tool call: never run those, but answer them so the chat stays valid
          if (uses.length) messages.push({ role: 'user', content: uses.map((u) => ({ type: 'tool_result' as const, tool_use_id: u.id, content: 'Not run', is_error: true })) });
          this.save(id, messages, null);
          const out = this.result(user, id, messages, state.replyFrom, 'done');
          return { ...out, reply: out.reply || 'Sorry, I can’t help with that one.' };
        }
        if (res.stopReason === 'pause_turn') {
          this.save(id, messages, null);
          continue;
        }
        if (!uses.length) {
          this.save(id, messages, null);
          return this.result(user, id, messages, state.replyFrom, 'done');
        }
        if (res.stopReason === 'max_tokens') {
          // a tool call cut off at max_tokens can look whole: don't run it
          messages.push({ role: 'user', content: uses.map((u) => ({ type: 'tool_result' as const, tool_use_id: u.id, content: 'Cut off: the answer was too long. Do less at once.', is_error: true })) });
          this.save(id, messages, null);
          continue;
        }

        // Hub tools now; app tools go to the app
        const hubResults: ToolResult[] = [];
        const calls: ToolCall[] = [];
        const ctx = { db: this.db, user, request: (b: Parameters<DjAgent['request']>[1]) => this.request(user, b), requestsThisTurn: requests };
        for (const u of uses) {
          if (isAppTool(u.name)) calls.push({ id: u.id, name: u.name, input: u.input });
          else if (isHubTool(u.name)) {
            try {
              const input = u.input && typeof u.input === 'object' ? (u.input as Record<string, unknown>) : {};
              hubResults.push({ type: 'tool_result', tool_use_id: u.id, content: clip(await runHubTool(u.name, input, ctx)) });
            } catch (e) {
              hubResults.push({ type: 'tool_result', tool_use_id: u.id, content: (e as Error).message || 'Failed', is_error: true });
            }
          } else hubResults.push({ type: 'tool_result', tool_use_id: u.id, content: `No tool called ${u.name}`, is_error: true });
        }
        requests = ctx.requestsThisTurn;
        if (calls.length) {
          const pending: Pending = { calls, hubResults, order: uses.map((u) => u.id), steps, requests, replyFrom: state.replyFrom };
          this.save(id, messages, pending);
          return this.result(user, id, messages, state.replyFrom, 'tools', calls);
        }
        messages.push({ role: 'user', content: hubResults });
        this.save(id, messages, null);
      }
    } finally {
      this.busy.delete(id);
    }
  }
}

/** Monthly totals for the admin page. */
export function usageSummary(db: Db, from: number) {
  const byUser = db.prepare(`SELECT user_id AS userId, COUNT(*) AS calls, SUM(input_tokens + cache_read_tokens + cache_write_tokens) AS inputTokens,
      SUM(output_tokens) AS outputTokens, SUM(cost) AS cost FROM dj_usage WHERE at >= ? GROUP BY user_id`).all(from);
  const byModel = db.prepare(`SELECT model, COUNT(*) AS calls, SUM(input_tokens + cache_read_tokens + cache_write_tokens) AS inputTokens,
      SUM(output_tokens) AS outputTokens, SUM(cost) AS cost FROM dj_usage WHERE at >= ? GROUP BY model ORDER BY cost DESC`).all(from);
  const byDay = db.prepare(`SELECT strftime('%Y-%m-%d', at / 1000, 'unixepoch', 'localtime') AS day, SUM(cost) AS cost, COUNT(*) AS calls
      FROM dj_usage WHERE at >= ? GROUP BY day ORDER BY day`).all(from);
  return { byUser, byModel, byDay };
}

