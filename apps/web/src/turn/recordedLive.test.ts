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

  it("an interrupted turn's note arrives inside the next turn's request: that turn starts from the stage the learner saw (M4 slice 1)", async () => {
    const { handleTurn, sessions } = await load();
    // Turn 5 puts the lever on stage in its SECOND segment; the learner interrupts during the first,
    // then sends a new message at once. The note travels inside that request.
    await readAll(await handleTurn(post(body(5, "teach me robotics", "recorded-test-0003"))));
    expect(sessions.get("recorded-test-0003")!.activeScene).toBe("fx-lever");
    const t6 = await readAll(await handleTurn(post({ ...body(6, "It gets harder", "recorded-test-0003"), previous_shown: { state_rev: 5, shown_through: "n1" } })));
    // Turn 6 was checked against the stage the learner saw (no scene): its recorded answer plays the
    // weight slide without selecting the lever, so it is rejected; without the note it would pass.
    expect(JSON.stringify(t6.at(-1))).toMatch(/"play_animation\\" needs a shortlisted scene on stage/);
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
