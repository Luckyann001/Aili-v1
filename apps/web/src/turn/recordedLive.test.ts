import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSseParser, type TurnEvent } from "@aili/engine";

// The e2e test mode of the live path (docs/m3-live-browser-plan.md slice 6): the recording in
// e2e/fixtures answers through the real live path. No key, no network, no spend.

const load = async (o: { flag?: string; fake?: string } = {}) => {
  vi.resetModules();
  vi.stubEnv("AILI_LIVE", "");
  vi.stubEnv("NEXT_PUBLIC_AILI_FAKE_DIRECTOR", o.fake ?? "");
  vi.stubEnv("AILI_E2E_RECORDED_LIVE", o.flag ?? "1");
  vi.stubEnv("AILI_PROFESSOR_API_KEY", ""); // no key: recorded mode must not need one
  vi.stubEnv("AILI_ROUTER_API_KEY", "");
  const server = await import("./server");
  const logDir = join(tmpdir(), "aili-recorded-live-test-logs");
  (await import("./sessionLog")).sessionLogDeps.dir = () => logDir;
  return { ...server, logDir };
};
afterEach(() => vi.unstubAllEnvs());

const COOKIE = "theme=dark; aili-e2e-live=1";
const post = (body: unknown, o: { cookie?: string; host?: string } = {}) =>
  new Request(`http://${o.host ?? "localhost:3200"}/api/turn`, { method: "POST", headers: { "content-type": "application/json", host: o.host ?? "localhost:3200", ...(o.cookie === undefined ? { cookie: COOKIE } : o.cookie ? { cookie: o.cookie } : {}) }, body: JSON.stringify(body) });
const body = (rev: number, text: string, sid = "recorded-test-0001") => ({ session_id: sid, state_rev: rev, input: { text } });
async function readAll(res: Response): Promise<TurnEvent[]> {
  const events: TurnEvent[] = [];
  const parser = createSseParser((e) => events.push(e));
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(dec.decode(value, { stream: true }));
  }
  return events;
}

