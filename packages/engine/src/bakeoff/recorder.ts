import { ProviderError, type CompletionRequest, type CompletionResult, type ProfessorProvider } from "../provider";
import type { RecordedStep } from "../recordedProvider";

// Wraps a provider and keeps what it answered as RecordedProvider steps, so a live bake-off can be
// saved, reviewed by Lucky, and only then kept as a recording for CI (never kept automatically).
// It stores the parsed answer and token counts only: never the request, a header or a key.

export class RecordingProvider implements ProfessorProvider {
  readonly steps: RecordedStep[] = [];
  constructor(private readonly inner: ProfessorProvider) {}

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    try {
      const r = await this.inner.complete(req);
      this.steps.push({ ok: { json: r.json, input_tokens: r.usage?.input_tokens ?? 0, output_tokens: r.usage?.output_tokens ?? 0, latency_ms: r.latencyMs } });
      return r;
    } catch (err) {
      const kind = err instanceof ProviderError ? err.kind : "network";
      if (err instanceof ProviderError && err.status !== undefined) this.steps.push({ status: err.status });
      else if (kind === "unreachable") this.steps.push({ unreachable: true });
      else if (kind === "timeout" || kind === "aborted") this.steps.push({ hang: true });
      else this.steps.push({ network_error: true });
      throw err;
    }
  }
}
