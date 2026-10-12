import type { RuntimeModel } from "@aili/schemas";
import { ProviderError, kindOfStatus, type CompletionRequest, type CompletionResult, type ProfessorProvider } from "./provider";

// Replays stored provider responses, so CI needs no key and no network (docs/m3-plan.md slice 2).
// Each call takes the next step. Hand-written steps are labelled as such; recordings from a real
// model arrive in slice 7 and are reviewed before they are stored.

export type RecordedStep =
  | { ok: { json: unknown; input_tokens: number; output_tokens: number; latency_ms?: number } }
  | { status: number }
  | { network_error: true }
  /** Never answers until aborted (a hung connection). */
  | { hang: true };

export interface Recording {
  /** Where the steps came from: "hand-written" until real recordings exist. */
  source: string;
  steps: RecordedStep[];
}

export class RecordedProvider implements ProfessorProvider {
  /** Every request received, so tests can check what was sent (for example a repair's errors). */
  readonly requests: Array<Omit<CompletionRequest, "signal">> = [];
  private next = 0;

  constructor(
    private readonly recording: Recording,
    private readonly model: RuntimeModel = "professor",
  ) {}

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const { signal, ...rest } = req;
    this.requests.push(rest);
    const step = this.recording.steps[this.next++];
    if (!step) throw new Error(`recording "${this.recording.source}" has no step ${this.next}`);
    const wait = (ms: number) =>
      new Promise<void>((resolve, reject) => {
        if (signal.aborted) return reject(new ProviderError("aborted"));
        const t = ms === Infinity ? undefined : setTimeout(resolve, ms);
        signal.addEventListener("abort", () => (clearTimeout(t), reject(new ProviderError("aborted"))), { once: true });
      });
    if ("hang" in step) {
      await wait(Infinity);
      throw new ProviderError("aborted");
    }
    if ("network_error" in step) throw new ProviderError("network");
    if ("status" in step) throw new ProviderError(kindOfStatus(step.status), step.status);
    await wait(step.ok.latency_ms ?? 0);
    return {
      json: step.ok.json,
      usage: { model: this.model, input_tokens: step.ok.input_tokens, output_tokens: step.ok.output_tokens },
      latencyMs: step.ok.latency_ms ?? 0,
    };
  }
}
