// HAND-WRITTEN response fixtures, NOT recorded from a real call. Shapes derived from Anthropic's
// docs (Messages API, structured outputs, errors, rate limits; read 2026-10-12). Token counts, IDs
// and messages are invented; the error messages copy only the documented opening words.

export type MockReply = { status: number; body: unknown; headers?: Record<string, string> } | { raw: string; status: number } | "hang";

const usage = (input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheWrite,
});

/** A 200 Messages response whose text block holds `text` (the structured output, as a string). */
export const message = (text: string, o: { stop_reason?: string; input?: number; output?: number; cacheRead?: number; cacheWrite?: number; thinking?: boolean } = {}) => ({
  status: 200,
  body: {
    id: "msg_fixture_0001",
    type: "message",
    role: "assistant",
    model: "fixture-model",
    content: [...(o.thinking ? [{ type: "thinking", thinking: "", signature: "fixture" }] : []), { type: "text", text }],
    stop_reason: o.stop_reason ?? "end_turn",
    stop_sequence: null,
    usage: usage(o.input ?? 4200, o.output ?? 380, o.cacheRead, o.cacheWrite),
  },
});

/** stop_reason "refusal": HTTP 200, billed, the text may not match the schema. */
export const refusal = () => ({ ...message("", { stop_reason: "refusal", output: 12 }) });

const error = (status: number, type: string, msg: string, details?: object, headers?: Record<string, string>) => ({
  status,
  headers,
  body: { type: "error", error: { type, message: msg, ...(details ? { details } : {}) }, request_id: "req_fixture_0001" },
});

/** A body message that must never reach an event, error or log. */
export const SECRET_BODY_TEXT = "fixture-body-detail-must-not-leak";

export const errors = {
  unauthorized: () => error(401, "authentication_error", `invalid x-api-key ${SECRET_BODY_TEXT}`),
  forbidden: () => error(403, "permission_error", `Your API key does not have permission ${SECRET_BODY_TEXT}`),
  ownSpendLimit: () => error(400, "invalid_request_error", `You have reached your specified API usage limits. ${SECRET_BODY_TEXT}`),
  ownWorkspaceSpendLimit: () => error(400, "invalid_request_error", `You have reached your specified workspace API usage limits. ${SECRET_BODY_TEXT}`),
  tierSpendCap: () => error(429, "rate_limit_error", `Spend limit reached. ${SECRET_BODY_TEXT}`, { error_code: "enforced_spend_limit_reached" }),
  rateLimited: () => error(429, "rate_limit_error", `Number of request tokens has exceeded your rate limit. ${SECRET_BODY_TEXT}`, undefined, { "retry-after": "1" }),
  server: () => error(500, "api_error", `An unexpected error has occurred. ${SECRET_BODY_TEXT}`),
  overloaded: () => error(529, "overloaded_error", `Overloaded ${SECRET_BODY_TEXT}`),
  invalidRequest: () => error(400, "invalid_request_error", `output_config.format.schema: unsupported ${SECRET_BODY_TEXT}`),
  notFound: () => error(404, "not_found_error", `model not found ${SECRET_BODY_TEXT}`),
  tooLarge: () => error(413, "request_too_large", `Request exceeds the maximum size ${SECRET_BODY_TEXT}`),
  billing: () => error(402, "billing_error", `billing ${SECRET_BODY_TEXT}`),
};
