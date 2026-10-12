import { z } from "zod";

// config/ai.json (M2 slice 7). Prices and caps live ONLY in that file; code reads them from here.
// Money is integer micro-USD (1 USD = 1,000,000 micro-USD), so no floating-point rounding.

const MicroUsd = z.number().int("must be a whole number of micro-USD").nonnegative("must not be negative");

const ModelPricing = z
  .object({
    /** Configuration, never hard-coded (CLAUDE.md). Null until a provider is chosen. */
    provider: z.string().min(1).nullable(),
    model: z.string().min(1).nullable(),
    /** The NAME of a server-only environment variable holding the key; never a key value. */
    api_key_env: z.string().regex(/^AILI_[A-Z0-9_]+_API_KEY$/, "api_key_env is a variable NAME like AILI_PROFESSOR_API_KEY, never a key"),
    /** The most output tokens one call may produce (also used for the worst-case spend check). */
    max_output_tokens: z.number().int().positive().max(16_000),
    /**
     * Optional request settings passed to the provider's adapter as they are (a thinking type and
     * an effort level). Unset: the provider's default. Thinking tokens count toward max_output_tokens.
     */
    thinking: z.enum(["adaptive", "between_tools", "disabled"]).optional(),
    effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
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
    /**
     * Recorded by Lucky after setting a monthly limit in the provider's dashboard. Null: live turns
     * are refused. Nobody but Lucky can confirm the dashboard; this field only records that Lucky did.
     */
    provider_monthly_limit_set: z
      .object({ by: z.string().min(1), on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "on is a date, YYYY-MM-DD"), usd: z.number().positive() })
      .strict()
      .nullable(),
    provider_monthly_limit_set_about: z.string().optional(),
    session_cap_micro_usd: MicroUsd.refine((n) => n > 0, "the session cap must be above 0"),
    session_cap_status: z.string().min(1),
  })
  .strict();
export type AiConfig = z.infer<typeof AiConfig>;
export type RuntimeModel = keyof AiConfig["models"];