describe("recorded live path (test builds only)", () => {
  it("two turns at the page's own revisions: a prediction with chips and a scene, then a calculation, a reveal and the explanation", async () => {
    const { handleTurn, sessions } = await load();
    const t1 = await readAll(await handleTurn(post(body(3, "teach me robotics"))));
    expect(t1.at(-1)!.type, JSON.stringify(t1.at(-1))).toBe("turn.done");
    expect(t1.filter((e) => e.type === "action").map((e) => (e as { action: unknown }).action)).toEqual([{ type: "select_scene", scene: "fx-lever", at: "n2" }, { type: "highlight_part", part: "weight", at: "n2" }]);
    expect((t1.find((e) => e.type === "prompt") as { chips: string[] }).chips).toEqual(["It gets harder", "It gets easier", "No different", "Not sure"]);

    const t2 = await readAll(await handleTurn(post(body(4, "It gets harder"))));
    const done = t2.at(-1)!;
    expect(done.type, JSON.stringify(done)).toBe("turn.done");
    expect(t2.some((e) => e.type === "calc.result")).toBe(true);
    expect(t2.find((e) => e.type === "narration" && (e as { parts: Array<{ value?: string }> }).parts.some((p) => p.value))).toBeTruthy();
    expect(done.type === "turn.done" && done.explanation.calculations[0]?.outputs.find((o) => o.label === "Torque")?.unit).toBe("N·m");
    expect(sessions.get("recorded-test-0001")!.teaching!.predictions[0]).toMatchObject({ guess: "It gets harder", status: "revealed" });
  });

  it("turn 3 puts the servo + arm on stage, each action bound to the segment that names it (M4 slice 2a)", async () => {
    const { handleTurn, sessions } = await load();
    const sid = "recorded-test-0007";
    await readAll(await handleTurn(post(body(1, "teach me robotics", sid))));
    await readAll(await handleTurn(post(body(2, "It gets harder", sid))));
    const t3 = await readAll(await handleTurn(post(body(3, "show me a real servo", sid))));
    expect(t3.at(-1)!.type, JSON.stringify(t3.at(-1))).toBe("turn.done");
    expect(t3.filter((e) => e.type === "action").map((e) => (e as { action: unknown }).action)).toEqual([
      { type: "select_scene", scene: "fx-servo-arm", at: "n1" },
      { type: "highlight_part", part: "load", at: "n2" },
      { type: "play_animation", animation: "slide-load-out", at: "n3" },
    ]);
    expect(sessions.get(sid)!.activeScene).toBe("fx-servo-arm");
  });

  it("turns 4 and 5: an analogy in words only, then one with its picture on stage (docs/m4-plan.md addendum A)", async () => {
    const { handleTurn, sessions } = await load();
    const sid = "recorded-test-0008";
    for (const [rev, text] of [[1, "teach me robotics"], [2, "It gets harder"], [3, "show me a real servo"]] as const) await readAll(await handleTurn(post(body(rev, text, sid))));
    const t4 = await readAll(await handleTurn(post(body(4, "the rated torque", sid))));
    expect(t4.at(-1), JSON.stringify(t4.at(-1))).toMatchObject({ type: "turn.done", analogy: { id: "analogy.fx-shopping-bag", words_only: true } });
    expect(t4.filter((e) => e.type === "action"), JSON.stringify(t4.filter((e) => e.type === "action"))).toEqual([]); // the stage keeps the servo + arm
    const t5 = await readAll(await handleTurn(post(body(5, "Yes", sid))));
    expect(t5.at(-1), JSON.stringify(t5.at(-1))).toMatchObject({ type: "turn.done", analogy: { id: "analogy.fx-ruler-held-out", words_only: false } });
    expect(sessions.get(sid)!.activeScene).toBe("fx-lever");
  });

  it("turns 6 and 7: the equation steps, each bound to the segment that names it (M4 slice B)", async () => {
    const { handleTurn } = await load();
    const sid = "recorded-test-0009";
    for (const [rev, text] of [[1, "teach me robotics"], [2, "It gets harder"], [3, "show me a real servo"], [4, "the rated torque"], [5, "Yes"]] as const) await readAll(await handleTurn(post(body(rev, text, sid))));
    const acts = (ev: TurnEvent[]) => ev.filter((e) => e.type === "action").map((e) => (e as { action: unknown }).action);
    const t6 = await readAll(await handleTurn(post(body(6, "Longer lever", sid))));
    expect(t6.at(-1)!.type, JSON.stringify(t6.at(-1))).toBe("turn.done");
    expect(acts(t6)).toEqual([
      { type: "select_scene", scene: "fx-servo-arm", at: "n1" },
      { type: "play_animation", animation: "eq-force", at: "n2" },
      { type: "play_animation", animation: "eq-distance", at: "n3" },
      { type: "play_animation", animation: "eq-torque", at: "n4" },
    ]);
    const t7 = await readAll(await handleTurn(post(body(7, "The arm itself", sid))));
    expect(t7.at(-1)!.type, JSON.stringify(t7.at(-1))).toBe("turn.done");
    expect(acts(t7)).toEqual([{ type: "play_animation", animation: "eq-arm-share", at: "n1" }, { type: "play_animation", animation: "eq-margin", at: "n2" }]);
    // Turns 7 and 8 give numbers about the scene on stage, from its settings (the page's note resets).
    expect(t7.at(-1)).toMatchObject({ stage_numbers: true });
    const t8 = await readAll(await handleTurn(post(body(8, "A shorter arm", sid))));
    expect(t8.at(-1), JSON.stringify(t8.at(-1))).toMatchObject({ type: "turn.done", stage_numbers: true });
    // The stage's defaults (arm 0.15 m, arm 0.04 kg, load 0.1 kg at 0.08 m), not the professor's load-at-the-tip inputs.
    const total = t8.filter((e) => e.type === "narration").flatMap((e) => (e as { parts: Array<{ value?: string }> }).parts).find((p) => p.value)!.value;
    expect(total).toBe(String(Number((9.80665 * (0.1 * 0.08 + 0.04 * 0.075)).toPrecision(3))));
  });

  it("turn 9 takes the servo apart and points at two parts inside it, each action bound to its segment (anatomy slice 3)", async () => {
    const { handleTurn } = await load();
    const sid = "recorded-test-0010";
    const texts = ["teach me robotics", "It gets harder", "show me a real servo", "the rated torque", "Yes", "Longer lever", "The arm itself", "A shorter arm"];
    for (const [i, text] of texts.entries()) {
      const t = await readAll(await handleTurn(post(body(i + 1, text, sid))));
      expect(t.at(-1)!.type, `turn ${i + 1}: ${JSON.stringify(t.at(-1))}`).toBe("turn.done");
    }
    const t9 = await readAll(await handleTurn(post(body(9, "What is inside the servo?", sid))));
    expect(t9.at(-1)!.type, JSON.stringify(t9.at(-1))).toBe("turn.done");
    expect(t9.filter((e) => e.type === "action").map((e) => (e as { action: unknown }).action)).toEqual([
      { type: "play_animation", animation: "servo-explode", at: "n1" },
      { type: "highlight_part", part: "gear-train", at: "n2" },
      { type: "highlight_part", part: "motor-and-sensor", at: "n3" },
    ]);
  });

  it("turn 10 points at the gear train, then turns the gears in its own segment; the ratio is in words only (anatomy slice 4)", async () => {
    const { handleTurn } = await load();
    const sid = "recorded-test-0011";
    const texts = ["teach me robotics", "It gets harder", "show me a real servo", "the rated torque", "Yes", "Longer lever", "The arm itself", "A shorter arm", "What is inside the servo?"];
    for (const [i, text] of texts.entries()) {
      const t = await readAll(await handleTurn(post(body(i + 1, text, sid))));
      expect(t.at(-1)!.type, `turn ${i + 1}: ${JSON.stringify(t.at(-1))}`).toBe("turn.done");
    }
    const t10 = await readAll(await handleTurn(post(body(10, "The gear train", sid))));
    expect(t10.at(-1)!.type, JSON.stringify(t10.at(-1))).toBe("turn.done");
    expect(t10.filter((e) => e.type === "action").map((e) => (e as { action: unknown }).action)).toEqual([
      { type: "highlight_part", part: "gear-train", at: "n1" },
      { type: "play_animation", animation: "servo-gears-turn", at: "n2" },
    ]);
    // No number anywhere in what is said: the ratio is on the stage, computed by the page.
    const said = t10.filter((e) => e.type === "narration" || e.type === "prompt").flatMap((e) => (e as { parts: Array<{ text?: string; value?: string }> }).parts.map((p) => p.text ?? p.value ?? ""));
    expect(said.join(" ")).toMatch(/the ratio shown on the stage/);
    expect(said.join(" ")).not.toMatch(/\d/);
  });

  it("an interrupted turn's note arrives inside the next turn's request: that turn starts from the stage the learner saw (M4 slice 1)", async () => {
    const { handleTurn, sessions } = await load();
    // Turn 5 puts the lever on stage in its SECOND segment; the learner interrupts during the first,
    // then sends a new message at once. The note travels inside that request.
    await readAll(await handleTurn(post(body(5, "teach me robotics", "recorded-test-0003"))));
    expect(sessions.get("recorded-test-0003")!.activeScene).toBe("fx-lever");
    const t6 = await readAll(await handleTurn(post({ ...body(6, "It gets harder", "recorded-test-0003"), previous_shown: { state_rev: 5, shown_through: "n1" } })));
    // Turn 6 was checked against the stage the learner saw (no scene): its recorded answer plays the
    // weight slide without selecting the lever, so it is rejected (its repair, the recording's next
    // step, fails too); without the note it would pass.
    expect(t6.at(-1)!.type).toBe("turn.error");
    expect(sessions.get("recorded-test-0003")!.activeScene).toBeUndefined();

    // Without the note (the learner saw both segments), the lever stays.
    await readAll(await handleTurn(post(body(5, "teach me robotics", "recorded-test-0004"))));
    await readAll(await handleTurn(post(body(6, "It gets harder", "recorded-test-0004"))));
    expect(sessions.get("recorded-test-0004")!.activeScene).toBe("fx-lever");
  });

  it("the note is kept even if the next turn fails; a note about another turn changes nothing; the interrupt route takes no note", async () => {
    const { handleTurn, handleInterrupt, sessions } = await load();
    await readAll(await handleTurn(post(body(5, "teach me robotics", "recorded-test-0005"))));
    vi.stubEnv("AILI_AI_KILL_SWITCH", "1"); // the next turn is refused before anything runs
    const refused = await readAll(await handleTurn(post({ ...body(6, "hi", "recorded-test-0005"), previous_shown: { state_rev: 5, shown_through: null } })));
    expect(refused.at(-1)!.type).toBe("turn.error");
    expect(sessions.get("recorded-test-0005")!.activeScene).toBeUndefined();
    vi.stubEnv("AILI_AI_KILL_SWITCH", "");
    await readAll(await handleTurn(post(body(5, "teach me robotics", "recorded-test-0006"))));
    await readAll(await handleTurn(post({ ...body(6, "It gets harder", "recorded-test-0006"), previous_shown: { state_rev: 4, shown_through: null } })));
    expect(sessions.get("recorded-test-0006")!.activeScene).toBe("fx-lever");
    expect((await handleInterrupt(post({ session_id: "recorded-test-0006", request_id: "turn_6", state_rev: 6, shown_through: "n1" }))).status).toBe(400);
  });

  it("off without the test's cookie, without the run-time flag, and refused from another device; never logged", async () => {
    let s = await load({ fake: "" });
    expect((await s.handleTurn(post(body(1, "hi"), { cookie: "" }))).status).toBe(404); // no cookie: neither live nor fake
    s = await load({ flag: "" });
    expect((await s.handleTurn(post(body(1, "hi")))).status).toBe(404); // cookie, but the flag is not set at run time
    s = await load();
    expect((await s.handleTurn(post(body(1, "hi"), { host: "192.168.100.5:3200" }))).status).toBe(403);
    await readAll(await s.handleTurn(post(body(1, "teach me robotics", "recorded-test-0002"))));
    expect(() => readdirSync(s.logDir)).toThrow(); // no session log for recorded turns
  });
});
