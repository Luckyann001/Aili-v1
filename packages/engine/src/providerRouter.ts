import { ReplyClassification, type AiConfig } from "@aili/schemas";
import { z } from "zod";
import { completeWithPolicy, ProviderError, type ProfessorProvider } from "./provider";
import { block, estimateTokens, systemPrompt } from "./prompt";
import type { Router, RouterReply, RouterRequest } from "./router";

// A Router backed by a model provider (docs/m3-plan.md slice 7a): the router model from
// config/ai.json, the same adapters and retry rules as the director. Classification output only.
// The fake router stays for CI and the demo. Every attempt is metered through req.onAttempt.

/** The JSON Schema the router's structured output must follow (our Zod schema still validates it). */
export const routerJsonSchema = (): object => z.toJSONSchema(ReplyClassification, { io: "output" });

/** The router's prompt: the template's system prompt, and two DATA blocks. */
export function assembleRouterPrompt(template: string, req: Pick<RouterRequest, "text" | "history" | "open_prompt" | "prediction_choices">): { system: string; input: string } {
  const lastMoves = req.history.entries.filter((e) => e.kind === "aili").slice(-3).map((e) => e.move);
  const state = {
    posture: req.history.posture,
    question_open: req.open_prompt,
    open_prediction_choices: req.prediction_choices ?? null,
    last_moves: lastMoves,
  };
  return { system: systemPrompt(template), input: [block("session_state", JSON.stringify(state)), block("learner_input", req.text)].join("\n\n") };
}

export interface ProviderRouterOptions {
  provider: ProfessorProvider;
  config: AiConfig;
  /** Whether a key is set for the router model. Never returns or logs the value. */
  hasKey: () => boolean;
  /** content/prompts/router.v1.md */
  template: string;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
}

export class ProviderRouter implements Router {
  private readonly schema = routerJsonSchema();
  constructor(private readonly o: ProviderRouterOptions) {}

  estimateInputTokens(text: string): number {
    const { system, input } = assembleRouterPrompt(this.o.template, { text, history: { posture: "learning", learner_level: "some_knowledge", entries: [] }, open_prompt: true });
    return estimateTokens(system) + estimateTokens(input) + 100; // + room for the session state
  }

  async classify(req: RouterRequest, signal: AbortSignal): Promise<RouterReply> {
    const m = this.o.config.models.router;
    if (!m.provider || !m.model || !this.o.hasKey()) throw new ProviderError("not_configured");
    const { system, input } = assembleRouterPrompt(this.o.template, req);
    const now = this.o.now ?? Date.now;
    const r = await completeWithPolicy(
      this.o.provider,
      { system, input, outputSchema: this.schema, maxOutputTokens: m.max_output_tokens, signal },
      {
        deadlineMs: req.deadline_ms ?? now() + 20_000,
        onAttempt: (a) => req.onAttempt?.(a),
        model: "router",
        estimatedInputTokens: estimateTokens(system) + estimateTokens(input),
        now: this.o.now,
        sleep: this.o.sleep,
        random: this.o.random,
      },
    );
    // Usage was reported per attempt (onAttempt), so none is returned here.
    return { classification: r.json };
  }
}
