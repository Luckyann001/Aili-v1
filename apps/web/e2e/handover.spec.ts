import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { staticTorqueSingleLink } from "@aili/solvers";
import { installVoiceFakes } from "./voiceFakes";

// The bag handover (slice B), through the live path with the RECORDED provider (turn 11 of
// e2e/fixtures/live-recording.json): the bag with its picture, the reach-out, then the servo with the
// bag's reach as its arm length and the load at its end; equation steps cleared, labels switched.
// Each earlier turn plays to its last line before the next is sent (no early sends, no fixed waits).

const welcomeBox = (p: Page) => p.getByRole("textbox", { name: "What do you want to learn?" });
const bottomBox = (p: Page) => p.getByRole("textbox", { name: "Ask Aili or answer" });
const caption = (p: Page) => p.locator("main [aria-live]").last();
const host = (p: Page) => p.locator("[data-viewer]");
const stage = async (p: Page) => JSON.parse((await host(p).getAttribute("data-stage"))!) as { scene: string; settings: Record<string, number> };
const send = async (p: Page, text: string) => {
  await bottomBox(p).fill(text);
  await p.getByRole("button", { name: "Send" }).click();
};
const axe = async (p: Page) =>
  (await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze()).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`);

/** Each earlier turn's last line, so the next message is sent only once that turn has fully played. */
const TURNS: Array<[string, RegExp]> = [
  ["It gets harder", /^Watch the weight slide out to the end/],
  ["show me a real servo", /^What would you check on your own servo's datasheet/],
  ["the rated torque", /^Shall we look at the ruler held out again/],
  ["Yes", /^Why does the far weight take more effort/],
  ["Longer lever", /^What else pulls down on the joint/],
  ["The arm itself", /^What could you change on the arm/],
  ["A shorter arm", /^What would a heavier load do to that total/],
  ["What is inside the servo?", /^Which part do you think decides/],
  ["The gear train", /^If the output turns slowly/],
];

async function toTurn11(page: Page) {
  await installVoiceFakes(page, { speakMs: 1500 });
  await page.goto("/learn");
  await expect(welcomeBox(page)).toBeVisible({ timeout: 20_000 });
  await welcomeBox(page).fill("teach me robotics");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(caption(page)).toHaveText(/^If the weight slides farther/, { timeout: 40_000 });
  for (const [text, last] of TURNS) {
    await send(page, text);
    await expect(caption(page)).toHaveText(last, { timeout: 60_000 });
  }
  await send(page, "Can you show me the bag example?");
}

test.describe("the bag handover (slice B), recorded live path", () => {
  test.setTimeout(300_000);
  test.beforeEach(async ({ page, baseURL }) => {
    await page.context().addCookies([{ name: "aili-e2e-live", value: "1", url: baseURL! }]);
  });

  test("the bag on stage with its picture, the reach out, then the servo with the same arm length and the load at its end", async ({ page }) => {
    await toTurn11(page);
    await expect(caption(page)).toHaveText(/^Here is a shopping bag held close in/, { timeout: 30_000 });
    await expect.poll(async () => (await stage(page)).scene, { timeout: 10_000 }).toBe("bag-hold");
    await expect(page.locator("[data-analogy-note]")).toHaveCount(0); // told with its picture on stage
    await expect(caption(page)).toHaveText(/^With the load out at the end/, { timeout: 30_000 });
    // The servo: the bag's longest reach is its arm length, the load at the end; the stage function did it.
    const s = await stage(page);
    expect(s.scene).toBe("servo-arm");
    expect(s.settings).toMatchObject({ arm_length_m: 0.3, load_distance_m: 0.3, arm_mass_kg: 0.04, load_mass_kg: 0.1 });
    // Its numbers are the solver's for those settings (load at 0.30 m on a 0.30 m arm).
    const r = staticTorqueSingleLink({ arm_length_m: 0.3, payload_kg: 0, arm_kg_per_m: 0.04 / 0.3, angle_deg: 0, extra_masses: [{ mass_kg: 0.1, distance_m: 0.3 }] });
    await expect(page.locator('[data-solver-value="torque_nm"]').first()).toHaveText(`${r.torque_nm.toPrecision(3)} N·m`);
    // Equation steps cleared; labels switched to the servo's parts; the load pointed at.
    await expect(page.locator('[data-space-block="equation"]')).toHaveCount(0);
    await expect(page.locator('span[data-part-id="bag"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Parts/ })).toHaveText("Parts: Load");
    expect(await axe(page)).toEqual([]);
  });

  // Screenshots for Lucky (git-ignored apps/web/screenshots/handover): desktop and phone.
  test("screenshots: the bag at its shortest and longest reach, then the servo after the handover", async ({ browser, baseURL }, info) => {
    test.skip(info.project.name !== "desktop", "taken once");
    test.setTimeout(600_000);
    const dir = "screenshots/handover";
    mkdirSync(dir, { recursive: true });
    for (const [width, height, name] of [[1280, 800, "desktop"], [412, 915, "phone"]] as const) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
      await context.addCookies([{ name: "aili-e2e-live", value: "1", url: baseURL! }]);
      const page = await context.newPage();
      await toTurn11(page);
      await expect(caption(page)).toHaveText(/^Here is a shopping bag held close in/, { timeout: 30_000 });
      await expect.poll(async () => (await stage(page)).settings.reach_m, { timeout: 10_000 }).toBe(0.1);
      await page.mouse.move(0, 0);
      await page.screenshot({ path: `${dir}/${name}-1-bag-shortest-reach.png` });
      await expect.poll(async () => (await stage(page)).settings.reach_m, { timeout: 20_000 }).toBe(0.3);
      await page.screenshot({ path: `${dir}/${name}-2-bag-longest-reach.png` });
      await expect.poll(async () => (await stage(page)).scene, { timeout: 30_000 }).toBe("servo-arm");
      await expect(caption(page)).toHaveText(/^With the load out at the end/, { timeout: 30_000 });
      await page.screenshot({ path: `${dir}/${name}-3-servo-after-handover-same-arm-length.png` });
      await context.close();
    }
  });
});
