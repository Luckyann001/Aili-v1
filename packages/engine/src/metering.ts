import type { AiConfig, RuntimeModel } from "@aili/schemas";

// Metering, the per-session cost cap and the kill switch (M2 slice 7; billing doc §5.2).
// Money is integer micro-USD. Prices come only from config (config/ai.json, validated with
// AiConfig); nothing here contains a price. The ledger is an interface; the only implementation
// is in memory, so it is lost on restart and is per server instance. Per-user and global caps
// need the database (deferred stage).

const MILLION = BigInt(1_000_000);

export interface TokenUsage {
  model: RuntimeModel;
  input_tokens: number;
  output_tokens: number;
}

export interface LedgerEntry extends TokenUsage {
  turn_id: string;
  cost_micro_usd: number;
}

/**
 * Cost of one call in integer micro-USD: tokens × price per million, divided by a million, rounded
 * UP for each direction separately (a cap must never be passed by rounding down).
 */
export function costMicroUsd(usage: TokenUsage, config: AiConfig): number {
  const price = config.models[usage.model].price_micro_usd_per_million_tokens;
  for (const [name, n] of [["input_tokens", usage.input_tokens], ["output_tokens", usage.output_tokens]] as const)
    if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`${name} must be a whole number of tokens, 0 or more`);
  const part = (tokens: number, perMillion: number) => {
    const product = BigInt(tokens) * BigInt(perMillion);
    return Number((product + MILLION - BigInt(1)) / MILLION); // exact integer ceiling
  };
  return part(usage.input_tokens, price.input) + part(usage.output_tokens, price.output);
}

/** Where usage is recorded. In memory now; a database-backed ledger replaces it later. */
export interface Ledger {
  record(sessionId: string, entry: LedgerEntry): void;
  spent(sessionId: string): number;
  entries(sessionId: string): readonly LedgerEntry[];
}

export class InMemoryLedger implements Ledger {
  private readonly bySession = new Map<string, LedgerEntry[]>();
  record(sessionId: string, entry: LedgerEntry): void {
    const list = this.bySession.get(sessionId) ?? [];
    list.push(entry);
    this.bySession.set(sessionId, list);
  }
  spent(sessionId: string): number {
    return (this.bySession.get(sessionId) ?? []).reduce((sum, e) => sum + e.cost_micro_usd, 0);
  }
  entries(sessionId: string): readonly LedgerEntry[] {
    return this.bySession.get(sessionId) ?? [];
  }
}

export type Refusal = "kill_switch" | "not_configured" | "limit_not_recorded" | "session_cap";

/**
 * Attempts counted in the worst case: the first answer and the one repair (Lucky's slice 4 rule).
 * Note: a transport retry inside either call could add a third or fourth; those are metered as
 * they happen, so the ledger stays right, but the pre-turn check counts two.
 */
export const WORST_CASE_ATTEMPTS = 2;

/** The most a turn can cost in micro-USD: both models, each at its max output, times the attempts. */
export function worstCaseTurnCost(config: AiConfig, est: { professorInputTokens: number; routerInputTokens: number }): number {
  const one = (model: RuntimeModel, input: number) => costMicroUsd({ model, input_tokens: input, output_tokens: config.models[model].max_output_tokens }, config);
  return WORST_CASE_ATTEMPTS * (one("professor", est.professorInputTokens) + one("router", est.routerInputTokens));
}

/** Whether the key for `model` is set. Only presence is checked; the value never leaves here. */
export function keyPresent(config: AiConfig, model: RuntimeModel, env: Record<string, string | undefined>): boolean {
  const v = env[config.models[model].api_key_env];
  return typeof v === "string" && v.trim().length > 0;
}

export interface RefuseOptions {
  killSwitch: boolean;
  ledger: Ledger;
  sessionId: string;
  config: AiConfig;
  /** Estimated input tokens for this turn (the assembled prompt, the router's input). */
  estimate: { professorInputTokens: number; routerInputTokens: number };
  /** Live (real-model) turns only: whether each model's key is set. */
  live?: { hasKey: (model: RuntimeModel) => boolean };
}

/**
 * Checked before any AI call in a turn, in this order: the kill switch; for live turns, a
 * provider, model and key for both models, then the provider-limit record; then the worst case
 * (cost so far + this turn's worst case) against this session's cap.
 */
export function refuseTurn(o: RefuseOptions): { reason: Refusal; detail: string } | null {
  if (o.killSwitch) return { reason: "kill_switch", detail: "AILI_AI_KILL_SWITCH=1" };
  if (o.live) {
    for (const model of ["router", "professor"] as const) {
      const m = o.config.models[model];
      if (!m.provider || !m.model) return { reason: "not_configured", detail: `${model}: no provider or model in config` };
      if (!o.live.hasKey(model)) return { reason: "not_configured", detail: `${model}: ${m.api_key_env} is not set` };
    }
    if (!o.config.provider_monthly_limit_set) return { reason: "limit_not_recorded", detail: "provider_monthly_limit_set is empty in config/ai.json" };
  }
  const spent = o.ledger.spent(o.sessionId);
  const worst = worstCaseTurnCost(o.config, o.estimate);
  if (spent + worst > o.config.session_cap_micro_usd)
    return { reason: "session_cap", detail: `spent ${spent} + worst case ${worst} > cap ${o.config.session_cap_micro_usd} micro-USD` };
  return null;
}

/** Server-only: AILI_AI_KILL_SWITCH=1 in the host settings refuses every AI turn. */
export const killSwitchFromEnv = (env: Record<string, string | undefined>) => env.AILI_AI_KILL_SWITCH === "1";
