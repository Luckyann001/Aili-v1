import type { AiConfig, RuntimeModel } from "@aili/schemas";
import { ProviderError, type ProfessorProvider } from "../provider";
import { AnthropicProvider, type AnthropicProviderOptions } from "./anthropic";

// Picks the adapter named by config/ai.json (models.<model>.provider). Provider names live only in
// this folder. An unknown or missing provider gives an adapter that answers "not_configured".

export function createProfessorProvider(
  config: AiConfig,
  model: RuntimeModel,
  env: () => Record<string, string | undefined>,
  opts: Pick<AnthropicProviderOptions, "baseUrl" | "fetchImpl" | "now" | "onDiagnostic"> = {},
): ProfessorProvider {
  switch (config.models[model].provider) {
    case "anthropic":
      return new AnthropicProvider({ config, model, env, ...opts });
    default:
      return { complete: async () => Promise.reject(new ProviderError("not_configured")) };
  }
}

export { AnthropicProvider, ANTHROPIC_VERSION, scrubProviderMessage, type AnthropicDiagnostic, type AnthropicProviderOptions } from "./anthropic";
export { toAnthropicSchema, fromAnthropicShape, type ReducedSchema } from "./anthropicSchema";
