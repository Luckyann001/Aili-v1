import type { ReplyClassification, SessionHistory } from "@aili/schemas";
import type { TokenUsage } from "./metering";
import type { Attempt } from "./provider";

// The router (docs/m3-plan.md slice 1): classifies each learner reply on the SERVER, so the
// pedagogy validator never reads labels a client sent. A cheap model in M3; a fake here.

export interface RouterRequest {
  text: string;
  history: SessionHistory;
  /** Whether Aili's last question is still open. */
  open_prompt: boolean;
  /** The choices of a prediction waiting for the learner's guess, if any. */
  prediction_choices?: string[];
  /** The turn's deadline (epoch ms), for a provider-backed router. */
  deadline_ms?: number;
  /** Called after every provider attempt (metering). A router that uses it returns no `usage`. */
  onAttempt?: (a: Attempt) => void;
}

export interface RouterReply {
  /** Raw output: validated with ReplyClassification before use. */
  classification: unknown;
  /** One usage for the whole call (the fake router). A provider-backed router reports attempts instead. */
  usage?: TokenUsage;
}

export interface Router {
  classify(req: RouterRequest, signal: AbortSignal): Promise<RouterReply>;
  /** Estimated input tokens for classifying `text`, for the worst-case check. */
  estimateInputTokens?(text: string): number;
}

/** Token counts the fake router reports per reply (counts only; prices come from config). */
export const FAKE_ROUTER_USAGE: TokenUsage = { model: "router", input_tokens: 300, output_tokens: 30 };

/**
 * FAKE ROUTER, for tests and the demo only. Fixed rules, not language understanding:
 * - answered_prompt: a question is open and the reply is not empty;
 * - pushback: the reply starts with "no", "but", "I disagree" or "that's wrong";
 * - new_evidence: pushback that mentions a source, a datasheet, a measurement or a calculation;
 * - frustrated: starts with "I don't know", "idk", "no idea" or "just tell me";
 * - wants_another_example: mentions "another example", "another analogy" or "different example";
 * - acknowledged: starts with "I understand", "I acknowledge", "understood" or "I accept";
 * - guess: for an open prediction, the choice whose text matches the reply exactly (any case);
 * - wants_stop: starts with "stop", "let's stop", "enough" or "please stop";
 * - asks_for_source: a title in quotes ("…" or “…”), else null.
 * `script` overrides the result for the n-th call, so tests can force any classification.
 */
export function createFakeRouter(opts: { usage?: TokenUsage; script?: Array<Partial<ReplyClassification> | "fail"> } = {}): Router & { calls: number } {
  const r = {
    calls: 0,
    async classify(req: RouterRequest): Promise<RouterReply> {
      const scripted = opts.script?.[r.calls];
      r.calls++;
      if (scripted === "fail") throw new Error("fake router failure (scripted)");
      const text = req.text.trim();
      const pushback = /^(no\b|but\b|i disagree|that'?s wrong|that is wrong)/i.test(text);
      const base: ReplyClassification = {
        answered_prompt: req.open_prompt && text.length > 0,
        pushback,
        new_evidence: pushback && /\b(source|datasheet|measured|measurement|calculated|calculation)\b/i.test(text),
        frustrated: /^(i don'?t know|idk|no idea|just tell me)/i.test(text),
        wants_another_example: /\b(another (example|analogy)|different example)\b/i.test(text),
        acknowledged: /^(i understand|i acknowledge|understood|i accept)/i.test(text),
        guess: req.prediction_choices?.find((c) => c.toLowerCase() === text.toLowerCase()) ?? null,
        wants_stop: /^(stop|let'?s stop|enough|please stop)\b/i.test(text),
        asks_for_source: /["\u201c]([^"\u201d]{2,120})["\u201d]/.exec(text)?.[1] ?? null,
      };
      return { classification: { ...base, ...scripted }, usage: opts.usage ?? FAKE_ROUTER_USAGE };
    },
  };
  return r;
}
