import type { AiConfig } from "@aili/schemas";
import { completeWithPolicy, ProviderError, type Attempt, type ProfessorProvider } from "./provider";
import { padEstimate } from "./metering";
import { NARRATION_MAX_CHARS, NARRATION_MAX_SEGMENTS } from "./director";
import { block, estimateTokens } from "./prompt";

/** The narration segment limit in words, for the repair message ("within the four segments"). */
const SEGMENTS = ["zero", "one", "two", "three", "four", "five", "six"][NARRATION_MAX_SEGMENTS] ?? String(NARRATION_MAX_SEGMENTS);
import { DirectorCallFailed, type Director, type DirectorReply, type DirectorRequest } from "./turn";

// A Director backed by a model provider (docs/m3-plan.md slice 2). Provider, model and the key's
// variable NAME come from config/ai.json; the key itself is read by the caller (server only) and
// only its presence is checked here. The prompt and output schema are passed in (slice 3 builds them).

export interface ProviderDirectorOptions {
  provider: ProfessorProvider;
  config: AiConfig;
  /** Whether a key is set for the professor model. Never returns or logs the value. */
  hasKey: () => boolean;
  prompt: (req: DirectorRequest) => { system: string; input: string };
  outputSchema: object;
  /** For tests: clock, pause and jitter. */
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
}

export class ProviderDirector implements Director {
  constructor(private readonly o: ProviderDirectorOptions) {}

  /** The assembled prompt's estimated size, for the worst-case check before the turn. */
  estimateInputTokens(req: Omit<DirectorRequest, "deadline_ms" | "repair">): number {
    const { system, input } = this.o.prompt({ ...req, deadline_ms: 0 });
    return estimateTokens(system) + estimateTokens(input);
  }

  async respond(req: DirectorRequest, signal: AbortSignal): Promise<DirectorReply> {
    const m = this.o.config.models.professor;
    if (!m.provider || !m.model || !this.o.hasKey()) throw new DirectorCallFailed("not_configured", []);
    const { system, input } = this.o.prompt(req);
    // Padded by config input_estimate_factor: the charge for an attempt that may be billed but reports nothing.
    // The repair shows the previous answer (as escaped DATA) and every error, so the model can keep the
    // content and change only what the errors name (Lucky's decision 2026-10-12).
    const repair = req.repair
      ? `\n\n${block("previous_answer", JSON.stringify(req.repair.previous))}\n\nYour previous answer (above) failed these checks. Keep its content and change only what these errors name. If you add anything, fit it within the ${SEGMENTS} segments (at most ${NARRATION_MAX_CHARS} characters each):\n${req.repair.errors.map((e) => `- ${e}`).join("\n")}`
      : "";
    const estimatedInputTokens = padEstimate(this.o.config, estimateTokens(system) + estimateTokens(input + repair));
    const attempts: Attempt[] = [];
    try {
      const r = await completeWithPolicy(
        this.o.provider,
        { system, input: input + repair, outputSchema: this.o.outputSchema, maxOutputTokens: m.max_output_tokens, signal },
        { deadlineMs: req.deadline_ms, attemptTimeoutMs: this.o.config.attempt_timeout_ms, onAttempt: (a) => (attempts.push(a), req.onAttempt?.(a)), model: "professor", estimatedInputTokens, now: this.o.now, sleep: this.o.sleep, random: this.o.random },
      );
      return { response: r.json, attempts };
    } catch (err) {
      // Only the kind travels on: never a response body or a key.
      throw new DirectorCallFailed(err instanceof ProviderError ? err.kind : "network", attempts);
    }
  }
}
