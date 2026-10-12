import { z } from "zod";

// config/ai.json (M2 slice 7). Prices and caps live ONLY in that file; code reads them from here.
// Money is integer micro-USD (1 USD = 1,000,000 micro-USD), so no floating-point rounding.

const MicroUsd = z.number().int("must be a whole number of micro-USD").nonnegative("must not be negative");

const ModelPricing = z
  .object({
    /** Configuration, never hard-coded (CLAUDE.md). Null until a provider is chosen. */
    provider: z.string().min(1).nullable(),
    model: z.string().min(1).nullable(),
    price_micro_usd_per_million_tokens: z.object({ input: MicroUsd, output: MicroUsd }).strict(),
    pricing_status: z.string().min(1),
  })
  .strict();

export const AiConfig = z
  .object({
    _about: z.string().optional(),
    currency: z.literal("USD"),
    /** At most two runtime models (CLAUDE.md): the professor and a cheap router. */
    models: z.object({ professor: ModelPricing, router: ModelPricing }).strict(),
    voice: z.object({ micro_usd_per_second: MicroUsd, status: z.string().min(1) }).strict(),
    hosting: z.object({ micro_usd_per_turn: MicroUsd, status: z.string().min(1) }).strict(),
    session_cap_micro_usd: MicroUsd.refine((n) => n > 0, "the session cap must be above 0"),
    session_cap_status: z.string().min(1),
  })
  .strict();
export type AiConfig = z.infer<typeof AiConfig>;
export type RuntimeModel = keyof AiConfig["models"];
