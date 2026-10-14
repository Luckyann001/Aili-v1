import type { DirectorResponse, SessionHistory } from "@aili/schemas";
import { staticTorqueSingleLink } from "@aili/solvers";
import type { Registry, Shortlist } from "./capabilities";
import { shortlist } from "./capabilities";
import { dropStrayActionFields, NARRATION_SPLIT_MAX_SEGMENTS, splitLongNarration, substituteGuideQuestion, validateDirectorResponse } from "./director";
import { givesBack, reoffersOpenQuestion, validatePedagogy } from "./pedagogy";
import { ReplyClassification, type AiConfig, type RuntimeModel, type TeachingState } from "@aili/schemas";
import { applyLearnerReply, applyResponse, fillTeachBackReading, OPEN_QUESTION_REOFFERED, selectSceneForConcept } from "./teaching";
import { PROMPT_BUDGET_TOKENS } from "./prompt";
import { createFakeRouter, type Router, type RouterReply, type RouterRequest } from "./router";
import { ProviderError, type Attempt, type ProviderErrorKind } from "./provider";
import { openPrompt } from "./pedagogy";
import { costMicroUsd, refuseTurn, type Ledger, type TokenUsage } from "./metering";
import { explainTurn, type TurnExplanation } from "./explanation";

// One turn, end to end (docs/m2-plan.md slice 5):
//   shortlist → director → validateDirectorResponse → validatePedagogy → solver → compile → events.
// Everything that can fail runs BEFORE any content event is emitted, so a failure never leaves
// partial actions on the stage: the client sees turn.started, then either the whole turn or a
// turn.error, and the session keeps its last valid state.
// Stale events: a new turn or an interrupt bumps the revision; an event from an older revision is
// dropped here and never reaches the client. (The client's own gate drops late ones again.)
// No provider, no key, no network: the director is an interface; M2 uses a scripted fake.

export type TurnEvent = { turn_id: string; seq: number; rev: number } & (
  | { type: "turn.started" }
  | { type: "narration"; id: string; text: string; parts: TextPart[] }
  | { type: "action"; action: DirectorResponse["actions"][number] }
  | { type: "calc.result"; calc_id: string; outputs: Record<string, number> }
  | { type: "prompt"; text: string; parts: TextPart[]; chips: string[] }
  /** The move, and what the text panel shows for this turn (labelled values and titles; no IDs). */
  | { type: "turn.done"; move: DirectorResponse["move"]; explanation: TurnExplanation }
  | { type: "turn.error"; reason: TurnFailure; message: string; details: string[] }
);

/**
 * Learner-facing text split so the client can mark calculated values (behavior spec A10: a
 * calculated result looks different from an explanation). `text` stays the plain sentence for speech.
 */
export type TextPart = { text: string } | { value: string; calc_id: string; output: string };

export type TurnFailure = "spend_limit" | "refused" | "limit_not_recorded" | "not_configured" | "key_rejected" | "router" | "director" | "timeout" | "validation" | "pedagogy" | "solver" | "kill_switch" | "session_cap";

/** Plain words for the learner. Details go to the event's `details` for developers and logs. */
export const FAILURE_MESSAGES: Record<TurnFailure, string> = {
  spend_limit: "The monthly spending limit for live answers has been reached. Prepared lessons still work. Nothing on the stage changed.",
  refused: "The AI model declined to answer this. Prepared lessons still work. Nothing on the stage changed.",
  limit_not_recorded: "Live answers are off until a monthly spending limit is set with the AI provider and recorded. Prepared lessons still work. Nothing on the stage changed.",
  not_configured: "Live answers aren't set up on this computer. Prepared lessons still work. Nothing on the stage changed.",
  key_rejected: "The AI provider didn't accept the key set up on this computer. Prepared lessons still work. Nothing on the stage changed.",
  router: "Aili couldn't make sense of that reply this time. Nothing on the stage changed.",
  director: "Aili couldn't prepare an answer this time. Nothing on the stage changed.",
  timeout: "Aili took too long to answer, so the turn was stopped. Nothing on the stage changed.",
  validation: "Aili's answer didn't pass its checks, so it wasn't shown. Nothing on the stage changed.",
  pedagogy: "Aili's answer broke a teaching rule, so it wasn't shown. Nothing on the stage changed.",
  solver: "A calculation couldn't run, so nothing was shown. Nothing on the stage changed.",
  kill_switch: "Aili's live answers are switched off right now. Prepared lessons still work. Nothing on the stage changed.",
  session_cap: "This session has reached its limit for live answers. Prepared lessons still work. Nothing on the stage changed.",
};

