import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { fakeLog, installVoiceFakes } from "./voiceFakes";

// Beginner lever lesson (M1 slice 4c part 2): prepared demo, no live AI. Speech engines are fakes.
// Needs NEXT_PUBLIC_AILI_INCLUDE_DRAFTS=1 in apps/web/.env.local (the scenes are drafts).

const replies = (p: Page) => p.getByRole("group", { name: "Suggested replies" });
const lessonChip = (p: Page) => p.getByRole("group", { name: "Lesson" }).getByRole("button");
const caption = (p: Page, text: string | RegExp) => p.locator("main").getByText(text);
const gauge = (p: Page) => p.getByRole("region", { name: "Effort to hold" });
const badge = (p: Page) => p.getByRole("button", { name: /^Prepared · / });
const partsButton = (p: Page) => p.getByRole("button", { name: /^Parts/ });
/** Every line Aili spoke, in order (from the speech fake). Short lines can be on screen too briefly to poll. */
const spoken = async (p: Page) => (await fakeLog(p)).spoken;
const saidLine = (p: Page, line: string | RegExp, timeout = 15000) =>
  expect.poll(async () => (await spoken(p)).some((l) => (typeof line === "string" ? l === line : line.test(l))), { timeout }).toBe(true);
const gaugeWidth = (p: Page) => gauge(p).locator("div[aria-hidden] > div").evaluate((el) => (el as HTMLElement).style.width);

