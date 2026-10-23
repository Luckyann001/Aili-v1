import { describe, expect, it } from "vitest";
import type { DirectorResponse, SessionHistory } from "@aili/schemas";
import { pidAltitude1d } from "@aili/solvers";
import { createFakeRouter, loadRegistry, STAGE_INPUTS_USED, TurnSession, type Director, type DirectorRequest, type SessionState, type TurnEvent } from "./index";
import { dir, fixtureFiles, readJson } from "./__fixtures__/registry";

// The drone lesson's live path (step 4 session 2, docs/drone-pid-plan.md): behavior spec A14 session
// tests on the drone's published test fixtures, with scripted director answers and the fake router.
// They prove the rules and the plumbing (a preset before a run, numbers only from the solver, run
// inputs bound to the stage); whether a real model behaves well is the real-model evaluation.

const CTL = ["ctl.open-vs-closed-loop", "ctl.error", "ctl.proportional", "ctl.derivative", "ctl.integral", "ctl.steady-state-error", "ctl.overshoot"];
const TODAY = "2026-10-23";
const SCENE = "fx-drone-altitude";

const registry = (() => {
  const fx = fixtureFiles();
  const r = loadRegistry({ concepts: readJson("concepts.json"), scenes: [...dir("scenes"), ...fx.scenes], capabilities: [...dir("capabilities"), ...fx.capabilities] }, { allowTestFixtures: true });
  if (r.errors.length) throw new Error(r.errors.join("\n"));
  return r.registry;
})();

type Answer = (req: DirectorRequest) => Partial<DirectorResponse> & Record<string, unknown>;
function scripted(answers: Answer[]): Director {
  let turn = 0;
  let last = "";
  return {
    async respond(req: DirectorRequest) {
      if (req.request_id !== last) (turn++, (last = req.request_id));
      const a = answers[Math.min(turn - 1, answers.length - 1)]!;
      return { response: { request_id: req.request_id, state_rev: req.state_rev, move: "explain", concepts: ["ctl.proportional"], narration: [{ id: "n1", text: "Here is the idea." }], ...a(req) } };
    },
  };
}
const say = (...lines: string[]) => lines.map((text, i) => ({ id: `n${i + 1}`, text }));
const ask = (text: string, kind: "question" | "prediction" = "question", chips: string[] = []) => ({ text, chips, kind });

function session(answers: Answer[], o: { level?: SessionHistory["learner_level"]; posture?: SessionHistory["posture"]; scene?: string } = {}) {
  const state: SessionState = { history: { posture: o.posture ?? "learning", learner_level: o.level ?? "some_knowledge", entries: [] }, ...(o.scene ? { activeScene: o.scene } : {}) };
  const warnings: string[] = [];
  const s = new TurnSession({ registry, director: scripted(answers), router: createFakeRouter(), state, concepts: CTL, level: "L2", today: () => TODAY, onCheck: (c) => warnings.push(...c.warnings) });
  const reply = async (text: string) => {
    const events: TurnEvent[] = [];
    await s.run({ text }, (e) => events.push(e));
    return events;
  };
  return Object.assign(reply, { warnings });
}
const done = (events: TurnEvent[]) => expect(events.at(-1)!.type, JSON.stringify(events.at(-1))).toBe("turn.done");
const failed = (events: TurnEvent[], pattern: RegExp) => {
  const last = events.at(-1) as Extract<TurnEvent, { type: "turn.error" }>;
  expect(last.type, JSON.stringify(last)).toBe("turn.error");
  expect(last.details.join("\n")).toMatch(pattern);
};
const spoken = (events: TurnEvent[]) =>
  events
    .filter((e) => e.type === "narration")
    .map((e) => (e as unknown as { parts: Array<{ text?: string; value?: string }> }).parts.map((p) => p.text ?? p.value).join(""))
    .join(" ");