export interface DirectorRequest {
  request_id: string;
  state_rev: number;
  shortlist: Shortlist;
  history: SessionHistory;
  active_scene?: string;
  learner_text: string;
  /** The turn's deadline (epoch ms); a provider-backed director retries only within it. */
  deadline_ms: number;
  /** Set on the one repair attempt: the previous answer and why it failed the checks. */
  repair?: { errors: string[]; previous: unknown };
  /** The teaching state after the learner's reply (open predictions, open items, waivers, the last prompt). */
  teaching?: TeachingState;
  /** The router flagged that the learner wants a direct answer this turn (shown to the director). */
  direct_answer?: boolean;
  /**
   * Called as each provider attempt ends, so it is metered even if the turn has already timed out
   * or been interrupted (the provider may still bill it).
   */
  onAttempt?: (a: Attempt) => void;
}

/** What a director call returns: the raw response (validated here) and the tokens it used. */
export interface DirectorReply {
  response: unknown;
  /** Tokens for a single call (the fake director). */
  usage?: TokenUsage;
  /** Every provider attempt, retries included, for metering (a provider-backed director). */
  attempts?: Attempt[];
}

/** A director call that failed, with the attempts it made (they are metered too). */
export class DirectorCallFailed extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    readonly attempts: Attempt[],
  ) {
    super(`director: ${kind}`);
    this.name = "DirectorCallFailed";
  }
}

/** The professor model in M3; a scripted fake in M2. */
export interface Director {
  respond(req: DirectorRequest, signal: AbortSignal): Promise<DirectorReply>;
  /** Estimated input tokens for this request (the assembled prompt), for the worst-case check. */
  estimateInputTokens?(req: Omit<DirectorRequest, "deadline_ms" | "repair">): number;
}

/** Assumed router input when the router gives no estimate (its prompt is small; slice 6 measures it). */
export const ROUTER_INPUT_ALLOWANCE_TOKENS = 1000;
/** The pushback the engine acts on: not on a first turn, and never when the reply is a guess on a prediction. */
export function effectivePushback(c: Pick<ReplyClassification, "pushback" | "guess">, history: SessionHistory): boolean {
  return c.pushback && c.guess === null && history.entries.some((e) => e.kind === "aili");
}

/** Lowercase, punctuation removed, spaces collapsed: "It gets easier!" and "it gets easier" match. */
const normalizeChoice = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();

/**
 * A reply that is exactly one of the open prompt's choices (ignoring case and punctuation) IS that
 * choice: answered, a guess, and never frustration or pushback, whatever the router read into it
 * (Lucky's decision 2026-10-13, after "Easier" was read as "make it simpler").
 */
export function matchOpenChoice(c: ReplyClassification, text: string, choices: readonly string[] | undefined): ReplyClassification {
  const said = normalizeChoice(text);
  const choice = said ? choices?.find((ch) => normalizeChoice(ch) === said) : undefined;
  return choice === undefined ? c : { ...c, answered_prompt: true, guess: choice, frustrated: false, pushback: false };
}

/** The open prompt's text, kind and choices, when the stored last prompt is the one still open. */
function openQuestion(s: SessionState): RouterRequest["open_question"] {
  const open = openPrompt(s.history);
  const last = s.teaching?.last_prompt;
  return open && last && last.turn === open.turn ? { text: last.text, kind: last.kind, choices: last.chips } : undefined;
}

