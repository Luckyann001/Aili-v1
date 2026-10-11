import type { Director, DirectorRequest } from "./turn";

// A scripted stand-in for the professor model (docs/m2-plan.md slice 5). No provider, no key, no
// network. It answers from the test-fixture shortlist (scene "fx-lever", simulation
// "sim.fx-servo-load", solver "solver.fx-torque", reading "read.fx-moments"), so it only works
// with the dev-only fixture registry. Every case is labelled for what it is meant to trigger.

export type FakeCase =
  | "valid" // passes every check
  | "invalid-id" // a part that is not in the scene → validation failure
  | "out-of-bounds" // a setting outside its bounds → validation failure
  | "hard-coded-number" // a number in narration → validation failure (spec test 14)
  | "pedagogy-violation" // flattery → pedagogy failure
  | "solver-failure" // passes the validators, but the solver refuses the input
  | "slow"; // valid, but only after `slowMs` (for interrupt tests)

const CALC = { id: "c1", solver: "solver.fx-torque", simulation: "sim.fx-servo-load", inputs: { arm_length_m: 0.2, payload_kg: 0.3, arm_kg_per_m: 0.25, angle_deg: 0 } };

function valid(req: DirectorRequest) {
  return {
    request_id: req.request_id,
    state_rev: req.state_rev,
    move: "explain",
    concepts: ["mech.torque.static"],
    narration: [
      { id: "n1", text: "Holding this arm level takes {{c1.torque_nm}} newton-metres." },
      { id: "n2", text: "The payload at the tip gives {{c1.payload_torque_nm}} of that; the arm's own mass gives the rest." },
    ],
    actions: [
      { type: "highlight_part", part: "weight" },
      { type: "set_parameter", param: "weight_distance_m", value: 0.2 },
    ],
    calc_requests: [CALC],
    evidence: ["read.fx-moments"],
    prompt: { text: "Where would you move the weight to make it easier to hold?", chips: ["Closer to my hand", "Not sure"] },
    assumptions: ["static hold only"],
    limitations: ["does not cover acceleration"],
  };
}

export function fakeResponse(c: FakeCase, req: DirectorRequest): unknown {
  const r = valid(req);
  switch (c) {
    case "valid":
    case "slow":
      return r;
    case "invalid-id":
      return { ...r, actions: [{ type: "highlight_part", part: "servo-horn" }] };
    case "out-of-bounds":
      return { ...r, actions: [{ type: "set_parameter", param: "weight_distance_m", value: 0.5 }] };
    case "hard-coded-number":
      return { ...r, narration: [{ id: "n1", text: "Holding this arm level takes 2.5 newton-metres." }] };
    case "pedagogy-violation":
      return { ...r, narration: [{ id: "n1", text: "Great question! Holding this arm level takes {{c1.torque_nm}} newton-metres." }] };
    case "solver-failure":
      // A rating of zero is inside the manifest's 0–100 bounds but the solver refuses it.
      return { ...r, calc_requests: [{ ...CALC, inputs: { ...CALC.inputs, rated_stall_torque_nm: 0 } }] };
  }
}

/**
 * A director that plays `cases` in order, one per turn (the last one repeats). The "slow" case
 * waits `slowMs` and gives up as soon as the turn is interrupted.
 */
export function createFakeDirector(cases: FakeCase | FakeCase[], opts: { slowMs?: number } = {}): Director & { calls: number } {
  const list = Array.isArray(cases) ? cases : [cases];
  const d = {
    calls: 0,
    async respond(req: DirectorRequest, signal: AbortSignal): Promise<unknown> {
      const c = list[Math.min(d.calls, list.length - 1)]!;
      d.calls++;
      if (c === "slow") {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, opts.slowMs ?? 1000);
          signal.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new Error("interrupted"));
          }, { once: true });
        });
      }
      return fakeResponse(c, req);
    },
  };
  return d;
}
