import type { AiConfig } from "@aili/schemas";
import { completeWithPolicy, ProviderError, type Attempt, type ProfessorProvider } from "./provider";
import { estimateTokens } from "./prompt";
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
    const estimatedInputTokens = estimateTokens(system) + estimateTokens(input + "\n\n" + (req.repair?.errors.join("\n") ?? ""));
    const repair = req.repair
      ? `\n\nYour previous answer failed these checks. Return a corrected answer that passes them:\n${req.repair.errors.map((e) => `- ${e}`).join("\n")}`
      : "";
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
