import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { installVoiceFakes } from "./voiceFakes";

// The analogy honesty rule (docs/m4-plan.md addendum A), through the live path with the RECORDED
// provider (e2e/fixtures/live-recording.json): turn 4 tells the shopping-bag analogy, which has no
// picture, so the page says "Analogy in words only"; turn 5 tells the ruler analogy with its picture
// on stage, so it does not.

const welcomeBox = (p: Page) => p.getByRole("textbox", { name: "What do you want to learn?" });
const bottomBox = (p: Page) => p.getByRole("textbox", { name: "Ask Aili or answer" });
const replies = (p: Page) => p.getByRole("group", { name: "Suggested replies" });
const caption = (p: Page) => p.locator("main [aria-live]").last();
const note = (p: Page) => p.locator("[data-analogy-note]");
const send = async (p: Page, text: string) => {
  await bottomBox(p).fill(text);
  await p.getByRole("button", { name: "Send" }).click();
};
const axe = async (p: Page) =>
  (await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze()).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`);

test.describe("analogy honesty rule (addendum A), recorded live path", () => {
  test.setTimeout(120_000);
  test.beforeEach(async ({ page, baseURL }) => {
    await page.context().addCookies([{ name: "aili-e2e-live", value: "1", url: baseURL! }]);
  });

  test("a words-only analogy is labelled as such; one with its picture on stage is not", async ({ page }) => {
    await installVoiceFakes(page, { speakMs: 1500 }); // long enough that each caption can be read under load (150 ms flaked 8 in 30)
    await page.goto("/learn");
    await expect(welcomeBox(page)).toBeVisible({ timeout: 20_000 });
    await welcomeBox(page).fill("teach me robotics");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(replies(page).getByRole("button")).toHaveCount(4, { timeout: 30_000 });
    await replies(page).getByRole("button", { name: "It gets harder" }).click();
    await expect(page.locator("main [data-calculated]").first()).toBeVisible({ timeout: 30_000 });
    await expect(note(page)).toHaveCount(0); // no analogy yet
    await send(page, "show me a real servo");
    await expect(caption(page)).toHaveText(/^What would you check on your own servo's datasheet/, { timeout: 30_000 });
    await expect(note(page)).toHaveCount(0);

    // Turn 4: the bag, in words only (no picture exists; the stage keeps the servo + arm).
    await send(page, "the rated torque");
    await expect(caption(page)).toHaveText(/picture holding a shopping bag/, { timeout: 30_000 });
    await expect(note(page)).toHaveText(/^Analogy in words only\. No picture of this yet\./);
    await expect(page.getByRole("region", { name: "Explanation space" })).toBeVisible(); // still the servo + arm
    // Captions off: the label stays (the stage is still not a picture of the bag).
    await page.getByRole("button", { name: "Captions" }).click();
    await expect(note(page)).toBeVisible();
    await page.getByRole("button", { name: "Captions" }).click();
    expect(await axe(page)).toEqual([]);

    // Turn 5: the ruler, with its picture on stage: no label.
    await expect(caption(page)).toHaveText(/^Shall we look at the ruler held out again/, { timeout: 30_000 });
    await replies(page).getByRole("button", { name: "Yes" }).click();
    await expect(caption(page)).toHaveText(/^Why does the far weight take more effort to hold/, { timeout: 30_000 });
    await expect(note(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Parts/ })).toBeVisible();
    await expect(page.getByRole("region", { name: "Explanation space" })).toHaveCount(0); // the lever is on stage
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
});
