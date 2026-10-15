import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { staticTorqueSingleLink } from "@aili/solvers";
import { installVoiceFakes } from "./voiceFakes";

// Servo + arm scene (M4 slice 2a), reached through the live path with the RECORDED provider (turn 3
// of e2e/fixtures/live-recording.json): the scene, highlight and load slide each follow their
// segment, with voice on and captions only; the panel shows the solver's numbers with units;
// settings stay in bounds; the rating is the learner's own; axe; phone width; reduced motion; no WebGL.

const welcomeBox = (p: Page) => p.getByRole("textbox", { name: "What do you want to learn?" });
const bottomBox = (p: Page) => p.getByRole("textbox", { name: "Ask Aili or answer" });
const replies = (p: Page) => p.getByRole("group", { name: "Suggested replies" });
const caption = (p: Page) => p.locator("main [aria-live]").last();
const partsButton = (p: Page) => p.getByRole("button", { name: /^Parts/ });
const panel = (p: Page) => p.getByRole("region", { name: "Explanation space" });
const inspector = (p: Page) => p.getByRole("region", { name: /^Inspector:/ });
const axe = async (p: Page) =>
  (await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze()).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`);

const N1 = /^Now the same idea on a robot joint/;
const N2 = /^The load sits partway along the arm/;
const N3 = /^Watch the load slide out to the end/;

/** Turns 1 and 2 (the lever), then turn 3 puts the servo + arm on stage. Returns once turn 3 is sent. */
async function toServoTurn(page: Page, o: { speakMs: number; muted?: boolean }) {
  await installVoiceFakes(page, { speakMs: o.speakMs });
  await page.goto("/learn");
  await expect(welcomeBox(page)).toBeVisible({ timeout: 20_000 });
  if (o.muted) await page.getByRole("button", { name: "Mute" }).click();
  await welcomeBox(page).fill("teach me robotics");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(replies(page).getByRole("button")).toHaveCount(4, { timeout: 30_000 });
  await replies(page).getByRole("button", { name: "It gets harder" }).click();
  await expect(page.locator("main [data-calculated]").first()).toBeVisible({ timeout: 30_000 });
  await bottomBox(page).fill("show me a real servo");
  await page.getByRole("button", { name: "Send" }).click();
}

/** Plays turn 3 to its end (the question is the last caption). */
async function onServoStage(page: Page, o: { speakMs?: number; muted?: boolean } = {}) {
  await toServoTurn(page, { speakMs: o.speakMs ?? 150, muted: o.muted });
  await expect(caption(page)).toHaveText(/^What would you check on your own servo's datasheet/, { timeout: 30_000 });
  await expect(panel(page)).toBeVisible();
}

/** Below 1,100 px the explanation space is a strip: open its sheet (wide screens show the column). */
async function openDetails(page: Page) {
  const button = panel(page).getByRole("button", { name: "Explanation space", exact: true });
  if (await button.isVisible()) await button.click();
  await expect(panel(page).locator('[data-space-block="torque"]')).toBeVisible();
}

/** The rating field, reached from the servo's inspector ("Enter rating"), which focuses it. */
async function ratingField(page: Page) {
  await pickPart(page, "Servo (generic)");
  await inspector(page).getByRole("button", { name: "Enter rating" }).click();
  const field = panel(page).getByRole("spinbutton", { name: /Servo rated torque/ });
  await expect(field).toBeFocused();
  return field;
}

/** The solver's answer for the values the page shows (arm level; arm mass as a uniform bar; standard gravity, as the scene states). */
const solve = (p: { L: number; armKg: number; loadKg: number; d: number }, rating?: number) =>
  staticTorqueSingleLink({ arm_length_m: p.L, payload_kg: 0, arm_kg_per_m: p.armKg / p.L, angle_deg: 0, extra_masses: [{ mass_kg: p.loadKg, distance_m: p.d }], ...(rating ? { rated_continuous_torque_nm: rating } : {}) });
const shown = async (page: Page, key: string) => (await page.locator(`[data-solver-value="${key}"]`).textContent())!;
const settingValue = async (page: Page, label: string) => Number((await inspector(page).locator("div", { has: page.getByText(label, { exact: true }) }).locator("output").first().textContent())!.split(" ")[0]);

/** Opens the Parts menu and picks a part; its inspector opens. */
async function pickPart(page: Page, name: string) {
  await partsButton(page).click();
  await page.getByRole("option", { name }).click();
  await expect(inspector(page)).toBeVisible();
}

test.describe("servo + arm scene (M4 slice 2a), recorded live path", () => {
  test.setTimeout(120_000);
  test.beforeEach(async ({ page, baseURL }) => {
    await page.context().addCookies([{ name: "aili-e2e-live", value: "1", url: baseURL! }]);
  });

  for (const mode of ["voice on", "captions only"] as const) {
    test(`${mode}: the scene, the highlight and the load slide each come with their own segment`, async ({ page }) => {
      await toServoTurn(page, { speakMs: 2500, muted: mode === "captions only" });
      await expect(caption(page)).toHaveText(N1, { timeout: 30_000 });
      await expect(page.getByRole("button", { name: /^Prepared · / })).toContainText("Draft (not expert-reviewed)");
      await expect(panel(page)).toBeVisible(); // the servo + arm is on stage with its first segment
      await expect(partsButton(page)).toHaveText("Parts"); // nothing highlighted yet: that is n2's
      await expect(caption(page)).toHaveText(N2, { timeout: 10_000 });
      await expect(partsButton(page)).toHaveText("Parts: Load");
      const load = page.locator('span[data-part-id="load"]');
      await expect(load).toHaveText(/Selected: Load/);
      await page.waitForTimeout(600); // let the framing settle
      const before = (await load.boundingBox())!;
      await expect(caption(page)).toHaveText(N3, { timeout: 10_000 });
      await expect
        .poll(async () => {
          const b = await load.boundingBox();
          return b ? Math.hypot(b.x - before.x, b.y - before.y) : 0;
        }, { timeout: 6_000 })
        .toBeGreaterThan(20);
    });
  }

  test("the panel shows the solver's numbers with units; settings stay in bounds; the rating is the learner's own; axe; no sideways scroll", async ({ page }) => {
    await onServoStage(page);
    const host = page.locator("[data-viewer]");
    if ((await host.getAttribute("data-viewer")) === "ready") {
      await expect(host).toHaveAttribute("data-triangles-scene", "servo-arm", { timeout: 15_000 });
      const tri = Number(await host.getAttribute("data-triangles"));
      console.log(`servo-arm triangles: ${tri}`);
      expect(tri).toBeGreaterThan(0);
      expect(tri).toBeLessThanOrEqual(2000);
    }

    // Read the settings back from the inspector, then compare every shown number with the solver.
    await pickPart(page, "Load");
    await expect.poll(() => settingValue(page, "Load distance from the joint"), { timeout: 5_000 }).toBe(0.15); // the slide has finished
    await pickPart(page, "Arm link");
    const L = await settingValue(page, "Arm length");
    const armKg = await settingValue(page, "Arm mass");
    await pickPart(page, "Load");
    const loadKg = await settingValue(page, "Load mass");
    const d = await settingValue(page, "Load distance from the joint");
    expect(d).toBe(L); // the load slid out to the end of the arm
    await page.getByRole("button", { name: "Close inspector" }).click();
    await openDetails(page);
    const s = solve({ L, armKg, loadKg, d });
    expect(await shown(page, "torque_nm")).toBe(`${s.torque_nm.toPrecision(3)} N·m`);
    expect(await shown(page, "torque_kgf_cm")).toBe(`${s.torque_kgf_cm.toPrecision(3)} kgf·cm`);
    expect(await shown(page, "load_torque_nm")).toBe(`${s.extra_torque_nm.toPrecision(3)} N·m`);
    expect(await shown(page, "arm_torque_nm")).toBe(`${s.arm_torque_nm.toPrecision(3)} N·m`);
    await expect(panel(page)).toContainText("Teaching thresholds, not a design standard: Fail below 1.0×, Warn 1.0× up to 2.0×, Pass at 2.0× and above");
    await expect(panel(page)).toContainText("Simulation only; hardware untested");
    await expect(panel(page)).toContainText("Illustrative (AI-composed)");
    await expect(panel(page)).toContainText("Enter your servo's rated torque to see the margin.");
    await expect(panel(page)).toContainText("g = 9.80665 m/s² (standard gravity)"); // the inputs line
    await expect(panel(page)).toContainText("Total the servo must hold");
    expect(await axe(page)).toEqual([]);

    // Bounds: each slider declares its unit and range, and the keyboard cannot leave it.
    await pickPart(page, "Arm link");
    const length = inspector(page).getByRole("slider", { name: "Arm length" });
    await expect(length).toHaveAttribute("min", "0.08");
    await expect(length).toHaveAttribute("max", "0.3");
    await expect(inspector(page)).toContainText("0.08 m to 0.30 m");
    await length.focus();
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowRight");
    await expect(inspector(page).locator("output").first()).toHaveText("0.30 m");
    await page.keyboard.press("Home");
    await expect(inspector(page).locator("output").first()).toHaveText("0.08 m");
    await expect(length).toHaveAttribute("aria-valuetext", "0.08 metres");

    // The rating: empty, no product value; out of bounds is refused; then the margin and its band.
    await page.getByRole("button", { name: "Close inspector" }).click();
    const rating = await ratingField(page);
    await expect(rating).toHaveValue("");
    await expect(rating).toHaveAttribute("placeholder", "From your datasheet");
    await expect(panel(page)).toContainText("Not set");
    await rating.fill("80");
    await expect(panel(page).getByRole("alert")).toHaveText("Enter a value from 0.05 to 5.00 N·m. Nothing was changed.");
    await expect(panel(page)).toContainText("Not set");
    await rating.fill("0.25");
    await expect(panel(page)).toContainText("0.25 N·m");
    expect(await axe(page)).toEqual([]);

    const s2 = solve({ L: 0.08, armKg, loadKg, d: 0.08 }, 0.25);
    const margin = 0.25 / s2.torque_nm;
    const word = margin < 1 ? "Fail" : margin >= 2 ? "Pass" : "Warn";
    expect(await shown(page, "torque_nm")).toBe(`${s2.torque_nm.toPrecision(3)} N·m`);
    expect(await shown(page, "margin")).toBe(`${margin.toFixed(2)}×`);
    const status = panel(page).locator("[data-status]");
    await expect(status).toHaveAttribute("data-status", word.toLowerCase());
    await expect(status.locator("strong")).toHaveText(word);
    await expect(status.locator("svg")).toHaveCount(1); // its own icon shape, not colour alone
    expect(await axe(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });

  test("reduced motion: the load steps to the end of the arm with no animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await onServoStage(page);
    await pickPart(page, "Load");
    await expect.poll(async () => (await settingValue(page, "Load distance from the joint")) === 0.15, { timeout: 5_000 }).toBe(true);
  });

  test("the explanation space: a column from 1,100 px; below, a strip whose sheet opens and closes by keyboard (Escape returns focus)", async ({ page }, info) => {
    await onServoStage(page);
    if (info.project.name === "desktop") {
      await expect(panel(page)).toHaveAttribute("data-space", "column");
      await expect(panel(page).getByRole("button", { name: "Explanation space", exact: true })).toHaveCount(0);
      return;
    }
    await expect(panel(page)).toHaveAttribute("data-space", "strip");
    await expect(panel(page)).toContainText("Total the servo must hold:");
    const button = panel(page).getByRole("button", { name: "Explanation space", exact: true });
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(panel(page)).toHaveAttribute("data-space", "sheet");
    await expect(panel(page).getByRole("button", { name: "Close the explanation space" })).toHaveAttribute("aria-expanded", "true");
    await panel(page).getByRole("spinbutton", { name: /Servo rated torque/ }).focus();
    await page.keyboard.press("Escape");
    await expect(panel(page)).toHaveAttribute("data-space", "strip");
    await expect(button).toBeFocused();
    expect(await axe(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });

  test("the model stays framed (finite camera) after an inspector that covers most of the stage closes, and with the sheet open", async ({ page }) => {
    await onServoStage(page);
    const host = page.locator("[data-viewer]");
    test.skip((await host.getAttribute("data-viewer")) !== "ready", "3D view only");
    const finite = async () => (await host.getAttribute("data-model-box"))!.split(",").every((n) => Number.isFinite(Number(n)));
    await pickPart(page, "Arm link");
    await page.getByRole("button", { name: "Close inspector" }).click();
    await expect.poll(finite).toBe(true); // was NaN on phones: the inspector left no free area
    const button = panel(page).getByRole("button", { name: "Explanation space", exact: true });
    if (await button.isVisible()) await button.click();
    await expect.poll(finite).toBe(true);
  });

  test("without WebGL: the still picture of the servo and arm, and the same panel", async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (/webgl/i.test(type)) return null;
        return (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof original;
    });
    await onServoStage(page);
    await expect(page.getByRole("img", { name: /Still side view of the generic servo and arm: base, servo \(generic\), output horn, arm link, load/ })).toBeVisible();
    await expect(panel(page).locator('[data-solver-value="torque_nm"]')).toHaveText(/ N·m$/);
  });

  // Screenshots for Lucky (git-ignored apps/web/screenshots/servo-arm): desktop and phone, light and dark.
  test("screenshots of the servo + arm scene", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "taken once");
    const dir = "screenshots/servo-arm";
    mkdirSync(dir, { recursive: true });
    for (const [width, height, name] of [[1280, 800, "desktop"], [412, 915, "phone"]] as const)
      for (const scheme of ["light", "dark"] as const) {
        await page.setViewportSize({ width, height });
        await page.emulateMedia({ colorScheme: scheme });
        await onServoStage(page);
        await expect(page.locator('[data-viewer="ready"]')).toBeVisible({ timeout: 20_000 });
        await page.mouse.move(0, 0);
        await page.screenshot({ path: `${dir}/${name}-${scheme}-1-scene.png` });
        await (await ratingField(page)).fill("0.25");
        await page.screenshot({ path: `${dir}/${name}-${scheme}-2-margin.png` });
      }
  });
});
