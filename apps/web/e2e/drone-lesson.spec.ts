import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { fakeLog, installVoiceFakes } from "./voiceFakes";

// The drone lesson in the prepared system (step 4 session 1, docs/drone-pid-plan.md): chips only, the
// learner's Run presses waited for, and every number Aili says filled from the run just watched.
// Reduced motion, so each run shows its end at once and the walk-through stays quick.

const replies = (p: Page) => p.getByRole("group", { name: "Suggested replies" });
const lessonChip = (p: Page) => p.getByRole("group", { name: "Lesson" }).getByRole("button");
const runButton = (p: Page) => p.getByRole("button", { name: /^Run( again)?$/ }).first();
const spoken = async (p: Page) => (await fakeLog(p)).spoken;
const said = (p: Page, line: string | RegExp, timeout = 20000) =>
  expect.poll(async () => (await spoken(p)).some((l) => (typeof line === "string" ? l === line : line.test(l))), { timeout }).toBe(true);
const stageOf = async (p: Page) => JSON.parse((await p.locator("[data-viewer]").getAttribute("data-stage"))!) as { scene: string; settings: Record<string, number> };
const PRESS_RUN = "Press Run in the drone controls when you're ready.";

async function answer(page: Page, label: string) {
  await expect(replies(page)).toBeVisible({ timeout: 20000 });
  await replies(page).getByRole("button", { name: label, exact: true }).click();
}

/** The lesson waits for Run: the hint says so; press it. */
async function pressRun(page: Page) {
  await expect(page.getByText(PRESS_RUN)).toBeVisible({ timeout: 20000 });
  await runButton(page).click();
}