/** A run of the drone with P only, from the ground: the calculation the professor asks for (its inputs are replaced by the stage's). */
const CALC = { id: "c1", solver: "solver.fx-pid-altitude-1d", simulation: "sim.fx-pid-altitude-1d", inputs: { base_mass_kg: 1, kp_n_per_m: 10, ki_n_per_m_s: 0, kd_n_s_per_m: 0, target_m: 2 } };
const RUN_P_ONLY: DirectorResponse["actions"] = [
  { type: "select_scene", scene: SCENE, at: "n1" },
  { type: "apply_preset", preset: "p-only", at: "n1" },
  { type: "run_simulation", by: "aili", start: "ground", at: "n2" },
];
/** The solver's own answer for P only, with the scene's constants (drag 1.0, thrust-to-weight 2). */
const P_ONLY_GAP_M = pidAltitude1d({ base_mass_kg: 1, drag_n_s_per_m: 1, thrust_to_weight_ratio: 2, kp_n_per_m: 10, ki_n_per_m_s: 0, kd_n_s_per_m: 0, target_m: 2 }).final_error_m;
/** As the engine shows a calculated value: three significant figures (formatNumber). */
const P_ONLY_SAID = String(Number(P_ONLY_GAP_M.toPrecision(3)));

describe("drone, live path: the shortlist", () => {
  it("offers the drone's published fixture scene with its presets, the simulation and the analogy for the ctl.* concepts", () => {
    const run = session([() => ({ move: "explain", narration: say("A feedback controller measures, compares and corrects.") })]);
    expect(run).toBeTypeOf("function");
    const sceneIds = registry.scenes.filter((s) => s.review_status === "published").map((s) => s.id);
    expect(sceneIds).toContain(SCENE);
    expect(registry.scenes.find((s) => s.id === SCENE)!.presets.map((p) => p.id)).toEqual(["p-only", "p-d", "pid", "too-much-i", "gust"]);
  });
});

describe("drone, live path: runs and their numbers", () => {
  it("select, preset, run: passes; the gap Aili says is the solver's for P only", async () => {
    const reply = session([() => ({ move: "explain", calc_requests: [CALC], actions: RUN_P_ONLY, narration: say("Here is P on its own.", "It settles short of the line by {{c1.final_error_m}} metres."), prompt: ask("Why does it stop short") })]);
    const events = await reply("how does a drone hold its height?");
    done(events);
    expect(events.filter((e) => e.type === "action").map((e) => (e as unknown as { action: { type: string } }).action.type)).toEqual(["select_scene", "apply_preset", "run_simulation"]);
    expect(spoken(events)).toContain(P_ONLY_SAID);
  });

  it("inputs the model typed are replaced by the stage's (after the preset), with a visible warning", async () => {
    const reply = session([() => ({ move: "explain", calc_requests: [{ ...CALC, inputs: { ...CALC.inputs, kp_n_per_m: 30 } }], actions: RUN_P_ONLY, narration: say("Here is P on its own.", "It settles short by {{c1.final_error_m}} metres."), prompt: ask("Why does it stop short") })]);
    const events = await reply("show me P on a drone");
    done(events);
    expect(reply.warnings.join("\n")).toContain(STAGE_INPUTS_USED);
    expect(spoken(events)).toContain(P_ONLY_SAID); // Kp 10 from the preset, not the 30 typed
  });

  it("a run with no preset earlier in the turn is rejected (the server cannot see the learner's switches)", async () => {
    const reply = session([() => ({ move: "explain", actions: [{ type: "select_scene", scene: SCENE, at: "n1" }, { type: "run_simulation", by: "aili", start: "ground", at: "n1" }], narration: say("Watch it fly."), prompt: ask("What do you see") })]);
    failed(await reply("fly the drone"), /apply a preset earlier in this turn/);
  });

  it("a live run waiting for the learner, or starting at hover, is rejected", async () => {
    const reply = session([() => ({ move: "explain", actions: [{ type: "select_scene", scene: SCENE, at: "n1" }, { type: "apply_preset", preset: "pid", at: "n1" }, { type: "run_simulation", by: "learner", start: "hover", at: "n1" }], narration: say("Your turn."), prompt: ask("Ready") })]);
    const events = await reply("let me fly the drone");
    failed(events, /a live turn runs the simulation itself/);
    failed(events, /a live run starts on the ground/);
  });

  it("an unknown preset is rejected, naming the scene's presets", async () => {
    const reply = session([() => ({ move: "explain", actions: [{ type: "select_scene", scene: SCENE, at: "n1" }, { type: "apply_preset", preset: "max-everything", at: "n1" }], narration: say("Turn everything up."), prompt: ask("What happens") })]);
    failed(await reply("drone with big gains"), /"max-everything" is not a preset of scene "fx-drone-altitude" \(presets: p-only, p-d, pid, too-much-i, gust\)/);
  });
});

