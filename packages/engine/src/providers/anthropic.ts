import type { AiConfig, RuntimeModel } from "@aili/schemas";
import type { TokenUsage } from "../metering";
import { ProviderError, type CompletionRequest, type CompletionResult, type ProfessorProvider } from "../provider";
import { fromAnthropicShape, toAnthropicSchema, type ReducedSchema } from "./anthropicSchema";

// The Anthropic Messages API over plain HTTP (docs/m3-plan.md slice 6, decision 4: fetch, no SDK).
// Read on Anthropic's own pages, 2026-10-12 (platform.claude.com/docs: Messages API, structured
// outputs, errors, rate limits):
// - POST {base}/v1/messages with headers x-api-key, anthropic-version: 2023-06-01, content-type.
// - Structured output: output_config.format { type: "json_schema", schema } (no beta header); the
//   JSON arrives as text in a "text" content block. stop_reason "max_tokens" may cut it short
//   (invalid JSON: our validators reject it and the repair path runs); "refusal" is billed.
// - Errors: { type: "error", error: { type, message, details? }, request_id }. A spending limit the
//   account owner set: HTTP 400 whose message begins "You have reached your specified ... API usage
//   limits". The tier's own cap: HTTP 429 with error.details.error_code "enforced_spend_limit_reached".
//   Both are "spend_limit" and never retried. 401/403: key_rejected. Other 429, 5xx, 529: retried
//   once by completeWithPolicy. Other 4xx: bad_request.
// - usage: input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens.
//
// The model ID, the key's variable NAME, max_output_tokens, thinking and effort come from
// config/ai.json only. The key is read at call time, sent only in the x-api-key header, and never
// logged, stored, or put in an error. Errors carry a kind and a status, never the response body.

export const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_BASE_URL = "https://api.anthropic.com";
const SPEND_LIMIT_MESSAGE = /^You have reached your specified (workspace )?API usage limits/;
const UNREACHABLE_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"]);

export interface AnthropicProviderOptions {
  config: AiConfig;
  model: RuntimeModel;
  /** The server's environment, read at call time (so a key set after start-up is used, and none is kept). */
  env: () => Record<string, string | undefined>;
  /** Tests only: a local mock server. Must be https, or http on this computer (the key is never sent in clear). */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export class AnthropicProvider implements ProfessorProvider {
  private readonly baseUrl: string;
  private readonly reduced = new WeakMap<object, ReducedSchema>();

  constructor(private readonly o: AnthropicProviderOptions) {
    const url = new URL(o.baseUrl ?? DEFAULT_BASE_URL);
    const local = url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]");
    if (url.protocol !== "https:" && !local) throw new Error("baseUrl must be https (or http on this computer, for tests)");
    this.baseUrl = url.origin;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const m = this.o.config.models[this.o.model];
    const key = this.o.env()[m.api_key_env]?.trim();
    if (!m.model || !key) throw new ProviderError("not_configured");
    let schema = this.reduced.get(req.outputSchema);
    if (!schema) this.reduced.set(req.outputSchema, (schema = toAnthropicSchema(req.outputSchema)));

    const body = {
      model: m.model,
      max_tokens: req.maxOutputTokens,
      system: req.system,
      messages: [{ role: "user", content: req.input }],
      output_config: { format: { type: "json_schema", schema: schema.schema }, ...(m.effort ? { effort: m.effort } : {}) },
      ...(m.thinking ? { thinking: { type: m.thinking } } : {}),
    };
    const now = this.o.now ?? Date.now;
    const started = now();
    let res: Response;
    let text: string;
    try {
      res = await (this.o.fetchImpl ?? fetch)(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: req.signal,
        redirect: "error", // never follow a redirect with the key
      });
      text = await res.text();
    } catch (err) {
      throw transportError(err, req.signal);
    }
    const latencyMs = now() - started;
    const parsed = parseJson(text);

    if (!res.ok) throw new ProviderError(kindOfFailure(res.status, parsed), res.status, usageOf(parsed, this.o.model));
    const msg = parsed as { content?: unknown; stop_reason?: unknown } | null;
    if (!msg || !Array.isArray(msg.content)) throw new ProviderError("server", res.status); // not a message: treat as a server fault
    const usage = usageOf(msg, this.o.model);
    if (msg.stop_reason === "refusal") throw new ProviderError("refused", undefined, usage);
    const answer = msg.content
      .filter((b): b is { type: "text"; text: string } => !!b && typeof b === "object" && b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("");
    const json = parseJson(answer);
    // Truncated (stop_reason "max_tokens") or otherwise not JSON: null, so the validators reject it and the repair runs.
    return { json: json === undefined ? null : fromAnthropicShape(json, schema.mapPaths), usage, latencyMs };
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** An HTTP failure as a kind. Reads only the error type, the start of the message and details.error_code. */
function kindOfFailure(status: number, body: unknown): ProviderError["kind"] {
  const error = (body as { error?: { message?: unknown; details?: { error_code?: unknown } } } | undefined)?.error;
  if (status === 401 || status === 403) return "key_rejected";
  if (status === 400 && typeof error?.message === "string" && SPEND_LIMIT_MESSAGE.test(error.message)) return "spend_limit";
  if (status === 429) return error?.details?.error_code === "enforced_spend_limit_reached" ? "spend_limit" : "rate_limited";
  if (status >= 500) return "server"; // includes 529 overloaded
  return "bad_request";
}

/** Reported tokens, or undefined (then metered conservatively). Cache reads and writes count as input. */
function usageOf(body: unknown, model: RuntimeModel): TokenUsage | undefined {
  const u = (body as { usage?: Record<string, unknown> } | undefined)?.usage;
  if (!u) return undefined;
  const n = (v: unknown) => (Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : undefined);
  const input = n(u.input_tokens);
  const output = n(u.output_tokens);
  if (input === undefined || output === undefined) return undefined;
  return { model, input_tokens: input + (n(u.cache_creation_input_tokens) ?? 0) + (n(u.cache_read_input_tokens) ?? 0), output_tokens: output };
}

function transportError(err: unknown, signal: AbortSignal): ProviderError {
  if (signal.aborted) return new ProviderError("aborted");
  if (err instanceof ProviderError) return err;
  const code = (err as { cause?: { code?: unknown } } | undefined)?.cause?.code;
  return new ProviderError(typeof code === "string" && UNREACHABLE_CODES.has(code) ? "unreachable" : "network");
}
