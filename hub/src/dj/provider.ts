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
      try {
        m = await client.beta.messages.create({
          model: settings.model,
          max_tokens: 16000,
          system: req.system,
          tools: req.tools,
          tool_choice: req.noTools ? { type: 'none' } : { type: 'auto' },
          messages: req.messages,
          // thinking is on by default on the current models; effort sets how much
          output_config: { effort: settings.effort },
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
