import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { installVoiceFakes } from "./voiceFakes";

// The micro servo's parts block, gear-train rotation and ratio line (slice 4), through the live path
// with the RECORDED provider (turn 10 of e2e/fixtures/live-recording.json) and the learner's buttons:
// the parts block takes the equation's place with the numbers unchanged; the gears turn only in view
// and stop on Stop, assemble, interrupt and a new turn; reduced motion shows arrows and the ratio.

const welcomeBox = (p: Page) => p.getByRole("textbox", { name: "What do you want to learn?" });
const bottomBox = (p: Page) => p.getByRole("textbox", { name: "Ask Aili or answer" });
const caption = (p: Page) => p.locator("main [aria-live]").last();
const host = (p: Page) => p.locator("[data-viewer]");
const servoGroup = (p: Page) => p.getByRole("group", { name: "Servo" });
const button = (p: Page, name: string) => servoGroup(p).getByRole("button", { name, exact: true });
const note = (p: Page) => p.getByTestId("servo-note");
const panel = (p: Page) => p.getByRole("region", { name: "Explanation space" });
const block = (p: Page, id: string) => panel(p).locator(`[data-space-block="${id}"]`);
const value = (p: Page, key: string) => panel(p).locator(`[data-solver-value="${key}"]`).first();
const canvas = (p: Page) => p.locator("[data-viewer] canvas");
const send = async (p: Page, text: string) => {
  await bottomBox(p).fill(text);
  await p.getByRole("button", { name: "Send" }).click();
};
const axe = async (p: Page) =>
  (await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze()).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`);

/** Below 1,100 px the explanation space is a strip: open its sheet (wide screens show the column). */
async function openSpace(page: Page) {
  const b = panel(page).getByRole("button", { name: "Explanation space", exact: true });
  if (await b.isVisible()) await b.click();
}
async function closeSpace(page: Page) {
  const b = panel(page).getByRole("button", { name: "Close the explanation space" });
  if (await b.isVisible()) await b.click();
}

/** Turns 1 to 3: the servo + arm on stage, the GLB loaded, turn 3's load slide finished. */
async function toServo(page: Page, speakMs = 1200) {
  await installVoiceFakes(page, { speakMs });
  await page.goto("/learn?lesson=lever");
  await expect(welcomeBox(page)).toBeVisible({ timeout: 20_000 });
  await welcomeBox(page).fill("teach me robotics");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(caption(page)).toHaveText(/^If the weight slides farther/, { timeout: 40_000 });
  await send(page, "It gets harder");
  await expect(caption(page)).toHaveText(/^Yes, farther out is harder/, { timeout: 30_000 });
  await send(page, "show me a real servo");
  await expect(caption(page)).toHaveText(/^What would you check on your own servo's datasheet/, { timeout: 30_000 });
  await expect(host(page)).toHaveAttribute("data-asset", "loaded", { timeout: 20_000 });
  await expect
    .poll(async () => {
      const a = await value(page, "torque_nm").textContent();
      await page.waitForTimeout(400);
      return a === (await value(page, "torque_nm").textContent());
    }, { timeout: 10_000 })
    .toBe(true);
}

/**
 * Two pictures of the canvas a moment apart: different while something turns, equal while still.
 * The gap is uneven on purpose: at 1.5 turns a second the 10-tooth pinion and the 40-tooth gear each
 * turn exactly 6 teeth in 400 ms, so pictures 400 ms apart could match while the gears turn. Each
 * picture of the turning canvas takes about a second in headless Chrome (measured 16 Oct 2026), so
 * callers poll for up to 15 s.
 */
async function moving(page: Page) {
  const a = await canvas(page).screenshot();
  await page.waitForTimeout(170);
  const b = await canvas(page).screenshot();
  return !a.equals(b);
}

test.describe("micro servo parts block and gears (slice 4), recorded live path", () => {
  test.setTimeout(240_000);
  test.beforeEach(async ({ page, baseURL }) => {
    await page.context().addCookies([{ name: "aili-e2e-live", value: "1", url: baseURL! }]);
  });

  test("the parts block takes the equation's place while the servo is apart; the total and margin are identical before, during and after", async ({ page }) => {
    await toServo(page);
    await openSpace(page);
    await panel(page).getByRole("spinbutton", { name: /Servo rated torque/ }).fill("0.25");
    const numbers = async () => [await value(page, "torque_nm").textContent(), await value(page, "margin").textContent()];
    const before = await numbers();
    expect(before[1]).toMatch(/×$/);
    await closeSpace(page);
    await button(page, "Explode").click();
    await openSpace(page);
    expect(await numbers()).toEqual(before); // during the motion
    await expect(host(page)).toHaveAttribute("data-servo", "exploded", { timeout: 3_000 });
    await expect(block(page, "parts")).toBeVisible();
    await expect(block(page, "parts")).toContainText("illustrative, generic");
    for (const name of ["Output horn", "Servo case", "Gear train", "Motor and position sensor", "Control board and cover"]) await expect(block(page, "parts")).toContainText(name);
    await expect(block(page, "parts")).toContainText("Trades speed for torque"); // the role, from the manifest
    await expect(block(page, "parts").locator("[data-ratio-line]")).toHaveText("Gear ratio 46.1 : 1 (example tooth counts, not measured; ideal gears; friction and efficiency not modelled)");
    await expect(block(page, "torque")).toHaveAttribute("data-compact", "");
    await expect(panel(page).getByRole("spinbutton", { name: /Servo rated torque/ })).toBeVisible();
    expect(await numbers()).toEqual(before);
    expect(await axe(page)).toEqual([]);
    await closeSpace(page);
    await button(page, "Assemble").click();
    await expect(host(page)).toHaveAttribute("data-servo", "assembled", { timeout: 3_000 });
    await openSpace(page);
    await expect(block(page, "parts")).toHaveCount(0);
    await expect(block(page, "torque")).not.toHaveAttribute("data-compact", "");
    expect(await numbers()).toEqual(before);
  });

  test("Turn gears and Stop gears: keyboard, 44 px, who did what; only in view; Assemble stops them", async ({ page }) => {
    await toServo(page);
    const turn = button(page, "Turn gears");
    const b = (await turn.boundingBox())!;
    expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44);
    await turn.click(); // assembled, nothing picked: the gears are hidden in the case
    await expect(servoGroup(page).locator("..")).toContainText("Open or explode the servo, or pick the gear train");
    await expect(host(page)).toHaveAttribute("data-gears", "still");
    await button(page, "Open").click();
    await expect(host(page)).toHaveAttribute("data-servo", "open", { timeout: 3_000 });
    await turn.focus();
    await page.keyboard.press("Enter");
    await expect(host(page)).toHaveAttribute("data-gears", "turning");
    await expect(page.getByTestId("gears-label")).toContainText("Illustrative animation, not a simulation");
    await expect(note(page)).toContainText("You turned the gears");
    await expect.poll(() => moving(page), { timeout: 15_000 }).toBe(true);
    await page.keyboard.press("Enter"); // the same button, now "Stop gears"
    await expect(host(page)).toHaveAttribute("data-gears", "still");
    await expect(note(page)).toContainText("You stopped the gears");
    await page.waitForTimeout(300);
    expect(await moving(page)).toBe(false);
    await button(page, "Turn gears").click();
    await expect(host(page)).toHaveAttribute("data-gears", "turning");
    await button(page, "Assemble").click();
    await expect(host(page)).toHaveAttribute("data-gears", "still");
  });

  test("reduced motion: nothing turns; direction arrows and the ratio text instead", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await toServo(page, 1500);
    await button(page, "Explode").click();
    await expect(host(page)).toHaveAttribute("data-servo", "exploded");
    await button(page, "Turn gears").click();
    await expect(host(page)).toHaveAttribute("data-gears", "turning");
    await expect(page.getByTestId("gears-label")).toContainText("Gear ratio 46.1 : 1 (example tooth counts, not measured; ideal gears; friction and efficiency not modelled)");
    await page.waitForTimeout(300);
    expect(await moving(page)).toBe(false);
  });

  test("the professor points at the gear train, then turns the gears in their own segment; an interrupt stops them", async ({ page }) => {
    await toServo(page, 2500);
    for (const [text, first] of [["the rated torque", /^Yes, check its rated torque/], ["Yes", /^Here is the ruler held out/], ["Longer lever", /^Yes, a longer lever/], ["The arm itself", /^Yes: the arm's own weight/], ["A shorter arm", /^Yes, a shorter arm/], ["What is inside the servo?", /^Let's take the servo apart/]] as const) {
      await send(page, text);
      await expect(caption(page)).toHaveText(first, { timeout: 30_000 });
    }
    await send(page, "The gear train");
    await expect(caption(page)).toHaveText(/^Yes, the gear train/, { timeout: 30_000 });
    await expect(page.getByRole("button", { name: /^Parts/ })).toHaveText("Parts: Gear train");
    await expect(host(page)).toHaveAttribute("data-gears", "still"); // that is the next segment's
    await expect(caption(page)).toHaveText(/^Watch the gears turn/, { timeout: 10_000 });
    await expect(host(page)).toHaveAttribute("data-gears", "turning");
    await expect(note(page)).toContainText("Aili turned the gears");
    await page.keyboard.press("Escape");
    await expect(page.locator('p[role="status"][data-state]')).toHaveText(/Stopped\./);
    await expect(host(page)).toHaveAttribute("data-gears", "still", { timeout: 2_000 });
  });

  // Screenshots for Lucky (git-ignored apps/web/screenshots/servo-gears): desktop and phone.
  test("screenshots: exploded with the parts block, the gears turning through the see-through case (two frames), the reduced-motion still", async ({ browser, baseURL }, info) => {
    test.skip(info.project.name !== "desktop", "taken once");
    test.setTimeout(300_000);
    const dir = "screenshots/servo-gears";
    mkdirSync(dir, { recursive: true });
    for (const [width, height, name] of [[1280, 800, "desktop"], [412, 915, "phone"]] as const)
      for (const reduced of [false, true]) {
        const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, reducedMotion: reduced ? "reduce" : "no-preference" });
        await context.addCookies([{ name: "aili-e2e-live", value: "1", url: baseURL! }]);
        const page = await context.newPage();
        await toServo(page, reduced ? 1500 : 1200);
        const shot = async (key: string) => {
          await page.mouse.move(0, 0);
          await page.screenshot({ path: `${dir}/${name}-${key}.png` });
        };
        if (!reduced) {
          await button(page, "Explode").click();
          await page.waitForTimeout(900);
          await openSpace(page);
          await shot("1-exploded-parts-block");
          await closeSpace(page);
          await button(page, "Assemble").click();
          await page.waitForTimeout(900);
          await page.getByRole("button", { name: /^Parts/ }).click();
          await page.getByRole("option", { name: "Gear train" }).click();
          const close = page.getByRole("button", { name: "Close inspector" });
          if (await close.isVisible()) await close.click();
          await button(page, "Turn gears").click();
          await page.waitForTimeout(500);
          // Each frame, plus a close crop round the gear train's label anchor (canvas pixels).
          const crop = async (key: string) => {
            const c = (await page.locator("[data-viewer] canvas").boundingBox())!;
            const l = page.locator('span[data-part-id="gear-train"]');
            const cx = c.x + Number(await l.getAttribute("data-x"));
            const cy = c.y + Number(await l.getAttribute("data-y"));
            await page.screenshot({ path: `${dir}/${name}-${key}-close.png`, clip: { x: Math.max(0, cx - 60), y: Math.max(0, cy - 40), width: 120, height: 120 } });
          };
          await shot("2-see-through-turning-frame-a");
          await crop("2-see-through-turning-frame-a");
          await page.waitForTimeout(350);
          await shot("3-see-through-turning-frame-b");
          await crop("3-see-through-turning-frame-b");
        } else {
          await button(page, "Explode").click();
          await button(page, "Turn gears").click();
          await shot("4-reduced-motion-arrows");
        }
        await context.close();
      }
  });
});
