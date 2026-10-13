import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { expect, test, type Page, type Route } from "@playwright/test";
import { fakeLog, installVoiceFakes } from "./voiceFakes";

// Demo mode A and the Live AI labels in the browser (docs/m3-live-browser-plan.md slice 2), with
// NO key and NO model: the page's own requests are answered here. GET /api/live says live mode is
// on, and POST /api/turn replays events copied from real live turns (slice 1's live check on
// 13 Oct 2026). This checks the browser side only; the server's live route is unit-tested
// (src/turn/live.test.ts), and the full recorded-provider e2e is slice 6.

type Ev = Record<string, unknown>;
const sse = (events: Ev[], turnRev: number) =>
  events.map((e, seq) => `event: ${e.type}\nid: turn_${turnRev}:${seq}\ndata: ${JSON.stringify({ turn_id: `turn_${turnRev}`, seq, rev: turnRev, ...e })}\n\n`).join("");
const say = (id: string, text: string): Ev => ({ type: "narration", id, text, parts: [{ text }] });

const QUESTION = "Hold a ruler out level with a weight on it: does sliding the weight farther from your hand make it easier, harder, or no different to hold?";
const ON_TOPIC: Ev[] = [
  { type: "turn.started" },
  say("n1", "Robotics is wide, so let's start with one idea that shows up in every arm: how a load far from a joint makes it harder to hold."),
  say("n2", "I'll put a simple scene on stage: holding a ruler out with a weight on it."),
  { type: "action", action: { type: "select_scene", scene: "fx-lever" } },
  { type: "action", action: { type: "highlight_part", part: "weight" } },
  { type: "prompt", text: QUESTION, parts: [{ text: QUESTION }], chips: ["Easier", "Harder", "No different", "Not sure"] },
  { type: "turn.done", move: "probe", explanation: { assumptions: [], limitations: [], evidence: [], calculations: [] } },
];
// A calculation turn, HAND-BUILT in the engine's event format (slice 3): what the panel must show.
const CALC_TURN: Ev[] = [
  { type: "turn.started" },
  { type: "narration", id: "n1", text: "Holding it level takes 0.637 newton-metres.", parts: [{ text: "Holding it level takes " }, { value: "0.637", calc_id: "c1", output: "torque_nm" }, { text: " newton-metres." }] },
  { type: "action", action: { type: "select_scene", scene: "fx-lever" } },
  { type: "calc.result", calc_id: "c1", outputs: { torque_nm: 0.637 } },
  {
    type: "turn.done",
    move: "explain",
    explanation: {
      assumptions: ["The arm is held still (static)."],
      limitations: ["Moving the arm needs more torque than holding it."],
      evidence: ["Fixture book, Fixture section"],
      calculations: [
        {
          title: "Static holding torque of a single arm link",
          fidelity: "verified",
          inputs: [{ label: "Arm length", value: "0.2", unit: "m" }, { label: "Payload", value: "0.3", unit: "kg" }],
          outputs: [{ label: "Torque", value: "0.637", unit: "N·m" }, { label: "Payload torque", value: "0.589", unit: "N·m" }],
        },
      ],
    },
  },
];
const OFF_TOPIC: Ev[] = [
  { type: "turn.started" },
  say("n1", "Guitar isn't something I can teach yet; my material covers robotics, not music."),
  say("n2", "The nearest thing I can teach is how a lever, like a ruler held out with a weight, loads a joint."),
  { type: "turn.done", move: "answer", explanation: { assumptions: [], limitations: [], evidence: [], calculations: [] } },
];

const stageLive = (p: Page) => p.locator('[data-badge="live"]');
const welcome = (p: Page) => p.getByRole("region", { name: "What do you want to learn?" });
const stageEl = (p: Page) => p.getByRole("region", { name: "Stage" });
const prepared = (p: Page) => p.getByRole("button", { name: /^Prepared · / });
const box = (p: Page, name: string) => p.getByRole("textbox", { name });
const replies = (p: Page) => p.getByRole("group", { name: "Suggested replies" });

/** Live mode on; each turn request is recorded and answered with the next scripted turn. */
async function openLive(page: Page, turns: Ev[][]) {
  const sent: Array<{ text: string; state_rev: number }> = [];
  await page.route("**/api/live", (r: Route) => r.fulfill({ json: { live: true } }));
  await page.route("**/api/turn/interrupt", (r: Route) => r.fulfill({ json: { stopped: false } }));
  await page.route("**/api/turn", async (r: Route) => {
    const body = r.request().postDataJSON() as { state_rev: number; input: { text: string } };
    sent.push({ text: body.input.text, state_rev: body.state_rev });
    const events = turns[sent.length - 1] ?? OFF_TOPIC;
    await r.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: sse(events, body.state_rev) });
  });
  await installVoiceFakes(page, { speakMs: 150 });
  await page.goto("/learn");
  await expect(welcome(page)).toBeVisible({ timeout: 20000 });
  return sent;
}

