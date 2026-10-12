import type { AiConfig, DirectorResponse, RuntimeModel } from "@aili/schemas";
import { shortlist, type Registry } from "../capabilities";
import { InMemoryLedger, worstCaseTurnCost, type LedgerEntry } from "../metering";
import { PROMPT_BUDGET_TOKENS } from "../prompt";
import type { Router } from "../router";
import { ROUTER_INPUT_ALLOWANCE_TOKENS, TurnSession, type Director, type TurnEvent, type TurnFailure } from "../turn";
import type { Scenario, ScenarioExpect } from "./scenario";

// The bake-off runner (docs/m3-plan.md slice 7a). Runs scenarios turn by turn through the real
// TurnSession (router, director, validators, solvers, metering), and collects what the report needs.
// It does not know whether the providers are recorded or live: the caller builds them.
//
// Hard stops, checked before every turn: the run's cap (config bakeoff_cap_micro_usd) against
// everything spent so far + this turn's worst case; and, by default, any unexpected failure.

export interface CheckRecord {
  attempt: 1 | 2;
  outcome: "pass" | "validation" | "pedagogy";
  errors: string[];
  /** Semantic heuristics (never a rejection), for human review. */
  warnings: string[];
}

export interface TurnRecord {
  index: number;
  learner: string;
  events: TurnEvent[];
  latency_ms: number;
  /** "done", or the failure reason. */
  outcome: "done" | TurnFailure;
  move?: DirectorResponse["move"];
  response?: DirectorResponse;
  checks: CheckRecord[];
  /** Warnings on the answer that was shown (or the last one checked): never a rejection. */
  warnings: string[];
  /** Automatic expectations: each with its result. */
  expectations: Array<{ name: string; pass: boolean; detail: string }>;
  usage: LedgerEntry[];
  cost_micro_usd: number;
  unexpected: boolean;
}

export interface ScenarioRecord {
  scenario: Scenario;
  run: number;
  turns: TurnRecord[];
  cost_micro_usd: number;
  /** Why the scenario stopped early, if it did. */
  stopped?: string;
}

export interface RunDeps {
  registry: Registry;
  config: AiConfig;
  /**
   * A fresh director and router per scenario run (recorded providers replay per scenario). `spent`
   * is everything the run has spent so far, for a per-attempt cap guard (CapGuardProvider).
   */
  make: (scenario: Scenario, run: number, spent: () => number) => { director: Director; router: Router };
  live?: { hasKey: (m: RuntimeModel) => boolean };
  killSwitch?: () => boolean;
  timeoutMs?: number;
  /** Called after each turn (progress lines; the 7b smoke test shows the usage and the answer). */
  onTurn?: (s: Scenario, t: TurnRecord) => void;
  /** Stop the whole run at the first unexpected failure (default true). */
  stopOnUnexpected?: boolean;
  /** At most this many turns per scenario (the smoke test runs 1). */
  maxTurns?: number;
  today?: () => string;
  now?: () => number;
}

export interface RunResult {
  records: ScenarioRecord[];
  total_micro_usd: number;
  cap_micro_usd: number;
  /** Why the run stopped before the end, if it did. */
  stopped?: string;
}

function checkExpect(e: ScenarioExpect | undefined, t: Pick<TurnRecord, "outcome" | "move" | "response">): TurnRecord["expectations"] {
  const out: TurnRecord["expectations"] = [];
  if (e?.fails_with) {
    out.push({ name: "fails_with", pass: t.outcome === e.fails_with, detail: `expected failure ${e.fails_with}, got ${t.outcome}` });
    return out;
  }
  out.push({ name: "completes", pass: t.outcome === "done", detail: t.outcome === "done" ? "completed" : `failed: ${t.outcome}` });
  const r = t.response;
  if (!e || !r) return out;
  if (e.moves) out.push({ name: "moves", pass: e.moves.includes(r.move), detail: `move ${r.move}; expected one of ${e.moves.join(", ")}` });
  if (e.not_moves) out.push({ name: "not_moves", pass: !e.not_moves.includes(r.move), detail: `move ${r.move}; must not be ${e.not_moves.join(", ")}` });
  if (e.asks !== undefined) out.push({ name: "asks", pass: !!r.prompt === e.asks, detail: r.prompt ? "ends with a question" : "no question" });
  if (e.coverage) out.push({ name: "coverage", pass: r.coverage === e.coverage, detail: `coverage ${r.coverage ?? "(unset)"}` });
  if (e.safety) out.push({ name: "safety", pass: r.safety === true, detail: `safety ${r.safety}` });
  if (e.arm_weight) out.push({ name: "arm_weight", pass: mentionsArmWeight(r), detail: mentionsArmWeight(r) ? "the arm's own weight is accounted for" : "torque on an arm without the arm's own weight or the load's share" });
  if (e.reading) out.push({ name: "reading", pass: !!r.reading, detail: r.reading ? `reading ${JSON.stringify(r.reading)}` : "no reading" });
  return out;
}

