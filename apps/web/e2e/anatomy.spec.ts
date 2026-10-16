import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { installVoiceFakes } from "./voiceFakes";

// The micro servo's anatomy (slice 3): explode, open and assemble played by the professor (turn 9 of
// e2e/fixtures/live-recording.json, through the live path with the RECORDED provider) or by the
// learner's buttons; highlight through a see-through case; the anatomy camera; the arm and load dimmed
// with the numbers unchanged; interrupt; reduced motion; screenshots.

const welcomeBox = (p: Page) => p.getByRole("textbox", { name: "What do you want to learn?" });
const bottomBox = (p: Page) => p.getByRole("textbox", { name: "Ask Aili or answer" });
const caption = (p: Page) => p.locator("main [aria-live]").last();
const host = (p: Page) => p.locator("[data-viewer]");
const servoGroup = (p: Page) => p.getByRole("group", { name: "Servo" });
const note = (p: Page) => p.getByTestId("servo-note");
const partsButton = (p: Page) => p.getByRole("button", { name: /^Parts/ });
const total = (p: Page) => p.locator('[data-solver-value="torque_nm"]');
const label = (p: Page, id: string) => p.locator(`span[data-part-id="${id}"]`);
const send = async (p: Page, text: string) => {
  await bottomBox(p).fill(text);
  await p.getByRole("button", { name: "Send" }).click();
};
const axe = async (p: Page) =>
  (await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze()).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`);

const T9_N1 = /^Let's take the servo apart/;
const T9_N2 = /^This is the gear train/;
const T9_N3 = /^Behind it sits the motor/;
const T9_Q = /^Which part do you think decides/;

/** Turns 1 to 3 (the servo + arm on stage); each sent once the stage has what the next needs. */
async function toServo(page: Page, speakMs = 200) {
  await installVoiceFakes(page, { speakMs });
  await page.goto("/learn");
  await expect(welcomeBox(page)).toBeVisible({ timeout: 20_000 });
  await welcomeBox(page).fill("teach me robotics");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(caption(page)).toHaveText(/^If the weight slides farther/, { timeout: 40_000 });
  await send(page, "It gets harder");
  await expect(caption(page)).toHaveText(/^Yes, farther out is harder/, { timeout: 30_000 });
  await send(page, "show me a real servo");
  await expect(caption(page)).toHaveText(/^What would you check on your own servo's datasheet/, { timeout: 30_000 });
  await expect(host(page)).toHaveAttribute("data-asset", "loaded", { timeout: 20_000 });
  // Turn 3's load slide has finished: the total is steady.
  await expect.poll(async () => {
    const a = await total(page).textContent();
    await page.waitForTimeout(400);
    return a === (await total(page).textContent());
  }, { timeout: 10_000 }).toBe(true);
}

/** On to turn 9: turns 4 to 8 sent as each one starts (an early send interrupts, as a learner might). */
async function toTurn9(page: Page, speakMs: number) {
  await toServo(page, speakMs);
  for (const [text, first] of [["the rated torque", /^Yes, check its rated torque/], ["Yes", /^Here is the ruler held out/], ["Longer lever", /^Yes, a longer lever/], ["The arm itself", /^Yes: the arm's own weight/], ["A shorter arm", /^Yes, a shorter arm/]] as const) {
    await send(page, text);
    await expect(caption(page)).toHaveText(first, { timeout: 30_000 });
  }
  await send(page, "What is inside the servo?");
}

test.describe("micro servo anatomy (slice 3), recorded live path", () => {
  test.setTimeout(240_000);
  test.beforeEach(async ({ page, baseURL }) => {
    await page.context().addCookies([{ name: "aili-e2e-live", value: "1", url: baseURL! }]);
  });

  test("the professor explodes the servo, then points at the gear train and the motor, each with its own segment", async ({ page }, info) => {
    await toTurn9(page, 2500);
    await expect(caption(page)).toHaveText(T9_N1, { timeout: 30_000 });
    await expect(host(page)).toHaveAttribute("data-servo", /moving|exploded/);
    await expect(host(page)).toHaveAttribute("data-servo", "exploded", { timeout: 5_000 });
    await expect(host(page)).toHaveAttribute("data-camera-view", "anatomy");
    await expect(note(page)).toHaveText(/Aili exploded the servo/);
    await expect(page.getByText("Illustrative · generic, not measured")).toBeVisible();
    await expect(partsButton(page)).toHaveText("Parts"); // nothing pointed at yet: that is n2's
    // Each part's short name floats beside it. On a phone the labels that would collide give way (at
    // most one); a part Aili points at always keeps its label (checked below).
    const ids = ["horn", "upper-case", "gear-train", "motor-and-sensor", "board-and-cover"];
    await page.waitForTimeout(800);
    const shown = (await Promise.all(ids.map((id) => label(page, id).isVisible()))).filter(Boolean).length;
    expect(shown).toBeGreaterThanOrEqual(info.project.name === "desktop" ? 5 : 4);
    await expect(caption(page)).toHaveText(T9_N2, { timeout: 10_000 });
    await expect(partsButton(page)).toHaveText("Parts: Gear train");
    await expect(label(page, "gear-train")).toBeVisible();
    await expect(note(page)).toContainText("Aili pointed at the gear train");
    await expect(caption(page)).toHaveText(T9_N3, { timeout: 10_000 });
    await expect(partsButton(page)).toHaveText("Parts: Motor and position sensor");
    await expect(label(page, "motor-and-sensor")).toBeVisible();
    await expect(caption(page)).toHaveText(T9_Q, { timeout: 10_000 });
    expect(await axe(page)).toEqual([]);
  });

  test("interrupt during the explode segment: the servo settles exploded at once, and the queued highlights never run", async ({ page }) => {
    await toTurn9(page, 4000);
    await expect(caption(page)).toHaveText(T9_N1, { timeout: 30_000 });
    await page.keyboard.press("Escape");
    await expect(page.locator('p[role="status"][data-state]')).toHaveText(/Stopped\./);
    await expect(host(page)).toHaveAttribute("data-servo", "exploded", { timeout: 2_000 }); // its segment had started: its end state
    await page.waitForTimeout(4500); // past where the gear train's segment would have started
    await expect(partsButton(page)).toHaveText("Parts");
    await expect(host(page)).toHaveAttribute("data-servo", "exploded");
  });

  test("the learner's buttons: keyboard, 44 px, who did what; the arm's numbers never change; Assemble restores the scene view", async ({ page }) => {
    await toServo(page);
    const before = await total(page).textContent();
    const explode = servoGroup(page).getByRole("button", { name: "Explode" });
    for (const name of ["Explode", "Open", "Assemble"]) {
      const b = (await servoGroup(page).getByRole("button", { name }).boundingBox())!;
      expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44);
    }
    await explode.focus();
    await page.keyboard.press("Enter");
    await expect(host(page)).toHaveAttribute("data-servo", "exploded", { timeout: 3_000 });
    await expect(explode).toHaveAttribute("aria-pressed", "true");
    await expect(note(page)).toHaveText(/You exploded the servo/);
    await expect(host(page)).toHaveAttribute("data-camera-view", "anatomy");
    expect(await total(page).textContent()).toBe(before);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter"); // Open
    await expect(host(page)).toHaveAttribute("data-servo", "open", { timeout: 3_000 });
    await expect(note(page)).toHaveText(/You opened the servo/);
    await expect(label(page, "gear-train")).toBeVisible(); // inside parts are named once in view
    await expect(page.getByText("Illustrative · generic, not measured")).toBeVisible();
    expect(await total(page).textContent()).toBe(before);
    expect(await axe(page)).toEqual([]);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter"); // Assemble
    await expect(host(page)).toHaveAttribute("data-servo", "assembled", { timeout: 3_000 });
    await expect(host(page)).toHaveAttribute("data-camera-view", "scene");
    await expect(note(page)).toHaveText(/You put the servo back together/);
    await expect(page.getByText("Illustrative · generic, not measured")).toHaveCount(0);
    await expect(label(page, "gear-train")).toBeHidden();
    expect(await total(page).textContent()).toBe(before);
  });

  test("picking a part inside the assembled servo shows the case see-through instead of exploding it", async ({ page }) => {
    await toServo(page);
    await partsButton(page).click();
    await page.getByRole("option", { name: "Gear train" }).click();
    await expect(host(page)).toHaveAttribute("data-servo-case", "see-through");
    await expect(host(page)).toHaveAttribute("data-servo", "assembled");
    await expect(note(page)).toContainText("You picked the gear train");
    await partsButton(page).click();
    await page.getByRole("option", { name: "Arm link" }).click();
    await expect(host(page)).toHaveAttribute("data-servo-case", "solid");
  });

  test("reduced motion: each change snaps to its end state, with thin offset lines as the still alternative", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await toServo(page, 1500); // longer lines: under reduced motion the turns' still steps pass quickly
    await servoGroup(page).getByRole("button", { name: "Explode" }).click();
    await expect(host(page)).toHaveAttribute("data-servo", "exploded"); // no "moving" in between
    await expect(host(page)).toHaveAttribute("data-offset-lines", "4"); // the motor stays where it is
    await servoGroup(page).getByRole("button", { name: "Open" }).click();
    await expect(host(page)).toHaveAttribute("data-offset-lines", "1");
    await servoGroup(page).getByRole("button", { name: "Assemble" }).click();
    await expect(host(page)).toHaveAttribute("data-offset-lines", "0");
  });

  // Screenshots for Lucky (git-ignored apps/web/screenshots/servo-anatomy): desktop and phone, light.
  test("screenshots: assembled, open, exploded, and the gear train through the see-through case", async ({ browser, baseURL }, info) => {
    test.skip(info.project.name !== "desktop", "taken once");
    test.setTimeout(300_000);
    const dir = "screenshots/servo-anatomy";
    mkdirSync(dir, { recursive: true });
    for (const [width, height, name] of [[1280, 800, "desktop"], [412, 915, "phone"]] as const) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
      await context.addCookies([{ name: "aili-e2e-live", value: "1", url: baseURL! }]);
      const page = await context.newPage();
      await toServo(page);
      const shot = async (key: string) => {
        await page.mouse.move(0, 0);
        await page.waitForTimeout(900); // the motion and the camera settle
        await page.screenshot({ path: `${dir}/${name}-${key}.png` });
      };
      await shot("1-assembled");
      for (const [button, key] of [["Open", "2-open"], ["Explode", "3-exploded"]] as const) {
        await servoGroup(page).getByRole("button", { name: button }).click();
        await shot(key);
      }
      await servoGroup(page).getByRole("button", { name: "Assemble" }).click();
      await page.waitForTimeout(900);
      await partsButton(page).click();
      await page.getByRole("option", { name: "Gear train" }).click();
      const close = page.getByRole("button", { name: "Close inspector" });
      if (await close.isVisible()) await close.click();
      await shot("4-gear-train-see-through");
      await context.close();
    }
  });
});