test.describe("live mode (demo mode A), browser side, mocked server", () => {
  test.setTimeout(60_000);

  test("opens on a centred welcome over the dimmed stage: no chips, no topic, no badge, no bottom box", async ({ page }) => {
    await openLive(page, []);
    const input = box(page, "What do you want to learn?");
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("");
    await expect(input).toHaveAccessibleDescription(/Live AI: your message goes to a real AI model/);
    await expect(page.getByRole("heading", { name: "What do you want to learn?" })).toBeVisible();
    await expect(replies(page)).toHaveCount(0); // no suggestion chips
    await expect(page.getByRole("group", { name: "Lesson" })).toHaveCount(0);
    await expect(page.getByText(/^Start: why reach makes holding harder/)).toHaveCount(0);
    await expect(prepared(page)).toHaveCount(0); // no "Prepared · Draft" until a scene is picked
    await expect(page.locator("[data-badge]")).toHaveCount(0);
    await expect(stageEl(page)).toHaveAttribute("data-dimmed", "");
    await expect(box(page, "Ask Aili or answer")).toHaveCount(0); // the welcome holds the only box
    // The welcome is centred on the stage, and Send is a 44 px target.
    const st = (await stageEl(page).boundingBox())!;
    const card = (await page.locator("form", { has: input }).boundingBox())!;
    expect(Math.abs(card.x + card.width / 2 - (st.x + st.width / 2))).toBeLessThan(2);
    expect((await page.getByRole("button", { name: "Send" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // Space types a space here; it never starts voice.
    await input.pressSequentially("a b");
    await expect(input).toHaveValue("a b");
    await expect(page.locator('button[data-state="listening"]')).toHaveCount(0);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations.map((v) => v.id)).toEqual([]);
  });

  test("an on-topic message: both labels, the question shown and spoken last, chips; a chip sends the reply", async ({ page }) => {
    const sent = await openLive(page, [ON_TOPIC, OFF_TOPIC]);
    await box(page, "What do you want to learn?").fill("teach me robotics");
    await page.getByRole("button", { name: "Send" }).click();
    // The welcome moves away and the normal bottom box takes over, focused.
    await expect(welcome(page)).toHaveCount(0);
    await expect(box(page, "Ask Aili or answer")).toBeFocused();
    // The question stays as the last caption, with both labels on it and on the stage.
    const caption = page.locator("main").getByText(QUESTION);
    await expect(caption).toBeVisible({ timeout: 15000 });
    await expect(page.locator("main").getByText("Live AI", { exact: true })).toBeVisible();
    await expect(page.locator("main").getByText("Test fixture content", { exact: true })).toBeVisible();
    await expect(stageLive(page)).toHaveText(/Live AI · Test fixture content/);
    // Aili picked a scene: the stage is no longer dimmed, and its badge describes that scene.
    await expect(stageEl(page)).not.toHaveAttribute("data-dimmed", "");
    await expect(prepared(page)).toBeVisible();
    await expect(page.locator('[data-badge="fixture"]')).toHaveCount(0); // not the fake director's label
    await expect(page.getByRole("button", { name: /^Parts/ })).toHaveText("Parts: Weight"); // the action applied
    await expect.poll(async () => (await fakeLog(page)).spoken.at(-1)).toBe(QUESTION);
    await expect(replies(page).getByRole("button")).toHaveText(["Easier", "Harder", "No different", "Not sure"]);

    await replies(page).getByRole("button", { name: "Harder" }).click();
    await expect.poll(() => sent.map((s) => s.text)).toEqual(["teach me robotics", "Harder"]);
    expect(sent[1]!.state_rev).toBeGreaterThan(sent[0]!.state_rev);
    await expect(box(page, "Ask Aili or answer")).toHaveValue(""); // sent, not left in the box
  });

  test("an off-topic message: said plainly; no scene picked, so the stage stays dimmed and unbadged", async ({ page }) => {
    await openLive(page, [OFF_TOPIC]);
    await box(page, "What do you want to learn?").fill("teach me guitar");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.locator("main").getByText(/nearest thing I can teach/)).toBeVisible({ timeout: 15000 });
    await expect(page.locator("main").getByText("Live AI", { exact: true })).toBeVisible(); // on the caption
    await expect(stageEl(page)).toHaveAttribute("data-dimmed", "");
    await expect(prepared(page)).toHaveCount(0);
    await expect(replies(page)).toHaveCount(0);
  });

  test("the explanation panel: the current step's values, units, evidence, assumptions and limits, labelled Live AI; earlier steps collapsed; no IDs", async ({ page }) => {
    await openLive(page, [ON_TOPIC, CALC_TURN]);
    await box(page, "What do you want to learn?").fill("teach me robotics");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(replies(page).getByRole("button")).toHaveCount(4, { timeout: 15000 });
    await replies(page).getByRole("button", { name: "Harder" }).click();
    await expect(page.locator("main [data-calculated]").first()).toBeVisible({ timeout: 15000 });
    // The panel stays closed until asked for.
    await expect(page.locator("#learn-side")).toHaveCount(0);
    await page.getByRole("button", { name: "Explanation" }).click();
    const panel = page.locator("#learn-tabpanel");
    await expect(panel.getByRole("heading", { name: "This step" })).toBeVisible();
    await expect(panel.getByText("Live AI", { exact: true }).first()).toBeVisible();
    await expect(panel.getByText("Test fixture content", { exact: true }).first()).toBeVisible();
    const line = panel.locator("p", { hasText: "Holding it level takes" });
    await expect(line).toBeVisible();
    await expect(line.locator("[data-calculated]")).toHaveText("0.637, calculated"); // marked as in the caption
    await expect(panel.locator("dl")).toContainText("Torque");
    await expect(panel.locator("dl [data-calculated]").first()).toHaveText("0.637 N·m, calculated");
    await expect(panel.getByText("Using: arm length 0.2 m, payload 0.3 kg.")).toBeVisible();
    await expect(panel.getByText("Fixture book, Fixture section")).toBeVisible();
    await expect(panel.getByText("The arm is held still (static).")).toBeVisible();
    await expect(panel.getByText("Moving the arm needs more torque than holding it.")).toBeVisible();
    // Only the current step shows; the first turn waits, collapsed, under "Earlier steps".
    const history = panel.locator("details");
    await expect(history.locator("summary")).toHaveText("Earlier steps (1)");
    await expect(history).not.toHaveAttribute("open", "");
    await expect(panel.getByText(QUESTION)).toBeHidden();
    await history.locator("summary").click();
    await expect(panel.getByText(QUESTION)).toBeVisible();
    // No calculation, solver, reading or source ID anywhere in the panel.
    expect(await panel.innerText()).not.toMatch(/\bc\d+\b|solver\.|read\.|src\.|torque_nm/);
    expect((await new AxeBuilder({ page }).include("#learn-side").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations.map((v) => v.id)).toEqual([]);
  });

  test("with reduced motion the welcome goes at once", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openLive(page, [ON_TOPIC]);
    const seconds = await welcome(page).evaluate((el) => Math.max(...getComputedStyle(el).transitionDuration.split(",").map(parseFloat)));
    expect(seconds).toBeLessThan(0.01); // the reduced-motion tokens
    await box(page, "What do you want to learn?").fill("teach me robotics");
    await page.keyboard.press("Enter");
    await expect(welcome(page)).toHaveCount(0, { timeout: 200 });
  });

  // Screenshots for Lucky (git-ignored folder apps/web/screenshots/live-opening): desktop and phone
  // widths, light and dark, before and after the first message. Run once, from the desktop project.
  test("screenshots of the opening state", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "taken once");
    const dir = "screenshots/live-opening";
    mkdirSync(dir, { recursive: true });
    for (const [width, height, name] of [[1280, 800, "desktop"], [412, 915, "phone"]] as const)
      for (const scheme of ["light", "dark"] as const) {
        await page.setViewportSize({ width, height });
        await page.emulateMedia({ colorScheme: scheme });
        await openLive(page, [ON_TOPIC]);
        await expect(page.locator('[data-viewer="ready"]')).toBeVisible({ timeout: 20000 });
        await page.mouse.move(0, 0);
        await page.screenshot({ path: `${dir}/${name}-${scheme}-1-before.png` });
        await box(page, "What do you want to learn?").fill("teach me robotics");
        await page.getByRole("button", { name: "Send" }).click();
        await expect(replies(page).getByRole("button")).toHaveCount(4, { timeout: 15000 });
        await page.screenshot({ path: `${dir}/${name}-${scheme}-2-after.png` });
        await page.unrouteAll({ behavior: "ignoreErrors" });
      }
  });

  test("live mode off (the server says no): the prepared page as before", async ({ page }) => {
    await page.route("**/api/live", (r: Route) => r.fulfill({ json: { live: false } }));
    await installVoiceFakes(page);
    await page.goto("/learn");
    await expect(box(page, "Ask Aili or answer")).toBeVisible();
    await expect(page.getByText(/^Start: why reach makes holding harder/)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Live AI: your message/)).toHaveCount(0);
  });
});
