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

export type Refusal = "kill_switch" | "session_cap";

/** Checked before any AI turn starts: the kill switch first, then this session's cap. */
export function refuseTurn(opts: { killSwitch: boolean; ledger: Ledger; sessionId: string; config: AiConfig }): Refusal | null {
  if (opts.killSwitch) return "kill_switch";
  if (opts.ledger.spent(opts.sessionId) >= opts.config.session_cap_micro_usd) return "session_cap";
  return null;
}

/** Server-only: AILI_AI_KILL_SWITCH=1 in the host settings refuses every AI turn. */
export const killSwitchFromEnv = (env: Record<string, string | undefined>) => env.AILI_AI_KILL_SWITCH === "1";
