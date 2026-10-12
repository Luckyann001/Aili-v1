import type { AiConfig, RuntimeModel } from "@aili/schemas";
import { costMicroUsd } from "../metering";
import { estimateTokens } from "../prompt";
import { ProviderError, type CompletionRequest, type CompletionResult, type ProfessorProvider } from "../provider";

// A hard stop before EVERY provider attempt in a bake-off (retries and repairs included): what the
// run has spent plus this attempt's worst case (estimated input + max output, at config prices) must
// fit the cap. The pre-turn check counts two attempts; this guard also covers transport retries.
// A blocked attempt is never sent and fails as "spend_limit", which stops the run as unexpected.

export class CapGuardProvider implements ProfessorProvider {
  constructor(
    private readonly inner: ProfessorProvider,
    private readonly o: { config: AiConfig; model: RuntimeModel; spent: () => number; capMicroUsd: number; onBlock?: (detail: string) => void },
  ) {}

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const worst = costMicroUsd({ model: this.o.model, input_tokens: estimateTokens(req.system) + estimateTokens(req.input), output_tokens: req.maxOutputTokens }, this.o.config);
    const spent = this.o.spent();
    if (spent + worst > this.o.capMicroUsd) {
      this.o.onBlock?.(`${this.o.model} attempt not sent: ${spent} micro-USD spent + ${worst} worst case would pass the cap of ${this.o.capMicroUsd}`);
      throw new ProviderError("spend_limit");
    }
    return this.inner.complete(req);
  }
}
