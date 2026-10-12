import type { DirectorResponse, SessionHistory } from "@aili/schemas";
import { staticTorqueSingleLink } from "@aili/solvers";
import type { Registry, Shortlist } from "./capabilities";
import { shortlist } from "./capabilities";
import { validateDirectorResponse } from "./director";
import { givesBack, validatePedagogy } from "./pedagogy";

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
  | { type: "turn.done"; move: DirectorResponse["move"] }
  | { type: "turn.error"; reason: TurnFailure; message: string; details: string[] }
);

/**
 * Learner-facing text split so the client can mark calculated values (behavior spec A10: a
 * calculated result looks different from an explanation). `text` stays the plain sentence for speech.
 */
export type TextPart = { text: string } | { value: string; calc_id: string; output: string };

export type TurnFailure = "director" | "timeout" | "validation" | "pedagogy" | "solver";

/** Plain words for the learner. Details go to the event's `details` for developers and logs. */
export const FAILURE_MESSAGES: Record<TurnFailure, string> = {
  director: "Aili couldn't prepare an answer this time. Nothing on the stage changed.",
  timeout: "Aili took too long to answer, so the turn was stopped. Nothing on the stage changed.",
  validation: "Aili's answer didn't pass its checks, so it wasn't shown. Nothing on the stage changed.",
  pedagogy: "Aili's answer broke a teaching rule, so it wasn't shown. Nothing on the stage changed.",
  solver: "A calculation couldn't run, so nothing was shown. Nothing on the stage changed.",
};

export interface DirectorRequest {
  request_id: string;
  state_rev: number;
  shortlist: Shortlist;
  history: SessionHistory;
  active_scene?: string;
  learner_text: string;
}

/** The professor model in M3; a scripted fake in M2. Returns raw JSON, which is validated here. */
export interface Director {
  respond(req: DirectorRequest, signal: AbortSignal): Promise<unknown>;
}

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
}

export interface LearnerInput {
  text: string;
  /** Classification of the reply (a router in M3; given directly in M2). */
  reply: { answered_prompt: boolean; pushback?: boolean; new_evidence?: boolean };
}

export interface TurnSessionOptions {
  registry: Registry;
  director: Director;
  state: SessionState;
  concepts: readonly string[];
  level: "L1" | "L2" | "L3";
  solvers?: Record<string, SolverFn>;
  /** Give up on the director after this long. */
  timeoutMs?: number;
  /**
   * The revision before this session's first turn. A stateless server passes the client's revision
   * minus one, so the turn's events carry the revision the client's gate expects.
   */
  startRev?: number;
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
    const history: SessionHistory = {
      ...before.history,
      entries: [...before.history.entries, { kind: "learner", answered_prompt: input.reply.answered_prompt, pushback: input.reply.pushback ?? false, new_evidence: input.reply.new_evidence ?? false }],
    };
    const sl = shortlist(this.opts.registry, { concepts: this.opts.concepts, level: this.opts.level });

    // Director (with a timeout and the interrupt signal).
    let raw: unknown;
    try {
      raw = await withTimeout(
        this.opts.director.respond({ request_id: turn_id, state_rev: rev, shortlist: sl, history, active_scene: before.activeScene, learner_text: input.text }, abort.signal),
        this.opts.timeoutMs ?? 20_000,
        abort.signal,
      );
    } catch (err) {
      if (rev !== this.rev) return; // interrupted: nothing more to say for this turn
      return fail(err instanceof TimeoutError ? "timeout" : "director", [errorText(err)]);
    }
    if (rev !== this.rev) return;

    // Validate: structure, then pedagogy.
    const v = validateDirectorResponse(raw, { shortlist: sl, activeScene: before.activeScene, expected: { request_id: turn_id, state_rev: rev } });
    if (!v.response) return fail("validation", v.errors);
    const r = v.response;
    const p = validatePedagogy(r, history);
    if (p.length) return fail("pedagogy", p);

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
    const unfilled = [...compiled.narration.map((n) => n.text), compiled.prompt?.text ?? "", ...(compiled.prompt?.chips ?? [])].find((t) => /\{\{/.test(t));
    if (unfilled) return fail("solver", [`a placeholder had no calculated value: "${unfilled}"`]);

    // Emit the whole turn, in order. An interrupt between events drops the rest.
    for (const n of compiled.narration) if (!send({ type: "narration", ...n })) return;
    for (const action of r.actions) if (!send({ type: "action", action })) return;
    for (const res of results) if (!send({ type: "calc.result", ...res })) return;
    if (compiled.prompt && !send({ type: "prompt", ...compiled.prompt })) return;

    // Commit the new state only now, then say the turn is done.
    let activeScene = before.activeScene;
    for (const a of r.actions) if (a.type === "select_scene") activeScene = a.scene;
    const next: SessionState = {
      history: { ...history, entries: [...history.entries, { kind: "aili", move: r.move, asked: !!r.prompt, gave_back: givesBack(r), concepts: r.concepts, safety: r.safety }] },
      activeScene,
    };
    if (rev !== this.rev) return;
    this.state = next;
    send({ type: "turn.done", move: r.move });
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