/** Router failures shown to the learner under their own reason (others become "router"). */
const ROUTER_KINDS: ReadonlySet<ProviderErrorKind> = new Set(["not_configured", "key_rejected", "spend_limit", "refused"]);

/** A solver as the pipeline calls it: unit-named inputs in, unit-named numeric outputs out. */
export type SolverFn = (inputs: Record<string, number>) => Record<string, number>;

const singleLink: SolverFn = (inputs) => {
  const r = staticTorqueSingleLink(inputs as unknown as Parameters<typeof staticTorqueSingleLink>[0]);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(r)) if (typeof v === "number") out[k] = v;
  return out;
};

/** Solver implementations by registry ID. Test-fixture copies point at the same code. */
export const SOLVERS: Record<string, SolverFn> = {
  "solver.static-torque-single-link": singleLink,
  "solver.fx-torque": singleLink,
};

/** The state a session keeps between turns; replaced only when a turn completes. */
export interface SessionState {
  history: SessionHistory;
  activeScene?: string;
  /** Predictions, open items, waivers and analogies used (slice 5a). Absent means all empty. */
  teaching?: TeachingState;
}

const EMPTY_TEACHING: TeachingState = { predictions: [], open_items: [], waivers: [], analogies_used: [], safety_acks: [], pending_teach_back: null, evidence: [], debate: { active: false, rounds: 0 } };

/** What the learner sent. How to read it (answered, pushback, evidence) is decided by the router. */
export interface LearnerInput {
  text: string;
}


export interface TurnSessionOptions {
  registry: Registry;
  director: Director;
  state: SessionState;
  concepts: readonly string[];
  level: "L1" | "L2" | "L3";
  solvers?: Record<string, SolverFn>;
  /** The whole turn's budget. Default: config turn_timeout_ms when metered, else 20 s. */
  timeoutMs?: number;
  /**
   * The revision before this session's first turn. A stateless server passes the client's revision
   * minus one, so the turn's events carry the revision the client's gate expects.
   */
  startRev?: number;
  /** Classifies the learner's reply on the server. Defaults to the fake router (tests, demo). */
  router?: Router;
  /** Today's date as YYYY-MM-DD (waiver acknowledgements); a clock for tests. */
  today?: () => string;
  /**
   * Observes each check of a director answer (the bake-off's first-try and after-repair pass rates):
   * attempt 1 is the first answer, attempt 2 the repair. On a pass, the validated response.
   */
  /** Observes the router's validated classification each turn, and whether a question was open (bake-off logs). */
  onRoute?: (r: { classification: ReplyClassification; question_open: boolean }) => void;
  /** Each director attempt's check: the validated response when it passed, else what the model sent (`raw`, for logs). */
  onCheck?: (c: { attempt: 1 | 2; outcome: "pass" | "validation" | "pedagogy"; errors: string[]; warnings: string[]; response?: DirectorResponse; raw?: unknown }) => void;
  /**
   * Metering (slice 7): the kill switch and this session's cap are checked before the director is
   * called, and the director's token usage is recorded at config prices. Omit to run unmetered (tests).
   */
  meter?: {
    ledger: Ledger;
    sessionId: string;
    config: AiConfig;
    killSwitch: boolean;
    /** Live (real-model) turns: whether each model's key is set (presence only, never the value). */
    live?: { hasKey: (model: RuntimeModel) => boolean };
  };
}

/** Numbers shown to learners: three significant figures, no exponent for ordinary values. */
export const formatNumber = (x: number): string => String(Number(x.toPrecision(3)));

export class TurnSession {
  state: SessionState;
  private rev = 0;
  private abort: AbortController | null = null;
  private readonly opts: TurnSessionOptions;

  constructor(opts: TurnSessionOptions) {
    this.opts = opts;
    this.state = opts.state;
    this.rev = opts.startRev ?? 0;
  }

  get revision(): number {
    return this.rev;
  }