const ARM_WEIGHT = /\barm['’]?s own (weight|mass)\b|\b(weight|mass) of the arm\b|\barm itself\b|\bload['’]?s share\b|\bshare of the (torque|load)\b|\bpayload['’]?s share\b/i;
/** Text says the arm's own weight counts (or asks only about the load's share), or a calculation includes the arm's mass. */
export function mentionsArmWeight(r: DirectorResponse): boolean {
  const text = [...r.narration.map((n) => n.text), r.prompt?.text ?? "", ...r.assumptions, ...r.limitations].join(" ");
  const calc = r.calc_requests.some((c) => Object.entries(c.inputs).some(([k, v]) => /^arm_.*kg/.test(k) && v > 0));
  return ARM_WEIGHT.test(text) || calc;
}

export async function runBakeoff(scenarios: Scenario[], runs: number, d: RunDeps): Promise<RunResult> {
  const ledger = new InMemoryLedger();
  const sessions: string[] = [];
  const spent = () => sessions.reduce((sum, id) => sum + ledger.spent(id), 0);
  const cap = d.config.bakeoff_cap_micro_usd;
  const now = d.now ?? Date.now;
  const records: ScenarioRecord[] = [];
  const stopOnUnexpected = d.stopOnUnexpected ?? true;

  for (let run = 1; run <= runs; run++)
    for (const scenario of scenarios) {
      const sessionId = `${scenario.id}#${run}`;
      sessions.push(sessionId);
      const { director, router } = d.make(scenario, run, spent);
      const checks: CheckRecord[] = [];
      const s = new TurnSession({
        registry: d.registry,
        director,
        router,
        state: { history: { posture: scenario.posture, learner_level: scenario.learner_level, entries: [] }, activeScene: scenario.active_scene },
        concepts: scenario.concepts,
        level: scenario.level,
        timeoutMs: d.timeoutMs,
        today: d.today,
        onCheck: (c) => checks.push(c),
        meter: { ledger, sessionId, config: d.config, killSwitch: d.killSwitch?.() ?? false, live: d.live },
      });
      let response: DirectorResponse | undefined;
      const record: ScenarioRecord = { scenario, run, turns: [], cost_micro_usd: 0 };
      records.push(record);
      const turns = scenario.turns.slice(0, d.maxTurns ?? scenario.turns.length);
      const sl = shortlist(d.registry, { concepts: scenario.concepts, level: scenario.level });
      for (const [index, turn] of turns.entries()) {
        // The run's hard cap: everything spent so far plus this turn's worst case must fit.
        // This turn's own prompt estimate (as the turn's session check uses); the prompt budget if the
        // director gives none. worstCaseTurnCost pads both by input_estimate_factor.
        const professorInputTokens =
          director.estimateInputTokens?.({ request_id: `turn_${index + 1}`, state_rev: 0, shortlist: sl, history: s.state.history, active_scene: s.state.activeScene, learner_text: turn.text }) ?? PROMPT_BUDGET_TOKENS;
        const worst = worstCaseTurnCost(d.config, { professorInputTokens, routerInputTokens: router.estimateInputTokens?.(turn.text) ?? ROUTER_INPUT_ALLOWANCE_TOKENS });
        if (spent() + worst > cap) {
          record.stopped = "bake-off cap";
          return { records, total_micro_usd: spent(), cap_micro_usd: cap, stopped: `bake-off cap: ${spent()} micro-USD spent + ${worst} worst case for the next turn would pass ${cap}` };
        }
        checks.length = 0;
        response = undefined;
        const before = ledger.entries(sessionId).length;
        const events: TurnEvent[] = [];
        const t0 = now();
        await s.run({ text: turn.text }, (e) => events.push(e));
        const latency_ms = now() - t0;
        const lastEvent = events.at(-1);
        const outcome = lastEvent?.type === "turn.done" ? "done" : lastEvent?.type === "turn.error" ? lastEvent.reason : "director";
        const passed = checks.find((c) => c.outcome === "pass") as (CheckRecord & { response?: DirectorResponse }) | undefined;
        response = outcome === "done" ? passed?.response : undefined;
        const usage = ledger.entries(sessionId).slice(before);
        const partial = { outcome, move: response?.move, response } as const;
        const expectations = checkExpect(turn.expect, partial);
        const unexpected = outcome !== "done" && turn.expect?.fails_with !== outcome;
        const tr: TurnRecord = {
          index: index + 1,
          learner: turn.text,
          events,
          latency_ms,
          ...partial,
          checks: checks.map(({ attempt, outcome, errors, warnings }) => ({ attempt, outcome, errors, warnings })),
          warnings: (passed ?? checks.at(-1))?.warnings ?? [],
          expectations,
          usage: [...usage],
          cost_micro_usd: usage.reduce((sum, e) => sum + e.cost_micro_usd, 0),
          unexpected,
        };
        record.turns.push(tr);
        record.cost_micro_usd += tr.cost_micro_usd;
        d.onTurn?.(scenario, tr);
        if (unexpected && stopOnUnexpected) {
          record.stopped = `unexpected failure: ${outcome}`;
          return { records, total_micro_usd: spent(), cap_micro_usd: cap, stopped: `unexpected failure in ${scenario.id} turn ${index + 1}: ${outcome}` };
        }
        if (unexpected) break; // this scenario cannot go on meaningfully
      }
    }
  return { records, total_micro_usd: spent(), cap_micro_usd: cap };
}