describe("drone, live path: behavior spec A14 on the drone", () => {
  it("#14 numbers: a hard-coded gap in narration is rejected", async () => {
    const reply = session([() => ({ move: "explain", actions: RUN_P_ONLY, narration: say("Here is P on its own.", "It settles 0.98 metres short."), prompt: ask("Why") })]);
    failed(await reply("how does a drone hold its height?"), /hard-coded number/);
  });

  it("#3 true beginner, 'What is PID?': a short explanation before any question passes", async () => {
    const reply = session([() => ({ move: "explain", concepts: ["ctl.proportional"], narration: say("PID is a rule for turning a gap into a push.", "P pushes harder the bigger the gap.", "D eases off when it rushes; I remembers a gap that lasts."), prompt: ask("Which part would fix a drone that hovers low") })], { level: "true_beginner" });
    done(await reply("What is PID?"));
  });

  it("#1 quick question, 'Will P alone hold it at 2 m?': a direct answer with the solver's number passes, no quiz", async () => {
    const reply = session([() => ({ move: "answer", calc_requests: [CALC], actions: RUN_P_ONLY, narration: say("Not quite: it hovers low.", "With P alone it settles {{c1.final_error_m}} metres below."), assumptions: ["the drone moves only up and down"] })], { posture: "answer" });
    const events = await reply("Will P alone hold it at 2 m?");
    done(events);
    expect(spoken(events)).toContain(P_ONLY_SAID);
  });

  it("#4 wrong prediction: the reveal explains the mechanism with the solver's gap", async () => {
    const reply = session([
      () => ({ move: "probe", actions: [{ type: "select_scene", scene: SCENE, at: "n1" }, { type: "apply_preset", preset: "p-only", at: "n1" }], narration: say("Here is P on its own."), prompt: ask("Where will it end up?", "prediction", ["Exactly on target", "Below it", "Not sure"]) }),
      () => ({
        move: "explain",
        calc_requests: [CALC],
        actions: [{ type: "apply_preset", preset: "p-only", at: "n1" }, { type: "run_simulation", by: "aili", start: "ground", at: "n1" }],
        reveal: { prediction: "p-turn-1", calc: "c1", outcome: "not_as_predicted" },
        narration: say("It settles below, short by {{c1.final_error_m}} metres.", "To hover, thrust must equal the weight, and P only pushes when there is a gap."),
        prompt: ask("So what would close the gap"),
      }),
    ]);
    done(await reply("show me how a drone holds its height"));
    const events = await reply("Exactly on target");
    done(events);
    expect(spoken(events)).toContain(P_ONLY_SAID);
  });

  it("#10 invented reference: a reading the library does not hold is rejected as evidence", async () => {
    const reply = session([() => ({ move: "answer", evidence: ["read.fx-feedback-systems-chapter-7"], narration: say("Chapter seven covers PID tuning.") })], { posture: "answer" });
    failed(await reply("What does chapter 7 of Feedback Systems say about PID?"), /evidence/);
  });
});
