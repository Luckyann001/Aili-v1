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

    // Beat 2: P only. The lesson waits for Run, then says the solver's gap.
    await answer(page, "Below it");
    await pressRun(page);
    await said(page, "It rises, bobs, and settles below the line, short by 0.98 m.");
    await said(page, "You predicted below the target, and that is what happened.");
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

    // No number in anything Aili said was typed into the script: each came from a run (spot check above),
    // and the narration never names overshoot_ratio or a percentage.
    expect((await spoken(page)).join(" ")).not.toMatch(/%|\[missing/);
  });

  test("a stop while the lesson waits for Run: pressing Run later does not restart it", async ({ page }) => {
    await installVoiceFakes(page, { speakMs: 40 });
    await page.goto("/learn?lesson=drone-pid");
    await expect(page.locator('[data-viewer="ready"]')).toBeVisible({ timeout: 20000 });
    await lessonChip(page).filter({ hasText: "Start: a drone holding its height" }).click();
    await answer(page, "Push harder");
    await answer(page, "Below it");
    await expect(page.getByText(PRESS_RUN)).toBeVisible({ timeout: 20000 });
    await page.keyboard.press("Escape");
    await expect(lessonChip(page).filter({ hasText: "Continue the lesson" })).toBeVisible();
    const before = (await spoken(page)).length;
    await runButton(page).click();
    await page.waitForTimeout(800);
    expect((await spoken(page)).slice(before).some((l) => l.includes("short by"))).toBe(false);
    expect(await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze().then((r) => r.violations.map((v) => v.id))).toEqual([]);
  });

  test("the lever lesson is still the default lesson", async ({ page }) => {
    await installVoiceFakes(page, { speakMs: 40 });
    await page.goto("/learn");
    await expect(page.locator('[data-viewer="ready"]')).toBeVisible({ timeout: 20000 });
    await expect(lessonChip(page).filter({ hasText: "Start: why reach makes holding harder" })).toBeVisible();
  });
});
