import Anthropic from '@anthropic-ai/sdk';
import { HttpError } from '../http.ts';
import type { DjSettings, TokenUsage } from './settings.ts';

/**
 * The AI provider behind the DJ. Only the Hub talks to it, with the key kept on the Hub (settings.ts).
 * Anthropic is the one built in; another provider is a new `DjProvider` (docs/AI-DJ.md "Adding a provider").
 */

export type DjMessage = Anthropic.Beta.BetaMessageParam;
export type DjContentBlock = Anthropic.Beta.BetaContentBlock;
export type DjContentParam = Anthropic.Beta.BetaContentBlockParam;
export type DjTool = Anthropic.Beta.BetaTool;

export interface DjRequest {
  system: string;
  tools: DjTool[];
  messages: DjMessage[];
  /** true on the last allowed step: answer without calling more tools. */
  noTools?: boolean;
  /** Let the model search the web and read pages, at most this many searches in this call. */
  web?: { maxSearches: number };
  /** Overrides for short one-off calls (the talking DJ's links). */
  effort?: DjSettings['effort'];
  maxTokens?: number;
}

export interface DjResponse {
  /** Kept exactly as returned (thinking blocks included) and sent back on the next call. */
  content: DjContentBlock[];
  stopReason: string | null;
  /** The model that answered (a fallback model when the first one declined). */
  model: string;
  usage: TokenUsage;
}

export interface DjProvider {
  create(req: DjRequest): Promise<DjResponse>;
  /** Check the key and model work, without spending tokens. Returns a line for the admin. */
  test(): Promise<string>;
}

export type ProviderFactory = (settings: DjSettings, apiKey: string) => DjProvider;

/** Models with the newer web search / web fetch tools (dynamic filtering); others get the basic ones. */
const WEB_2026_MODELS = new Set([
  'claude-opus-5-5', 'claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6',
  'claude-sonnet-5-5', 'claude-sonnet-5', 'claude-sonnet-4-6',
]);

/** Anthropic's own web tools: they run on Anthropic's side, so the Hub only declares them. */
export function webTools(model: string, maxSearches: number): Anthropic.Beta.BetaToolUnion[] {
  // pages only: a fetch is limited to links already in the chat (the listener's, or from a search)
  const fetchMax = Math.max(2, maxSearches);
  return WEB_2026_MODELS.has(model)
    ? [
      { type: 'web_search_20260209', name: 'web_search', max_uses: maxSearches },
      { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: fetchMax, max_content_tokens: 20_000 },
    ]
    : [
      { type: 'web_search_20250305', name: 'web_search', max_uses: maxSearches },
      { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: fetchMax, max_content_tokens: 20_000 },
    ];
}

/** Models that take `fallbacks: "default"` (server-side refusal fallback). */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-opus-5', 'claude-fable-5-1']);

/** Turn the SDK's errors into something an admin or listener can act on. */
function explain(e: unknown): HttpError {
  if (e instanceof Anthropic.AuthenticationError) return new HttpError(502, 'The AI provider refused the API key saved on the Hub');
  if (e instanceof Anthropic.PermissionDeniedError) return new HttpError(502, 'The API key saved on the Hub isn’t allowed to use that model');
  if (e instanceof Anthropic.NotFoundError) return new HttpError(502, 'The AI provider doesn’t know that model. Pick another in the AI DJ settings');
  if (e instanceof Anthropic.RateLimitError) return new HttpError(429, 'The AI provider is busy (rate limit). Try again in a minute');
  if (e instanceof Anthropic.BadRequestError) return new HttpError(502, `The AI provider turned the request down: ${e.message.slice(0, 300)}`);
  if (e instanceof Anthropic.APIConnectionError) return new HttpError(502, 'Couldn’t reach the AI provider from the Hub');
  if (e instanceof Anthropic.APIError) return new HttpError(502, `The AI provider had a problem (${e.status ?? 'error'}). Try again`);
  return new HttpError(502, `The AI DJ hit an error: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
}

export const anthropicProvider: ProviderFactory = (settings, apiKey) => {
  const client = new Anthropic({ apiKey, baseURL: settings.baseUrl || undefined, timeout: 120_000, maxRetries: 2 });
  const fallback = settings.fallback && FALLBACK_MODELS.has(settings.model) && !settings.baseUrl;
  return {
    async create(req) {
      let m: Anthropic.Beta.BetaMessage;
      const tools = req.web ? [...req.tools, ...webTools(settings.model, req.web.maxSearches)] : req.tools;
      try {
        m = await client.beta.messages.create({
          model: settings.model,
          max_tokens: req.maxTokens ?? 16000,
          system: req.system,
          ...(tools.length && { tools, tool_choice: req.noTools ? { type: 'none' as const } : { type: 'auto' as const } }),
          messages: req.messages,
          // thinking is on by default on the current models; effort sets how much
          output_config: { effort: req.effort ?? settings.effort },
          // the system prompt, tools and earlier turns are re-read at the cache price on each step
          cache_control: { type: 'ephemeral' },
          ...(fallback && { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
        });
      } catch (e) {
        throw explain(e);
      }
      return {
        content: m.content,
        stopReason: m.stop_reason,
        model: m.model,
        usage: {
          input: m.usage.input_tokens ?? 0,
          output: m.usage.output_tokens ?? 0,
          cacheRead: m.usage.cache_read_input_tokens ?? 0,
          cacheWrite: m.usage.cache_creation_input_tokens ?? 0,
          webSearches: m.usage.server_tool_use?.web_search_requests ?? 0,
        },
      };
    },
    async test() {
      try {
        const m = await client.models.retrieve(settings.model);
        return `Connected. ${m.display_name} is ready.`;
      } catch (e) {
        throw explain(e);
      }
    },
  };
};
