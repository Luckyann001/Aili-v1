import { expect, test } from "@playwright/test";
import { filesWithFixtureText } from "./fixture-text";

// The fake-director turn route in a real production build WITH the demo flag (M2 slice 6a).
// The UI wiring is slice 6b; these call the route directly.

const body = (o: object = {}) => ({
  session_id: "e2e-route-0001",
  state_rev: 3,
  case: "valid",
  input: { text: "Why is it hard to hold?" },
  ...o,
});

test.describe("fake-director turn route (demo flag on)", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "route checks run once"));

  test("streams a whole turn as Server-Sent Events", async ({ request }) => {
    const res = await request.post("/api/turn", { data: body() });
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/^text\/event-stream/);
    const text = await res.text();
    const types = [...text.matchAll(/^event: (.+)$/gm)].map((m) => m[1]);
    expect(types).toEqual(["turn.started", "narration", "narration", "action", "action", "action", "calc.result", "prompt", "turn.done"]);
    expect(text).toContain('"value":"0.637"'); // the solver's number, marked as calculated
  });

  test("rejects bad input (including any attempt to send history) and answers an interrupt for an unknown turn plainly", async ({ request }) => {
    expect((await request.post("/api/turn", { data: body({ case: "real-model" }) })).status()).toBe(400);
    expect((await request.post("/api/turn", { data: body({ state: { history: { posture: "answer", learner_level: "true_beginner", entries: [] } } }) })).status()).toBe(400);
    const stop = await request.post("/api/turn/interrupt", { data: { session_id: "e2e-route-0001", request_id: "turn_99", state_rev: 99 } });
    expect(await stop.json()).toEqual({ stopped: false });
  });

  test("this build contains the test fixtures (control for the no-drafts build check)", () => {
    expect(filesWithFixtureText(".next-e2e").length).toBeGreaterThan(0);
  });
});
