import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { installVoiceFakes } from "./voiceFakes";

// The whole live path in the browser with the RECORDED provider (docs/m3-live-browser-plan.md
// slice 6): this test build is made with AILI_E2E_RECORDED_LIVE=1, and the test's cookie sends its
// requests down the real live route, answered from e2e/fixtures/live-recording.json (hand-written in
// the engine's response shape). No key, no network, no spend. Without the cookie the page is the
// normal prepared page, so the other specs are unaffected.

const QUESTION = "If the weight slides farther from your hand, does it get harder, easier, or no different to hold?";
const welcomeBox = (p: Page) => p.getByRole("textbox", { name: "What do you want to learn?" });
const stage = (p: Page) => p.getByRole("region", { name: "Stage" });
const replies = (p: Page) => p.getByRole("group", { name: "Suggested replies" });
const axe = async (p: Page) =>
  (await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze()).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`);

test.describe("live path with the recorded provider (slice 6)", () => {
  test.setTimeout(90_000);

  test.beforeEach(async ({ page, baseURL }) => {
    await page.context().addCookies([{ name: "aili-e2e-live", value: "1", url: baseURL! }]);
  });

  test("type → question with chips → tap a chip → calculated value → stage action → explanation panel", async ({ page }) => {
    await installVoiceFakes(page, { speakMs: 150 });
    await page.goto("/learn");
    await expect(welcomeBox(page)).toBeVisible({ timeout: 20_000 });
    await expect(stage(page)).toHaveAttribute("data-dimmed", "");
    expect(await axe(page)).toEqual([]);

    // Turn 1: a prediction with chips; the lever goes on stage with the weight highlighted.
    await welcomeBox(page).fill("teach me robotics");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.locator("main").getByText(QUESTION)).toBeVisible({ timeout: 20_000 });
    await expect(replies(page).getByRole("button")).toHaveText(["It gets harder", "It gets easier", "No different", "Not sure"]);
    await expect(stage(page)).not.toHaveAttribute("data-dimmed", "");
    await expect(page.locator('[data-badge="live"]')).toHaveText(/Live AI · Test fixture content/);
    await expect(page.getByRole("button", { name: /^Prepared · / })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Parts/ })).toHaveText("Parts: Weight");

    // Turn 2: the chip is the reply; a calculated value, marked as calculated, in the caption.
    await replies(page).getByRole("button", { name: "It gets harder" }).click();
    const calc = page.locator("main [data-calculated]").first();
    await expect(calc).toBeVisible({ timeout: 20_000 });
    await expect(calc).toHaveText(/^\d+(\.\d+)?, calculated$/);
    await expect(page.locator("main").getByText("Live AI", { exact: true }).first()).toBeVisible();

    // The explanation panel: the current step, its values with units, evidence and limits; no IDs.
    await page.getByRole("button", { name: "Explanation" }).click();
    const panel = page.locator("#learn-tabpanel");
    await expect(panel.getByRole("heading", { name: "This step" })).toBeVisible();
    await expect(panel.locator("dl")).toContainText("Torque");
    await expect(panel.locator("dl [data-calculated]").first()).toHaveText(/ N·m, calculated$/);
    await expect(panel.getByText(/^Using: arm length 0\.3 m, payload 0\.2 kg/)).toBeVisible();
    await expect(panel.getByText("Fixture book, Fixture section")).toBeVisible();
    await expect(panel.getByText("no acceleration or friction")).toBeVisible();
    await expect(panel.locator("details summary")).toHaveText("Earlier steps (1)");
    expect(await panel.innerText()).not.toMatch(/\bc\d+\b|solver\.|read\.|src\.|_nm\b|p-turn/);
    expect(await axe(page)).toEqual([]);

    // Phone layout (on the phone project): nothing scrolls sideways.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });

  test("without the test's cookie the page is the normal prepared page", async ({ page }) => {
    await installVoiceFakes(page, { speakMs: 150 });
    await page.context().clearCookies();
    await page.goto("/learn");
    await expect(page.getByRole("textbox", { name: "Ask Aili or answer" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/^Start: why reach makes holding harder/)).toBeVisible();
    await expect(welcomeBox(page)).toHaveCount(0);
  });

  // M4 slice 1: visuals follow the explanation. The recording binds the scene and the highlight to
  // the SECOND segment ("Here is a ruler…"), so during the first segment the stage must still be
  // dimmed, and the scene must appear as the second segment starts: with voice on and captions only.
  const FIRST = /^Robotics is broad/;
  const SECOND = /^Here is a ruler held out from a hand/;
  const caption = (p: Page) => p.locator("main [aria-live]").last();

  for (const mode of ["voice on", "captions only"] as const) {
    test(`${mode}: the scene appears with the segment that names it, not before`, async ({ page }) => {
      await installVoiceFakes(page, { speakMs: 3000 });
      await page.goto("/learn");
      await expect(welcomeBox(page)).toBeVisible({ timeout: 20_000 });
      if (mode === "captions only") await page.getByRole("button", { name: "Mute" }).click();
      await welcomeBox(page).fill("teach me robotics");
      await page.getByRole("button", { name: "Send" }).click();
      await expect(caption(page)).toHaveText(FIRST, { timeout: 20_000 });
      // The whole turn has arrived, but its actions wait for their segment.
      await expect(stage(page)).toHaveAttribute("data-dimmed", "");
      await expect(page.getByRole("button", { name: /^Parts/ })).toHaveCount(0);
      await expect(caption(page)).toHaveText(SECOND, { timeout: 10_000 });
      await expect(stage(page)).not.toHaveAttribute("data-dimmed", "");
      await expect(page.getByRole("button", { name: /^Parts/ })).toHaveText("Parts: Weight");
    });
  }

  test("interrupt during the first segment: queued actions never run, the server is told, the panel says where it stopped", async ({ page }) => {
    const interrupts: Array<{ shown_through?: string | null }> = [];
    page.on("request", (r) => {
      if (r.url().endsWith("/api/turn/interrupt")) interrupts.push(r.postDataJSON() as { shown_through?: string | null });
    });
    await installVoiceFakes(page, { speakMs: 4000 });
    await page.goto("/learn");
    await expect(welcomeBox(page)).toBeVisible({ timeout: 20_000 });
    await welcomeBox(page).fill("teach me robotics");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(caption(page)).toHaveText(FIRST, { timeout: 20_000 });
    await page.keyboard.press("Escape");
    await expect(page.locator('p[role="status"][data-state]')).toHaveText(/Stopped\./);
    await page.waitForTimeout(4500); // past where the second segment would have started
    await expect(stage(page)).toHaveAttribute("data-dimmed", "");
    await expect(page.getByRole("button", { name: /^Parts/ })).toHaveCount(0);
    await expect.poll(() => interrupts.map((b) => b.shown_through)).toEqual(["n1"]);
    await page.getByRole("button", { name: "Explanation" }).click();
    const panel = page.locator("#learn-tabpanel");
    await expect(panel.getByText(FIRST)).toBeVisible();
    await expect(panel.getByText(SECOND)).toHaveCount(0);
    await expect(panel.getByText("Stopped here.")).toBeVisible();
    await expect(panel.getByText(QUESTION)).toHaveCount(0);
    expect(await axe(page)).toEqual([]);
  });
});