test.describe("drone PID lesson, prepared", () => {
  test.use({ reducedMotion: "reduce" });
  test.setTimeout(180_000);

  test("start chip, then the beats in order: the hook, P, D, I, transfer, teach-back, limits", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one full walk-through; the phone layout is checked below");
    await installVoiceFakes(page, { speakMs: 40 });
    await page.goto("/learn?lesson=drone-pid");
    await expect(page.locator('[data-viewer="ready"]')).toBeVisible({ timeout: 20000 });
    await lessonChip(page).filter({ hasText: "Start: a drone holding its height" }).click();

    // Beat 0: the drone is on stage, PID on, starting from a hover; the gust run plays while Aili speaks.
    await said(page, "This drone has no pilot.");
    await expect.poll(async () => (await stageOf(page)).scene).toBe("drone-altitude");
    expect((await stageOf(page)).settings).toMatchObject({ kp_n_per_m: 10, ki_n_per_m_s: 4, kd_n_s_per_m: 6 });
    await answer(page, "Push harder");
    await said(page, "Yes: too low means push harder.");
    // Beat 1: the feedback loop's ring and its three named steps (all at once under reduced motion).
    await expect(page.getByRole("list", { name: "The feedback loop" })).toContainText("Measure", { timeout: 20000 });
    await expect(page.getByRole("list", { name: "The feedback loop" })).toContainText("Correct");

    // Beat 2: P only. The lesson waits for Run, then says the solver's gap.
    await answer(page, "Below it");
    await pressRun(page);
    await said(page, "It rises, bobs, and settles below the line, short by 0.98 m.");
    await said(page, "You predicted below the target, and that is what happened.");
    // The cruise-control analogy: the car on its hill (still frames under reduced motion), P then I, then
    // the car becomes the drone, with the mapping and where it breaks down (D belongs to the drone).
    await expect.poll(async () => (await stageOf(page)).scene, { timeout: 20000 }).toBe("cruise-control-hill");
    const analogy = page.getByRole("region", { name: "Cruise control analogy" });
    await expect(analogy).toContainText("Illustrative animation, not a simulation");
    await expect(analogy).toContainText("P only: on the hill the car settles a little slower than its set speed.");
    await expect(analogy).toContainText("gravity pulling the drone down");
    await said(page, "That step is why the drone bounces and this car doesn't, so the car has no bounce for D to fix. D belongs to the drone.");
    // A much bigger P: the gap and the bounce (in metres) from that run.
    await pressRun(page);
    await said(page, "The gap shrinks to 0.33 m.");
    await said(page, /^But the drone now shoots higher past where it ends up, by \d\.\d\d m, and this time it crosses the target line/);
    await answer(page, "It trades the gap for bounce");

    // Beat 3: D.
    await answer(page, "Ease off early");
    await pressRun(page);
    await said(page, "The bounce is gone. The gap is still there: 0.98 m.");

    // Beat 4: I, then too much I.
    await answer(page, "One that remembers the gap");
    await pressRun(page);
    await said(page, "Now the memory is doing the holding, so the gap can be zero.");
    await pressRun(page);
    await said(page, "It shoots past and rings, and the checks strip warns that it is still oscillating.");
    await expect(page.locator('[data-check="stability"]').first()).toHaveAttribute("data-status", "warn");

    // Beat 5: the heavier drone, then the steady wind.
    await answer(page, "Bigger");
    await pressRun(page);
    await said(page, "The gap grows to 1.47 m.");
    await answer(page, "I");
    await said(page, /^I keeps adding while the drone is low/);

    // Beat 6: teach-back as a self-check (prepared mode); beat 7: limits and what's next.
    await answer(page, "Show me the key points");
    await said(page, "Compare your sentences with these. This is a self-check, not a grade.");
    await said(page, "The numbers teach the idea. They are not settings for tuning a real drone.");
    await expect(replies(page).getByRole("button", { name: "Tell me when it's ready" })).toBeVisible({ timeout: 20000 });
    // The demand log is dev only: this test build answers without writing, and the page says so.
    await replies(page).getByRole("button", { name: "Tell me when it's ready" }).click();
    await expect(page.getByText("Noted (a test build: nothing was written).")).toBeVisible({ timeout: 10000 });

    // No number in anything Aili said was typed into the script: each came from a run (spot check above),
    // and the narration never names overshoot_ratio or a percentage.
    expect((await spoken(page)).join(" ")).not.toMatch(/%|\[missing/);
  });

  test("harder to stop by accident: Escape and the mic while it waits for Run do nothing; after a stop, Run or Continue still plays the explanation", async ({ page }) => {
    await installVoiceFakes(page, { speakMs: 400 });
    await page.goto("/learn?lesson=drone-pid");
    await expect(page.locator('[data-viewer="ready"]')).toBeVisible({ timeout: 20000 });
    await lessonChip(page).filter({ hasText: "Start: a drone holding its height" }).click();
    await answer(page, "Push harder");
    await answer(page, "Below it");
    await expect(page.getByText(PRESS_RUN)).toBeVisible({ timeout: 20000 });
    // Waiting for Run: Escape does not stop the lesson.
    await page.keyboard.press("Escape");
    await expect(lessonChip(page).filter({ hasText: "Continue the lesson" })).toHaveCount(0);
    await runButton(page).click();
    await said(page, "It rises, bobs, and settles below the line, short by 0.98 m.");
    // A stop while Aili explains: "Continue the lesson" replays the explanation from the run already flown.
    await page.keyboard.press("Escape");
    await expect(lessonChip(page).filter({ hasText: "Continue the lesson" })).toBeVisible({ timeout: 10000 });
    const before = (await spoken(page)).length;
    await lessonChip(page).filter({ hasText: "Continue the lesson" }).click();
    await expect.poll(async () => (await spoken(page)).slice(before).some((l) => l.includes("short by 0.98 m")), { timeout: 20000 }).toBe(true);
    expect(await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze().then((r) => r.violations.map((v) => v.id))).toEqual([]);
  });

  test("typed questions get prepared answers, labelled, with the last run's numbers; anything else says plainly it needs the live professor", async ({ page }) => {
    await installVoiceFakes(page, { speakMs: 600 });
    await page.goto("/learn");
    await expect(page.locator('[data-viewer="ready"]')).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("Typed questions get prepared answers here; the live professor is off.")).toBeVisible();
    const box = page.getByRole("textbox", { name: /Ask Aili/ });
    await box.fill("what does P do?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.locator("main").getByText("Prepared answer · not reviewed").first()).toBeVisible({ timeout: 10000 });
    await said(page, "P, for proportional, pushes harder the bigger the gap between the drone and the target.");
    // After a run, the numbers are that run's.
    await page.getByRole("button", { name: /^Run( again)?$/ }).first().click();
    await box.fill("why does it stay below the line?");
    await page.getByRole("button", { name: "Send" }).click();
    await said(page, "In your last run, with P, the gap at the end was 0.98 m.", 30000);
    // Not one of the prepared questions: said plainly, with the prepared questions as chips that send.
    await box.fill("how much does a drone cost?");
    await page.getByRole("button", { name: "Send" }).click();
    await said(page, "I can't answer that here: typed questions need the live professor, which isn't on in this build.");
    await replies(page).getByRole("button", { name: "What does D do?" }).click({ timeout: 15000 });
    await said(page, "D, for derivative, pushes against the drone's speed.");
  });

  test("starting the drone lesson turns Captions on", async ({ page }) => {
    await installVoiceFakes(page, { speakMs: 300 });
    await page.goto("/learn");
    await expect(page.locator('[data-viewer="ready"]')).toBeVisible({ timeout: 20000 });
    const captions = page.getByRole("button", { name: "Captions" });
    await captions.click();
    await expect(captions).toHaveAttribute("aria-pressed", "false");
    await lessonChip(page).filter({ hasText: "Start: a drone holding its height" }).click();
    await expect(captions).toHaveAttribute("aria-pressed", "true");
  });

  test("the drone lesson is the default: its start chip, and the drone at rest on its stage before Start; the lever lesson at ?lesson=lever", async ({ page }) => {
    await installVoiceFakes(page, { speakMs: 40 });
    for (const path of ["/learn", "/learn?demo=1"]) {
      await page.goto(path);
      await expect(page.locator('[data-viewer="ready"]')).toBeVisible({ timeout: 20000 });
      await expect(lessonChip(page)).toHaveText("Start: a drone holding its height");
      expect((await stageOf(page)).scene).toBe("drone-altitude");
    }
    await page.goto("/learn?lesson=lever");
    await expect(page.locator('[data-viewer="ready"]')).toBeVisible({ timeout: 20000 });
    await expect(lessonChip(page)).toHaveText("Start: why reach makes holding harder");
    expect((await stageOf(page)).scene).toBe("base-joint-arm");
  });
});
