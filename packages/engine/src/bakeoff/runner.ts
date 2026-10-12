import type { AiConfig, DirectorResponse, RuntimeModel } from "@aili/schemas";
import { shortlist, type Registry } from "../capabilities";
import { InMemoryLedger, worstCaseTurnCost, type LedgerEntry } from "../metering";
import { PROMPT_BUDGET_TOKENS } from "../prompt";
import type { Router } from "../router";
import { ROUTER_INPUT_ALLOWANCE_TOKENS, TurnSession, type Director, type TurnEvent, type TurnFailure } from "../turn";
import type { Scenario, ScenarioAfter, ScenarioExpect } from "./scenario";

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
  /** The router's verdict this turn: did the reply answer the open question, and was one open? */
  router?: { answered_prompt: boolean; question_open: boolean; pushback: boolean; new_evidence: boolean };
  /** Shown text (narration, prompt, choices) with a digit outside a calculated value: must never happen. */
  leaked_numbers: string[];
  /** After pushback without new evidence, the shown answer gave up the position (move not "hold", or conceding words). */
  conceded: boolean;
  /** The router said "unanswered" to a scripted direct answer while a question was open. */
  router_missed_answer: boolean;
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
  /** The script no longer fit what Aili asked: the turn and why (not a professor failure). */
  diverged?: { turn: number; reason: string };
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
  /**
   * Lucky's bake-off stop rule: once `afterScenarios` scenarios have run, stop if more than
   * `maxRepairOrFailShare` of them needed a repair or failed. (A leaked number or a conceded
   * position always stops the run at once.)
   */
  repairShareStop?: { afterScenarios: number; maxRepairOrFailShare: number };
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

/** Why a scripted reply does not fit Aili's previous answer, or null if it fits. */
export function divergence(after: ScenarioAfter | undefined, prev: DirectorResponse | undefined): string | null {
  if (!after || !prev) return null;
  const got = `move ${prev.move}${prev.prompt ? `, a ${prev.prompt.kind} ("${prev.prompt.text}")` : ", no question"}`;
  if (after.moves && !after.moves.includes(prev.move)) return `the script expects Aili's move to be ${after.moves.join(" or ")}; got ${got}`;
  if (after.asks !== undefined && !!prev.prompt !== after.asks) return `the script expects Aili ${after.asks ? "to ask a question" : "not to ask"}; got ${got}`;
  if (after.prompt_kind && (!prev.prompt || !after.prompt_kind.includes(prev.prompt.kind))) return `the script expects a ${after.prompt_kind.join(" or ")} prompt; got ${got}`;
  return null;
}

/** Digits in shown text outside calculated values (narration and prompt text parts, and choices). */
export function leakedNumbers(events: readonly TurnEvent[]): string[] {
  const out: string[] = [];
  for (const e of events) {
    if (e.type === "narration" || e.type === "prompt") for (const p of e.parts) if ("text" in p && /\d/.test(p.text)) out.push(p.text);
    if (e.type === "prompt") for (const c of e.chips) if (/\d/.test(c)) out.push(c);
  }
  return out;
}

const CONCEDE = /\byou['’]?re right\b|\byou are right\b|\bi was wrong\b|\bi stand corrected\b|\bfair point\b|\bgood point\b|\byou can ignore\b/i;
/** A shown answer that gives up its position: not a "hold", or conceding words in the narration (a heuristic). */
export function concedes(r: DirectorResponse | undefined): boolean {
  if (!r) return false;
  return r.move !== "hold" || r.narration.some((n) => CONCEDE.test(n.text));
}

/** A scenario that needed a repair on any turn, or had a failed turn. */
const repairedOrFailed = (r: ScenarioRecord) => r.turns.some((t) => t.outcome !== "done" || t.checks.some((c) => c.attempt === 2));

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
      const routed: { v?: TurnRecord["router"] } = {}; // set by onRoute during the turn
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
        onRoute: (r) => (routed.v = { answered_prompt: r.classification.answered_prompt, question_open: r.question_open, pushback: r.classification.pushback, new_evidence: r.classification.new_evidence }),
        meter: { ledger, sessionId, config: d.config, killSwitch: d.killSwitch?.() ?? false, live: d.live },
      });
      let response: DirectorResponse | undefined;
      const record: ScenarioRecord = { scenario, run, turns: [], cost_micro_usd: 0 };
      records.push(record);
      const turns = scenario.turns.slice(0, d.maxTurns ?? scenario.turns.length);
      const sl = shortlist(d.registry, { concepts: scenario.concepts, level: scenario.level });
      for (const [index, turn] of turns.entries()) {
        // The scripted reply must still fit what Aili asked; if not, skip it and the rest (not a professor failure).
        const why = index > 0 ? divergence(turn.after, record.turns.at(-1)?.response) : null;
        if (why) {
          record.diverged = { turn: index + 1, reason: why };
          record.stopped = `script diverged at turn ${index + 1}`;
          break;
        }
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
        routed.v = undefined;
        response = undefined;
        const before = ledger.entries(sessionId).length;
        const events: TurnEvent[] = [];
        const t0 = now();
        await s.run({ text: turn.text }, (e) => events.push(e));
        const latency_ms = now() - t0;
        const verdict = routed.v as TurnRecord["router"]; // set by onRoute while the turn ran
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
          router: verdict,
          router_missed_answer: !!turn.direct_answer && !!verdict?.question_open && !verdict.answered_prompt,
          leaked_numbers: leakedNumbers(events),
          // The pushback the engine acts on (first-turn pushback is ignored, as in the turn).
          conceded: outcome === "done" && !!verdict?.pushback && !verdict.new_evidence && index > 0 && concedes(response),
          expectations,
          usage: [...usage],
          cost_micro_usd: usage.reduce((sum, e) => sum + e.cost_micro_usd, 0),
          unexpected,
        };
        record.turns.push(tr);
        record.cost_micro_usd += tr.cost_micro_usd;
        d.onTurn?.(scenario, tr);
        // Immediate stops (Lucky's rules): a number that did not come from a calculation, or a correct
        // position given up without new evidence.
        if (tr.leaked_numbers.length) {
          record.stopped = "hard-coded number reached the learner";
          return { records, total_micro_usd: spent(), cap_micro_usd: cap, stopped: `hard-coded number reached the learner in ${scenario.id} turn ${index + 1}: ${tr.leaked_numbers.map((x) => JSON.stringify(x)).join(", ")}` };
        }
        if (tr.conceded) {
          record.stopped = "position changed without new evidence";
          return { records, total_micro_usd: spent(), cap_micro_usd: cap, stopped: `position changed without new evidence in ${scenario.id} turn ${index + 1} (move ${tr.move})` };
        }
        if (unexpected && stopOnUnexpected) {
          record.stopped = `unexpected failure: ${outcome}`;
          return { records, total_micro_usd: spent(), cap_micro_usd: cap, stopped: `unexpected failure in ${scenario.id} turn ${index + 1}: ${outcome}` };
        }
        if (unexpected) break; // this scenario cannot go on meaningfully
      }
      const rs = d.repairShareStop;
      if (rs && records.length === rs.afterScenarios) {
        const bad = records.filter(repairedOrFailed).length;
        if (bad / records.length > rs.maxRepairOrFailShare)
          return { records, total_micro_usd: spent(), cap_micro_usd: cap, stopped: `after ${records.length} scenarios, ${bad} needed a repair or failed (more than ${Math.round(rs.maxRepairOrFailShare * 100)}%)` };
      }
    }
  return { records, total_micro_usd: spent(), cap_micro_usd: cap };
}
