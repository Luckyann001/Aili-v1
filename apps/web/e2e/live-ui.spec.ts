import AxeBuilder from "@axe-core/playwright";
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
  { type: "turn.done", move: "probe" },
];
const OFF_TOPIC: Ev[] = [
  { type: "turn.started" },
  say("n1", "Guitar isn't something I can teach yet; my material covers robotics, not music."),
  say("n2", "The nearest thing I can teach is how a lever, like a ruler held out with a weight, loads a joint."),
  { type: "turn.done", move: "answer" },
];

const stageLive = (p: Page) => p.locator('[data-badge="live"]');
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
  await expect(page.locator('[data-viewer="ready"]')).toBeVisible({ timeout: 20000 });
  return sent;
}

test.describe("live mode (demo mode A), browser side, mocked server", () => {
  test.setTimeout(60_000);

  test("opens on an empty 'What do you want to learn?' box, with no lesson offered and the live note", async ({ page }) => {
    await openLive(page, []);
    const input = box(page, "What do you want to learn?");
    await expect(input).toBeVisible();
    await expect(input).toHaveValue("");
    await expect(input).toHaveAccessibleDescription(/Live AI: your message goes to a real AI model/);
    await expect(page.getByRole("group", { name: "Lesson" })).toHaveCount(0);
    await expect(page.getByText(/^Start: why reach makes holding harder/)).toHaveCount(0);
    await expect(stageLive(page)).toHaveCount(0); // nothing live on stage yet
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations.map((v) => v.id)).toEqual([]);
  });

  test("an on-topic message: both labels, the question shown and spoken last, chips; a chip sends the reply", async ({ page }) => {
    const sent = await openLive(page, [ON_TOPIC, OFF_TOPIC]);
    await box(page, "What do you want to learn?").fill("teach me robotics");
    await page.getByRole("button", { name: "Send" }).click();
    // The question stays as the last caption, with both labels on it and on the stage.
    const caption = page.locator("main").getByText(QUESTION);
    await expect(caption).toBeVisible({ timeout: 15000 });
    await expect(page.locator("main").getByText("Live AI", { exact: true })).toBeVisible();
    await expect(page.locator("main").getByText("Test fixture content", { exact: true })).toBeVisible();
    await expect(stageLive(page)).toHaveText(/Live AI · Test fixture content/);
    await expect(page.locator('[data-badge="fixture"]')).toHaveCount(0); // not the fake director's label
    await expect(page.getByRole("button", { name: /^Parts/ })).toHaveText("Parts: Weight"); // the action applied
    await expect.poll(async () => (await fakeLog(page)).spoken.at(-1)).toBe(QUESTION);
    await expect(replies(page).getByRole("button")).toHaveText(["Easier", "Harder", "No different", "Not sure"]);
    // After the first message the box goes back to its usual label.
    await expect(box(page, "Ask Aili or answer")).toBeVisible();

    await replies(page).getByRole("button", { name: "Harder" }).click();
    await expect.poll(() => sent.map((s) => s.text)).toEqual(["teach me robotics", "Harder"]);
    expect(sent[1]!.state_rev).toBeGreaterThan(sent[0]!.state_rev);
    await expect(box(page, "Ask Aili or answer")).toHaveValue(""); // sent, not left in the box
  });

  test("an off-topic message: said plainly, nothing on stage changes", async ({ page }) => {
    await openLive(page, [OFF_TOPIC]);
    const parts = await page.getByRole("button", { name: /^Parts/ }).innerText();
    await box(page, "What do you want to learn?").fill("teach me guitar");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.locator("main").getByText(/nearest thing I can teach/)).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("button", { name: /^Parts/ })).toHaveText(parts);
    await expect(replies(page)).toHaveCount(0);
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