const axe = async (p: Page) =>
  (await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze()).violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`,
  );

async function openLearn(page: Page, speakMs = 200) {
  await installVoiceFakes(page, { speakMs });
  await page.goto("/learn");
  await expect(page.locator('[data-viewer="ready"]')).toBeVisible({ timeout: 20000 });
}

async function startLesson(page: Page) {
  await lessonChip(page).filter({ hasText: /Start/ }).click();
}

const shot = async (page: Page, name: string, info: { outputPath: (n: string) => string }) => {
  await page.mouse.move(0, 0);
  await page.screenshot({ path: info.outputPath(`${name}.png`) });
};

test.describe("beginner lever lesson", () => {
  test.setTimeout(150_000);

  test("plays the whole path: framing, probe, commit, reveal, link, check", async ({ page }, info) => {
    await openLearn(page);
    await expect(replies(page)).toHaveCount(0); // no question open before the lesson asks one
    await startLesson(page);

    // Framing: the lever scene, a draft, hand end labelled.
    await saidLine(page, "Here is a ruler held out at one end, with a weight resting on it.");
    await expect(badge(page)).toHaveText("Prepared · Draft (not expert-reviewed)");
    await expect(page.locator('span[data-part-id="hand"]')).toBeVisible();
    await shot(page, "beat-1-framing", info);

    // Probe: exactly one open question, with Not sure.
    await expect(replies(page)).toBeVisible({ timeout: 15000 });
    await expect(replies(page).getByRole("button")).toHaveText(["Close to you", "Far from you", "Not sure"]);
    await expect(caption(page, "Which is harder to hold out: the weight close to you, or far from you?")).toBeVisible();
    await expect(gauge(page)).toHaveCount(0); // the gauge would give the answer away
    await shot(page, "beat-2-probe", info);

    // Commit.
    await replies(page).getByRole("button", { name: "Far from you" }).click();
    await expect(replies(page)).toHaveCount(0);
    await saidLine(page, "Got it. Let's test your guess.");
    await shot(page, "beat-3-commit", info);

    // Reveal: the gauge rises; prediction next to result; no numbers in the gauge.
    await expect(gauge(page)).toBeVisible({ timeout: 15000 });
    await expect(gauge(page)).toContainText("Illustrative");
    await expect(gauge(page)).toContainText("You said: Far from you");
    await expect(gauge(page).getByText("Result: harder with the weight far from your hand.")).toBeVisible({ timeout: 15000 });
    await expect(gauge(page).getByText("Harder", { exact: true })).toBeVisible();
    expect(await gauge(page).innerText()).not.toMatch(/\d/);
    await saidLine(page, "You predicted far is harder, and that is what happened.");
    await shot(page, "beat-4-reveal", info);

    // Link: the arm scene, same idea.
    await saidLine(page, "A robot arm works the same way.");
    await expect(partsButton(page)).toHaveText(/^Parts: (Arm|End weight)$/); // arm scene (the check moves on to the end weight)
    await expect(gauge(page)).toHaveCount(0);
    await shot(page, "beat-5-link", info);

    // Check: one question about the arm; the answer is recorded; no mastery claim.
    await expect(replies(page).getByRole("button")).toHaveText(["Harder", "Easier", "Not sure"], { timeout: 20000 });
    await shot(page, "beat-6-check", info);
    await replies(page).getByRole("button", { name: "Easier" }).click();
    await saidLine(page, /^Yes: closer to the servo means a shorter distance/);
    await saidLine(page, "That's one answer, not a test result. We'll come back to this idea in another way later.");
    await expect(caption(page, "That's one answer, not a test result. We'll come back to this idea in another way later.")).toBeVisible();
    await expect(lessonChip(page)).toHaveText("Start the lesson again", { timeout: 10000 });
    for (const word of [/master/i, /expert now/i, /great job/i, /perfect/i]) await expect(page.locator("main")).not.toContainText(word);
    await shot(page, "beat-7-done", info);
  });

  test("'Not sure' gets an honest, plain answer", async ({ page }) => {
    await openLearn(page);
    await startLesson(page);
    await replies(page).getByRole("button", { name: "Not sure" }).click({ timeout: 15000 });
    await expect(gauge(page)).toContainText("You said: Not sure", { timeout: 15000 });
    await saidLine(page, "You weren't sure, and that's a fair place to start. Here is what happened: far from you is harder.");
  });

  test("a wrong prediction is explained, not marked as failure", async ({ page }) => {
    await openLearn(page);
    await startLesson(page);
    await replies(page).getByRole("button", { name: "Close to you" }).click({ timeout: 15000 });
    await saidLine(page, "You expected close to be harder. It is the other way round, and here is why.");
    await expect(page.locator("main")).not.toContainText(/wrong|fail|incorrect/i);
  });

  test("interrupt mid-reveal stops the weight and the lesson; Continue replays the beat", async ({ page }) => {
    await openLearn(page, 3000); // slow speech: the reveal is still playing when we stop
    await startLesson(page);
    await replies(page).getByRole("button", { name: "Far from you" }).click({ timeout: 30000 });
    await expect(gauge(page)).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(400); // the weight is moving
    await page.locator("button[data-state]:visible").click(); // Stop
    await expect(page.locator('p[role="status"][data-state]')).toHaveText("Stopped");
    const w1 = await gaugeWidth(page);
    await page.waitForTimeout(1200);
    expect(await gaugeWidth(page)).toBe(w1); // stale animation frames were dropped
    await expect(lessonChip(page)).toHaveText("Continue the lesson");
    await lessonChip(page).click();
    await expect(gauge(page).getByText(/Result: harder/)).toBeVisible({ timeout: 20000 });
  });

  test("typing a new question stops the lesson and its open question", async ({ page }) => {
    await openLearn(page);
    await startLesson(page);
    await expect(replies(page).getByRole("button", { name: "Not sure" })).toBeVisible({ timeout: 15000 });
    await page.getByRole("textbox", { name: "Ask Aili or answer" }).fill("What is a servo?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(replies(page).getByRole("button", { name: "Far from you" })).toHaveCount(0);
    await saidLine(page, "This is a prepared demo line, not a live answer.");
  });

  test("reduced motion: the weight steps without tweening; the result is still shown and announced", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openLearn(page);
    await startLesson(page);
    await replies(page).getByRole("button", { name: "Far from you" }).click({ timeout: 15000 });
    await expect(gauge(page)).toBeVisible({ timeout: 15000 });
    // Sample the bar until the result shows: a few still steps, not a smooth slide.
    const widths = new Set<string>();
    const result = gauge(page).getByText("Result: harder with the weight far from your hand.");
    for (let i = 0; i < 60 && !(await result.isVisible()); i++) {
      widths.add(await gaugeWidth(page));
      await page.waitForTimeout(60);
    }
    expect(widths.size).toBeGreaterThanOrEqual(2);
    expect(widths.size).toBeLessThanOrEqual(4);
    await expect(result).toBeVisible();
    await expect(gauge(page).getByText("Result: harder with the weight far from your hand.")).toHaveAttribute("aria-live", "polite");
  });

  test("the text panel follows the lesson; captions keep running when muted", async ({ page }) => {
    await openLearn(page);
    await page.getByRole("button", { name: "Mute" }).click();
    await startLesson(page);
    const panel = page.getByRole("complementary");
    const explanationBtn = page.getByRole("button", { name: "Explanation" });
    await explanationBtn.click();
    await expect(panel).toContainText("Aili explains after you answer the question on the stage.");
    // Muted captions advance on timers (no speech), so the probe takes longer to arrive.
    await expect(caption(page, "Which is harder to hold out: the weight close to you, or far from you?")).toBeVisible({ timeout: 40000 });
    await panel.getByRole("button", { name: "Close" }).click(); // on phones the sheet covers the chips
    await replies(page).getByRole("button", { name: "Far from you" }).click();
    await explanationBtn.click();
    await expect(panel).toContainText("Distance from the grip changes the effort", { timeout: 40000 });
    await expect(panel).toContainText("Draft (not expert-reviewed)");
    await expect(panel).toContainText("Same idea, robot arm", { timeout: 60000 });
    expect((await fakeLog(page)).spoken).toEqual([]); // muted all along
  });

  test("without WebGL the lesson still runs on the still pictures", async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (/webgl/i.test(type)) return null;
        return (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof original;
    });
    await installVoiceFakes(page, { speakMs: 200 });
    await page.goto("/learn");
    await startLesson(page);
    await expect(page.getByRole("img", { name: /Still side view of the ruler held out with a weight/ })).toBeVisible({ timeout: 15000 });
    await replies(page).getByRole("button", { name: "Far from you" }).click({ timeout: 15000 });
    await expect(gauge(page).getByText(/Result: harder/)).toBeVisible({ timeout: 20000 });
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`axe at the probe and the reveal, ${scheme}`, async ({ page }, info) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openLearn(page);
      await startLesson(page);
      await expect(replies(page)).toBeVisible({ timeout: 15000 });
      expect(await axe(page)).toEqual([]);
      await replies(page).getByRole("button", { name: "Far from you" }).click();
      await expect(gauge(page).getByText(/Result: harder/)).toBeVisible({ timeout: 20000 });
      expect(await axe(page)).toEqual([]);
      await shot(page, `reveal-${scheme}`, info);
    });
  }
});

test.describe("labels never overlap each other", () => {
  const visibleLabelBoxes = async (page: Page) => {
    const out: Array<{ id: string; x: number; y: number; width: number; height: number }> = [];
    for (const l of await page.locator("span[data-part-id]").all()) {
      if (!(await l.isVisible()) || (await l.evaluate((el) => getComputedStyle(el).visibility === "hidden"))) continue;
      out.push({ id: (await l.getAttribute("data-part-id"))!, ...(await l.boundingBox())! });
    }
    return out;
  };
  const expectNoOverlap = (boxes: Awaited<ReturnType<typeof visibleLabelBoxes>>) => {
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const hit = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
        expect(hit, `${a.id} overlaps ${b.id}`).toBe(false);
      }
  };

  test("phone width, weight next to the hand: 'Selected: Weight' and the hand label stay apart", async ({ page }, info) => {
    test.skip(info.project.name !== "phone", "phone width");
    await openLearn(page);
    await startLesson(page);
    await expect(replies(page)).toBeVisible({ timeout: 15000 }); // probe: weight selected, close to the hand
    await page.waitForTimeout(300);
    const boxes = await visibleLabelBoxes(page);
    expect(boxes.map((b) => b.id).sort()).toEqual(["hand", "weight"]);
    expectNoOverlap(boxes);
    await page.screenshot({ path: info.outputPath("labels-phone-probe.png") });
  });

  test("arm scene with every label on", async ({ page }) => {
    await openLearn(page);
    await page.getByRole("button", { name: "Labels" }).click();
    await page.waitForTimeout(300);
    expectNoOverlap(await visibleLabelBoxes(page));
  });
});
