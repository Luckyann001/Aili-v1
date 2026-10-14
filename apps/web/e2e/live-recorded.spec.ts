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
    await installVoiceFakes(page, { speakMs: 150 });
  });

  test("type → question with chips → tap a chip → calculated value → stage action → explanation panel", async ({ page }) => {
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
    await page.context().clearCookies();
    await page.goto("/learn");
    await expect(page.getByRole("textbox", { name: "Ask Aili or answer" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/^Start: why reach makes holding harder/)).toBeVisible();
    await expect(welcomeBox(page)).toHaveCount(0);
  });
});