  /** Stop the turn in flight: bump the revision (its queued events are dropped) and abort the director. */
  interrupt(): void {
    this.rev++;
    this.abort?.abort();
    this.abort = null;
  }

  /** Run one turn. Events go to `emit`; anything from an older revision is dropped first. */
  async run(input: LearnerInput, emit: (e: TurnEvent) => void): Promise<void> {
    this.interrupt(); // a new turn makes any turn in flight stale
    const rev = this.rev;
    const turn_id = `turn_${rev}`;
    const abort = new AbortController();
    this.abort = abort;
    let seq = 0;
    const send = (e: DistributiveOmit<TurnEvent, "turn_id" | "seq" | "rev">): boolean => {
      if (rev !== this.rev) return false; // stale: never reaches the client
      emit({ ...e, turn_id, seq: seq++, rev } as TurnEvent);
      return true;
    };
    const fail = (reason: TurnFailure, details: string[]) => void send({ type: "turn.error", reason, message: FAILURE_MESSAGES[reason], details });

    send({ type: "turn.started" });
    const before = this.state;
    // One time budget for the whole turn: router, director, retries and the repair share it.
    // A metered (live or bake-off) turn takes its budget from config; tests and the demo pass their own.
    const deadline = Date.now() + (this.opts.timeoutMs ?? this.opts.meter?.config.turn_timeout_ms ?? 20_000);
    const remaining = () => Math.max(0, deadline - Date.now());
    const sl = shortlist(this.opts.registry, { concepts: this.opts.concepts, level: this.opts.level });
    // Safety-critical concepts and items, from the registry (never from the director).
    const reg = this.opts.registry;
    const safetyCritical = new Set<string>(
      [...reg.concepts, ...reg.scenes, ...reg.solvers, ...reg.simulations, ...reg.analogies, ...reg.readings].filter((x) => (x as { safety_critical?: boolean }).safety_critical).map((x) => x.id),
    );

    // Refused before anything is called: kill switch, (live) configuration and key, (live) the
    // provider-limit record, then the worst case against this session's cap.
    const meter = this.opts.meter;
    if (meter) {
      const router = this.opts.router;
      const estimate = {
        professorInputTokens:
          this.opts.director.estimateInputTokens?.({ request_id: turn_id, state_rev: rev, shortlist: sl, history: before.history, active_scene: before.activeScene, learner_text: input.text }) ?? PROMPT_BUDGET_TOKENS,
        routerInputTokens: router?.estimateInputTokens?.(input.text) ?? ROUTER_INPUT_ALLOWANCE_TOKENS,
      };
      const refusal = refuseTurn({ killSwitch: meter.killSwitch, ledger: meter.ledger, sessionId: meter.sessionId, config: meter.config, estimate, live: meter.live });
      if (refusal) return fail(refusal.reason, [refusal.detail]);
    }

    // Every provider attempt is metered as it ends, whether or not its answer passes.
    const meterUsage = (u: TokenUsage) => meter?.ledger.record(meter.sessionId, { ...u, turn_id, cost_micro_usd: costMicroUsd(u, meter.config) });

    // Router: how to read the learner's reply, decided here on the server, never by the client.
    let routed: RouterReply;
    let routing: Promise<RouterReply> | undefined;
    try {
      routing = (this.opts.router ?? createFakeRouter()).classify(
        {
          text: input.text,
          history: before.history,
          open_prompt: openPrompt(before.history) !== null,
          prediction_choices: (before.teaching ?? EMPTY_TEACHING).predictions.find((p) => p.status === "open")?.choices,
          open_question: openQuestion(before),
          deadline_ms: deadline,
          onAttempt: (a) => meterUsage(a.usage),
        },
        abort.signal,
      );
      routed = await withTimeout(routing, remaining(), abort.signal);
    } catch (err) {
      if (err instanceof TimeoutError || rev !== this.rev) {
        // Stop the router's call and let it report its attempts (a sent request may be billed).
        abort.abort();
        await Promise.race([routing?.catch(() => undefined), new Promise((r) => setTimeout(r, 1000))]);
      }
      if (rev !== this.rev) return;
      if (err instanceof TimeoutError) return fail("timeout", [errorText(err)]);
      // A provider-backed router's failures keep their kind where the learner should know it.
      if (err instanceof ProviderError && ROUTER_KINDS.has(err.kind)) return fail(err.kind as TurnFailure, [`router: ${err.kind}`]);
      return fail("router", [err instanceof ProviderError ? `router: ${err.kind}` : errorText(err)]);
    }
    if (meter && routed.usage) meterUsage(routed.usage);
    if (rev !== this.rev) return;
    const classified = ReplyClassification.safeParse(routed.classification);
    if (!classified.success) return fail("router", classified.error.issues.map((i) => `${i.path.join(".") || "(classification)"}: ${i.message}`));
    this.opts.onRoute?.({ classification: classified.data, question_open: openPrompt(before.history) !== null });
    const c = matchOpenChoice(classified.data, input.text, openQuestion(before)?.choices);
    const history: SessionHistory = {
      ...before.history,
      entries: [
        ...before.history.entries,
        {
          kind: "learner",
          answered_prompt: c.answered_prompt,
          // Frustration releases an open question that was not answered (spec A4; Lucky's decision 2026-10-13).
          released_prompt: c.frustrated && !c.answered_prompt && openPrompt(before.history) !== null,
          // Pushback needs a position to push against: on a first turn (no earlier Aili turn) the
          // router's flag is ignored (Lucky's decision 2026-10-12, after s05 turn 1); and a guess on an
          // open prediction is never pushback (Lucky's decision 2026-10-13, after s04 and c1).
          pushback: effectivePushback(c, before.history),
          new_evidence: c.new_evidence,
          frustrated: c.frustrated,
          wants_another_example: c.wants_another_example,
          acknowledged: c.acknowledged,
          wants_stop: c.wants_stop,
          asks_for_source: c.asks_for_source,
        },
      ],
    };
    // What the reply changes (a prediction's guess, a waiver acknowledged): pending until the turn completes.
    const today = (this.opts.today ?? (() => new Date().toISOString().slice(0, 10)))();
    const teaching = applyLearnerReply({ ...EMPTY_TEACHING, ...before.teaching }, c, today);
    // A source the learner named that is not in the library (spec A8, A10: "I can't verify that").
    const asked = c.asks_for_source?.toLowerCase();
    const listed = asked ? reg.sources.some((s) => s.title.toLowerCase().includes(asked) || asked.includes(s.title.toLowerCase())) : true;
    const pedagogyContext = { unlistedSource: asked && !listed ? c.asks_for_source! : undefined, libraryAvailable: sl.readings.length > 0, directAnswer: c.wants_direct_answer };

    // Director, then the checks; one repair attempt (with the errors fed back) if the checks fail.
    // Provider attempts are metered as they end (onAttempt); a director without them reports one usage.
    const meterReply = (reply: DirectorReply | DirectorCallFailed) => {
      if (!(reply instanceof DirectorCallFailed) && !reply.attempts && reply.usage) meterUsage(reply.usage);
    };
    const callDirector = async (repair?: { errors: string[]; previous: unknown }): Promise<DirectorReply | TurnFailure | "stale"> => {
      if (remaining() <= 0) return "timeout";
      let pending: Promise<DirectorReply> | undefined;
      try {
        pending = this.opts.director.respond(
          { request_id: turn_id, state_rev: rev, shortlist: sl, history, teaching, direct_answer: c.wants_direct_answer, active_scene: before.activeScene, learner_text: input.text, deadline_ms: deadline, onAttempt: (a) => meterUsage(a.usage), ...(repair ? { repair } : {}) },
          abort.signal,
        );
        const reply = await withTimeout(pending, remaining(), abort.signal);
        meterReply(reply);
        return rev !== this.rev ? "stale" : reply;
      } catch (err) {
        if (err instanceof DirectorCallFailed) meterReply(err);
        else if (pending) {
          // The turn timed out or was interrupted first: stop the director's call and let it finish
          // reporting its attempts (so a request that may be billed is metered) before going on.
          abort.abort();
          await Promise.race([pending.catch(() => undefined), new Promise((r) => setTimeout(r, 1000))]);
        }
        if (rev !== this.rev) return "stale"; // interrupted: nothing more to say for this turn
        if (err instanceof TimeoutError) return "timeout";
        if (err instanceof DirectorCallFailed)
          return err.kind === "not_configured" || err.kind === "key_rejected" || err.kind === "timeout" || err.kind === "spend_limit" || err.kind === "refused" ? err.kind : "director";
        return "director";
      }
    };
    const check = (answer: unknown): ({ r: DirectorResponse } | { reason: "validation" | "pedagogy"; errors: string[] }) & { warnings: string[] } => {
      // A segment over the hard limit is split at sentence ends when it can be (a warning, never silent).
      // A teach-back question with no reading gets the one open reading (a warning, never silent).
      const filled = fillTeachBackReading(answer, teaching);
      const split = splitLongNarration(filled.raw);
      // A field from another action type, on an otherwise valid action, is dropped (a warning).
      const stray = dropStrayActionFields(split.raw);
      const v = validateDirectorResponse(stray.raw, {
        shortlist: sl,
        activeScene: before.activeScene,
        expected: { request_id: turn_id, state_rev: rev },
        safetyCritical,
        // An answer the engine split may have up to five segments (the split checks the 700-character total).
        maxSegments: split.warnings.length ? NARRATION_SPLIT_MAX_SEGMENTS : undefined,
      });
      const warnings = [...(filled.warning ? [filled.warning] : []), ...split.warnings, ...stray.warnings, ...v.warnings];
      if (!v.response) return { reason: "validation", errors: v.errors, warnings };
      const p = validatePedagogy(v.response, history, teaching, pedagogyContext);
      // A re-offer of the open question is allowed, and always visible (Lucky's decision 2026-10-13).
      if (reoffersOpenQuestion(v.response, history, teaching)) warnings.push(`${OPEN_QUESTION_REOFFERED} (${v.response.prompt!.kind}): "${v.response.prompt!.text}"`);
      if (p.length) return { reason: "pedagogy", errors: p, warnings };
      // A passing answer about a concept with a scene, but no scene on stage: the engine selects it.
      const picked = selectSceneForConcept(v.response, sl.scenes, before.activeScene);
      return picked ? { r: picked.r, warnings: [...warnings, picked.warning] } : { r: v.response, warnings };
    };

    let reply = await callDirector();
    if (reply === "stale") return;
    if (typeof reply === "string") return fail(reply, [`director: ${reply}`]);
    const observe = (attempt: 1 | 2, c: ReturnType<typeof check>, raw: unknown) =>
      this.opts.onCheck?.("errors" in c ? { attempt, outcome: c.reason, errors: c.errors, warnings: c.warnings, raw } : { attempt, outcome: "pass", errors: [], warnings: c.warnings, response: c.r, raw });
    let checked = check(reply.response);
    observe(1, checked, reply.response);
    if ("errors" in checked) {
      const first = checked;
      reply = await callDirector({ errors: first.errors, previous: reply.response });
      if (reply === "stale") return;
      if (typeof reply === "string") return fail(reply, [`director: ${reply}`, ...first.errors]);
      checked = check(reply.response);
      // The repair still paraphrased the guide's application question: use the guide's exact text
      // (no further model call), with a visible warning (Lucky's decision 2026-10-13).
      if ("errors" in checked && checked.errors.some((e) => e.includes("ask the guide's application question"))) {
        const sub = substituteGuideQuestion(reply.response, sl);
        if (sub.warning) {
          const again = check(sub.raw);
          if (!("errors" in again)) checked = { ...again, warnings: [sub.warning, ...again.warnings] };
        }
      }
      observe(2, checked, reply.response);
      if ("errors" in checked) return fail(checked.reason, [...checked.errors, "(after one repair attempt)"]);
    }
    const r = checked.r;

    // Solve every calculation before showing anything.
    const values: Record<string, string> = {};
    const results: Array<{ calc_id: string; outputs: Record<string, number> }> = [];
    for (const c of r.calc_requests) {
      const fn = (this.opts.solvers ?? SOLVERS)[c.solver];
      if (!fn) return fail("solver", [`calc_requests ${c.id}: no implementation for ${c.solver}`]);
      let outputs: Record<string, number>;
      try {
        outputs = fn(c.inputs);
      } catch (err) {
        return fail("solver", [`calc_requests ${c.id} (${c.solver}): ${errorText(err)}`]);
      }
      const bad = Object.entries(outputs).find(([, x]) => !Number.isFinite(x));
      if (bad) return fail("solver", [`calc_requests ${c.id} (${c.solver}): output ${bad[0]} is not a finite number`]);
      results.push({ calc_id: c.id, outputs });
      for (const [k, x] of Object.entries(outputs)) values[`${c.id}.${k}`] = formatNumber(x);
    }
    const PH = /\{\{\s*([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)?)\s*\}\}/g;
    const fill = (t: string) => t.replace(PH, (_, name: string) => values[name] ?? `{{${name}}}`);
    const partsOf = (t: string): TextPart[] => {
      const out: TextPart[] = [];
      let at = 0;
      for (const m of t.matchAll(PH)) {
        if (m.index > at) out.push({ text: t.slice(at, m.index) });
        const name = m[1]!;
        const [calc_id, output] = name.split(".") as [string, string];
        out.push(name in values ? { value: values[name]!, calc_id, output } : { text: m[0] });
        at = m.index + m[0].length;
      }
      if (at < t.length) out.push({ text: t.slice(at) });
      return out;
    };
    const compiled = {
      narration: r.narration.map((n) => ({ id: n.id, text: fill(n.text), parts: partsOf(n.text) })),
      prompt: r.prompt ? { text: fill(r.prompt.text), parts: partsOf(r.prompt.text), chips: r.prompt.chips.map(fill) } : null,
    };
    const explanation = explainTurn(r, this.opts.registry, results, fill, formatNumber);
    const unfilled = [...compiled.narration.map((n) => n.text), compiled.prompt?.text ?? "", ...(compiled.prompt?.chips ?? []), ...explanation.assumptions, ...explanation.limitations].find((t) => /\{\{/.test(t));
    if (unfilled) return fail("solver", [`a placeholder had no calculated value: "${unfilled}"`]);

    // Emit the whole turn, in order. An interrupt between events drops the rest.
    for (const n of compiled.narration) if (!send({ type: "narration", ...n })) return;
    for (const action of r.actions) if (!send({ type: "action", action })) return;
    for (const res of results) if (!send({ type: "calc.result", ...res })) return;
    if (compiled.prompt && !send({ type: "prompt", ...compiled.prompt })) return;

    // Commit the new state only now, then say the turn is done.
    let activeScene = before.activeScene;
    for (const a of r.actions) if (a.type === "select_scene") activeScene = a.scene;
    const ailiTurnNumber = history.entries.filter((e) => e.kind === "aili").length + 1;
    const next: SessionState = {
      history: { ...history, entries: [...history.entries, { kind: "aili", move: r.move, asked: !!r.prompt, gave_back: givesBack(r), concepts: r.concepts, safety: r.safety }] },
      activeScene,
      teaching: applyResponse(teaching, r, ailiTurnNumber, today, safetyCritical, sl.readings.find((x) => x.id === r.reading)?.teaches ?? []),
    };
    if (rev !== this.rev) return;
    this.state = next;
    send({ type: "turn.done", move: r.move, explanation });
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

class TimeoutError extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new TimeoutError(`no answer within ${ms} ms`)), ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error("interrupted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        clearTimeout(t);
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
