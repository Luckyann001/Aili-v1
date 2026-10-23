import type { TokenUsage } from "./metering";

// The provider adapter (docs/m3-plan.md slice 2). One interface for any model provider; the real
// HTTP adapters come in slice 6 (plain fetch, no SDK). Which provider and model, and the NAME of
// the key's environment variable, live only in config/ai.json. Nothing here knows a provider.
//
// Retry and timeout rules (one budget per turn, shared by every call in it):
// - network error, attempt timeout, 429, 5xx: ONE retry after a jittered pause, only if time remains;
// - 401/403: no retry, "key rejected";  other 4xx: no retry;
// - an interrupt aborts at once, with no retry;
// - every attempt is reported for metering, even a failed one. An attempt that timed out, was
//   aborted, or lost its connection after the request was sent is metered CONSERVATIVELY (estimated
//   input + max output), because the provider may still bill it; a request that never left
//   ("unreachable") and the provider's own refusals (429, 4xx, 5xx) are metered at zero.
// Errors carry a kind and a status code only, never a response body or a key.

export interface CompletionRequest {
  system: string;
  input: string;
  /** JSON Schema the provider's structured output must follow (our validators still run after). */
  outputSchema: object;
  maxOutputTokens: number;
  signal: AbortSignal;
}

export interface CompletionResult {
  /** The parsed answer, or null when the output was not valid JSON (the validators then reject it). */
  json: unknown;
  /** Tokens the provider reported. Absent: metered conservatively (estimated input + max output). */
  usage?: TokenUsage;
  latencyMs: number;
}

export interface ProfessorProvider {
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

/**
 * "unreachable": the request never left (connection refused, DNS failure): billed nothing.
 * "network": the connection failed AFTER the request was sent: the provider may still bill it.
 */
/**
 * "spend_limit": a monthly spending limit was reached (the one Lucky set, or the provider tier's
 * cap); retrying cannot help. "refused": the model declined the request (billed, not retried).
 */
export type ProviderErrorKind = "spend_limit" | "refused" | "unreachable" | "network" | "timeout" | "rate_limited" | "server" | "key_rejected" | "bad_request" | "not_configured" | "aborted";

/** A provider failure. Its message is built from the kind and status only (never a body or key). */
export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    readonly status?: number,
    /** Tokens the provider reported for this failed call (a refusal is billed), if it reported any. */
    readonly usage?: TokenUsage,
  ) {
    super(status === undefined ? `provider: ${kind}` : `provider: ${kind} (HTTP ${status})`);
    this.name = "ProviderError";
  }
}

/** An HTTP status from a provider, as an error kind (adapters use this; slice 6). */
export function kindOfStatus(status: number): ProviderErrorKind {
  if (status === 401 || status === 403) return "key_rejected";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  return "bad_request";
}

const RETRYABLE: ReadonlySet<ProviderErrorKind> = new Set(["unreachable", "network", "timeout", "rate_limited", "server"]);
/** Failures after the request was sent, which a provider may still bill: metered conservatively. */
const MAY_BE_BILLED: ReadonlySet<ProviderErrorKind> = new Set(["network", "timeout", "aborted"]);

/** One call to the provider, for metering: its usage (zero when nothing was billed) and outcome. */
export interface Attempt {
  usage: TokenUsage;
  outcome: "ok" | ProviderErrorKind;
}

export interface PolicyOptions {
  /** The turn's deadline (epoch ms): no attempt or retry may run past it. */
  deadlineMs: number;
  /** The longest one attempt may take, so a hung call still leaves time to retry. */
  attemptTimeoutMs?: number;
  /** Shortest time worth starting a retry with. */
  minRetryMs?: number;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
  /** Called after every attempt, success or not (metering). */
  onAttempt: (a: Attempt) => void;
  model: TokenUsage["model"];
  /** Estimated input tokens of this request: with maxOutputTokens, the charge for a timed-out or aborted attempt. */
  estimatedInputTokens: number;
}

const realSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new ProviderError("aborted"));
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), reject(new ProviderError("aborted"))), { once: true });
  });

/** Run `req` through `provider` under the retry and timeout rules above. */
export async function completeWithPolicy(provider: ProfessorProvider, req: CompletionRequest, o: PolicyOptions): Promise<CompletionResult> {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? realSleep;
  const random = o.random ?? Math.random;
  const zero: TokenUsage = { model: o.model, input_tokens: 0, output_tokens: 0 };
  const conservative: TokenUsage = { model: o.model, input_tokens: o.estimatedInputTokens, output_tokens: req.maxOutputTokens };
  for (let attempt = 1; ; attempt++) {
    if (req.signal.aborted) throw new ProviderError("aborted");
    const remaining = o.deadlineMs - now();
    if (remaining <= 0) throw new ProviderError("timeout");
    // Each attempt has its own timer, and the turn's interrupt aborts it at once.
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    req.signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => ac.abort(), Math.min(remaining, o.attemptTimeoutMs ?? 12_000));
    let failure: ProviderError;
    try {
      const result = await provider.complete({ ...req, signal: ac.signal });
      o.onAttempt({ usage: result.usage ?? conservative, outcome: "ok" });
      return result;
    } catch (err) {
      // The turn's interrupt wins; then this attempt's own timer; then the provider's own error.
      failure = req.signal.aborted
        ? new ProviderError("aborted")
        : ac.signal.aborted
          ? new ProviderError("timeout")
          : err instanceof ProviderError
            ? err
            : new ProviderError("network");
      // The request was sent: a timeout or an abort may still be billed, so charge the most it could cost.
      o.onAttempt({ usage: failure.usage ?? (MAY_BE_BILLED.has(failure.kind) ? conservative : zero), outcome: failure.kind });
    } finally {
      clearTimeout(timer);
      req.signal.removeEventListener("abort", onAbort);
    }
    if (failure.kind === "aborted" || !RETRYABLE.has(failure.kind) || attempt >= 2) throw failure;
    const pause = 250 + Math.floor(random() * 500); // jittered, 250–750 ms
    if (o.deadlineMs - now() - pause < (o.minRetryMs ?? 2_000)) throw failure; // not enough time left to retry
    await sleep(pause, req.signal);
  }
}
