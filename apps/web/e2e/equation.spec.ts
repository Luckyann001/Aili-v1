import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { installVoiceFakes } from "./voiceFakes";

// τ = F × d built on the servo + arm (M4 slice B), through the live path with the RECORDED provider
// (turns 6 and 7 of e2e/fixtures/live-recording.json): each eq-* step appears with the segment that
// names it, voice on and captions only; labels carry solver numbers with units; phones show only the
// latest step in full; accessibility; phone width; reduced motion.

const welcomeBox = (p: Page) => p.getByRole("textbox", { name: "What do you want to learn?" });
const bottomBox = (p: Page) => p.getByRole("textbox", { name: "Ask Aili or answer" });
const caption = (p: Page) => p.locator("main [aria-live]").last();
const label = (p: Page, step: string) => p.locator(`span[data-eq-label="${step}"]`);
const line = (p: Page, step: string) => p.locator(`li[data-eq-line="${step}"]`);
const send = async (p: Page, text: string) => {
  await bottomBox(p).fill(text);
  await p.getByRole("button", { name: "Send" }).click();
};
const axe = async (p: Page) =>
  (await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze()).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`);

const N2 = /^First the force/;
const N3 = /^Next the distance/;
const N4 = /^Force times distance is the torque/;

/**
 * Turns 1 to 5, each sent as soon as the stage has what the next turn needs (an early send is an
 * interrupt, as a learner would do it): turn 1 plays to its question (turn 2's slide needs the lever).
 * Then turn 6 is sent; returns when its first caption shows.
 */
async function toTurn6(page: Page, o: { muted?: boolean } = {}) {
  await installVoiceFakes(page, { speakMs: 3000 });
  await page.goto("/learn");
  await expect(welcomeBox(page)).toBeVisible({ timeout: 20_000 });
  if (o.muted) await page.getByRole("button", { name: "Mute" }).click();
  await welcomeBox(page).fill("teach me robotics");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(caption(page)).toHaveText(/^If the weight slides farther/, { timeout: 40_000 });
  await send(page, "It gets harder");
  await expect(caption(page)).toHaveText(/^Yes, farther out is harder/, { timeout: 30_000 });
  await send(page, "show me a real servo");
  await expect(caption(page)).toHaveText(/^Now the same idea on a robot joint/, { timeout: 30_000 });
  await send(page, "the rated torque");
  await expect(caption(page)).toHaveText(/^Yes, check its rated torque/, { timeout: 30_000 });
  await send(page, "Yes");
  await expect(caption(page)).toHaveText(/^Here is the ruler held out/, { timeout: 30_000 });
  await send(page, "Longer lever");
  await expect(caption(page)).toHaveText(/^Yes, a longer lever/, { timeout: 30_000 });
}

test.describe("τ = F × d on the servo + arm (slice B), recorded live path", () => {
  test.setTimeout(180_000);
  test.beforeEach(async ({ page, baseURL }) => {
    await page.context().addCookies([{ name: "aili-e2e-live", value: "1", url: baseURL! }]);
  });

  for (const mode of ["voice on", "captions only"] as const) {
    test(`${mode}: each step's line appears in the explanation space with its own segment; the diagram keeps short symbols`, async ({ page }, info) => {
      await toTurn6(page, { muted: mode === "captions only" });
      await expect(page.locator("[data-viewer]")).toHaveAttribute("data-viewer", "ready", { timeout: 20_000 });
      const space = page.getByRole("region", { name: "Explanation space" });
      const wide = info.project.name === "desktop";
      // n1 puts the servo + arm on stage; no step yet.
      await expect(space).toBeVisible();
      await expect(line(page, "eq-force")).toHaveCount(0);
      await expect(page.locator("span[data-eq-label]")).toHaveCount(0);

      await expect(caption(page)).toHaveText(N2, { timeout: 20_000 });
      await expect(line(page, "eq-force")).toHaveAttribute("data-state", "now");
      await expect(line(page, "eq-force")).toContainText(/F = m × g\s*\d+\.\d+ N/);
      await expect(line(page, "eq-distance")).toHaveAttribute("data-state", "next"); // formula only, no value yet
      await expect(line(page, "eq-distance")).not.toContainText(" m");
      await expect(line(page, "eq-torque")).toHaveCount(0);

      await expect(caption(page)).toHaveText(N3, { timeout: 20_000 });
      await expect(line(page, "eq-force")).toHaveAttribute("data-state", "done");
      await expect(line(page, "eq-distance")).toHaveAttribute("data-state", "now");
      await expect(line(page, "eq-distance")).toContainText(/0\.\d\d m/);

      await expect(caption(page)).toHaveText(N4, { timeout: 20_000 });
      await expect(line(page, "eq-torque")).toHaveAttribute("data-state", "now");
      await expect(line(page, "eq-torque")).toContainText(/τ = F × d\s*\d\.\d+ N·m/);
      for (const [step, tag] of [["eq-force", "Done"], ["eq-distance", "Done"], ["eq-torque", "Now"], ["eq-arm-share", "Next"]] as const)
        await expect(line(page, step).locator("span").last()).toHaveText(tag); // text tags, not colour alone
      // The diagram: short symbols only.
      await expect(label(page, "eq-force")).toHaveText("F");
      await expect(label(page, "eq-distance")).toHaveText("d");
      await expect(label(page, "eq-torque")).toHaveText("τ");
      if (!wide) await expect(space.locator("[data-strip-now]")).toContainText(/Now\s*τ = F × d\s*= \d\.\d+ N·m/);
      expect(await axe(page)).toEqual([]);

      // Turn 7: the arm's own share, then the margin (no rating yet: it asks for one).
      await expect(caption(page)).toHaveText(/^What else pulls down on the joint/, { timeout: 20_000 });
      await send(page, "The arm itself");
      await expect(caption(page)).toHaveText(/^Yes: the arm's own weight/, { timeout: 30_000 });
      await expect(line(page, "eq-arm-share")).toHaveAttribute("data-state", "now");
      await expect(line(page, "eq-arm-share")).toContainText(/W × L\/2\s*\d\.\d+ N·m/);
      await expect(label(page, "eq-arm-share")).toHaveText("W");
      await expect(caption(page)).toHaveText(/^Compare that total with your servo's rated torque/, { timeout: 20_000 });
      await expect(line(page, "eq-margin")).toHaveAttribute("data-state", "now");
      await expect(line(page, "eq-margin")).toContainText(/Total \d\.\d+ N·m\. Enter your servo's rated torque/);
      await expect(label(page, "eq-margin")).toHaveCount(0); // the margin lives in the space, not on the diagram
      if (wide) await expect(line(page, "eq-margin")).toBeInViewport(); // the current line is kept in view
      expect(await axe(page)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    });
  }

  test("reduced motion: lines appear at once, with no fade, and the same text", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await toTurn6(page);
    await expect(caption(page)).toHaveText(N4, { timeout: 30_000 });
    await expect(line(page, "eq-torque")).toHaveAttribute("data-state", "now");
    const anim = await line(page, "eq-torque").evaluate((el) => parseFloat(getComputedStyle(el).animationDuration));
    expect(anim).toBeLessThan(0.001); // the UI duration token is (near) zero under reduced motion
  });

  // Screenshots for Lucky (git-ignored apps/web/screenshots/equation): desktop and phone, after turn 7.
  test("screenshots of the equation on the servo + arm", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "taken once");
    const dir = "screenshots/equation";
    mkdirSync(dir, { recursive: true });
    for (const [width, height, name] of [[1280, 800, "desktop"], [412, 915, "phone"]] as const) {
      await page.setViewportSize({ width, height });
      await toTurn6(page);
      await expect(caption(page)).toHaveText(N4, { timeout: 30_000 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${dir}/${name}-1-torque.png` });
      await expect(caption(page)).toHaveText(/^What else pulls down on the joint/, { timeout: 20_000 });
      await send(page, "The arm itself");
      await expect(caption(page)).toHaveText(/^Compare that total/, { timeout: 30_000 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${dir}/${name}-2-margin.png` });
    }
  });

  // Desktop: at every combination of slider extremes, all five labels stay visible and none overlaps
  // another label, a part label or the torque panel.
  test("desktop: no label overlap at the slider extremes (arm length, load distance, load mass)", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "desktop layout; phones show one full label at a time");
    test.setTimeout(240_000);
    await toTurn6(page);
    await expect(caption(page)).toHaveText(/^What else pulls down on the joint/, { timeout: 30_000 });
    await send(page, "The arm itself");
    await expect(caption(page)).toHaveText(/^What could you change on the arm/, { timeout: 30_000 });
    await expect(page.locator("span[data-eq-label]")).toHaveCount(4); // F, d, τ, W (the margin has no symbol on the diagram)

    const inspector = page.getByRole("region", { name: /^Inspector:/ });
    const setSlider = async (part: string, name: string, key: "Home" | "End") => {
      await page.getByRole("button", { name: /^Parts/ }).click();
      await page.getByRole("option", { name: part }).click();
      const slider = inspector.getByRole("slider", { name });
      await slider.focus();
      await page.keyboard.press(key);
      await page.getByRole("button", { name: "Close inspector" }).click();
    };
    const boxes = async () =>
      page.evaluate(() => {
        const vis = (el: Element) => getComputedStyle(el).visibility !== "hidden" && (el as HTMLElement).offsetWidth > 0 && !(el as HTMLElement).hidden;
        const box = (el: Element) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        };
        const eq = [...document.querySelectorAll("span[data-eq-label]")].map((el) => ({ id: el.getAttribute("data-eq-label")!, visible: vis(el), ...box(el) }));
        const parts = [...document.querySelectorAll("span[data-part-id]")].filter(vis).map((el) => ({ id: `part:${el.getAttribute("data-part-id")}`, ...box(el) }));
        const panel = document.querySelector('section[aria-label="Explanation space"]');
        return { eq, others: [...parts, ...(panel ? [{ id: "panel", ...box(panel) }] : [])] };
      });
    const hit = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

    const problems: string[] = [];
    for (const L of ["Home", "End"] as const)
      for (const d of ["Home", "End"] as const)
        for (const m of ["Home", "End"] as const) {
          await setSlider("Arm link", "Arm length", L);
          await setSlider("Load", "Load distance from the joint", d);
          await setSlider("Load", "Load mass", m);
          await page.waitForTimeout(400); // the view re-places labels on the next frames
          const { eq, others } = await boxes();
          const at = `arm ${L === "Home" ? "min" : "max"}, distance ${d === "Home" ? "min" : "max"}, load ${m === "Home" ? "min" : "max"}`;
          for (const e of eq) if (!e.visible) problems.push(`${at}: ${e.id} hidden`);
          const shown = eq.filter((e) => e.visible);
          for (let i = 0; i < shown.length; i++) {
            for (let j = i + 1; j < shown.length; j++) if (hit(shown[i]!, shown[j]!)) problems.push(`${at}: ${shown[i]!.id} overlaps ${shown[j]!.id}`);
            for (const o of others) if (hit(shown[i]!, o)) problems.push(`${at}: ${shown[i]!.id} overlaps ${o.id}`);
          }
        }
    expect(problems).toEqual([]);
  });

  // Option A (Lucky's decision 2026-10-15): after a turn that gave numbers about the scene, moving a
  // slider shows "The professor's numbers use the settings from its last turn."; the next such turn clears it.
  test("a slider moved after the professor's numbers shows the settings note; the next turn with numbers clears it", async ({ page }, info) => {
    test.setTimeout(240_000);
    await toTurn6(page);
    await expect(caption(page)).toHaveText(/^What else pulls down on the joint/, { timeout: 30_000 });
    await send(page, "The arm itself");
    await expect(caption(page)).toHaveText(/^What could you change on the arm/, { timeout: 30_000 });
    const note = page.locator("[data-settings-note]");
    await expect(note).toHaveCount(0); // the numbers match the stage

    await page.getByRole("button", { name: /^Parts/ }).click();
    await page.getByRole("option", { name: "Load" }).click();
    const slider = page.getByRole("region", { name: /^Inspector:/ }).getByRole("slider", { name: "Load mass" });
    await slider.focus();
    await page.keyboard.press("End");
    await page.getByRole("button", { name: "Close inspector" }).click();
    await expect(note).toHaveText("The professor's numbers use the settings from its last turn.");
    await expect(note).toHaveAttribute("role", "status");
    await expect(note.locator("svg")).toHaveCount(1); // icon + words, not colour alone
    expect(await note.evaluate((el) => getComputedStyle(el).fontSize)).toBe(await caption(page).evaluate((el) => getComputedStyle(el).fontSize));
    if (info.project.name === "desktop") {
      const boxes = await page.evaluate(() => {
        const r = (el: Element) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
        const vis = (el: Element) => getComputedStyle(el).visibility !== "hidden" && (el as HTMLElement).offsetWidth > 0;
        return {
          note: r(document.querySelector("[data-settings-note]")!),
          others: [...document.querySelectorAll("span[data-eq-label], span[data-part-id], section[aria-label='Explanation space']")].filter(vis).map(r),
        };
      });
      const hit = (a: typeof boxes.note, b: typeof a) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      expect(boxes.others.filter((o) => hit(boxes.note, o))).toEqual([]);
    }
    expect(await axe(page)).toEqual([]);

    // Turn 8 gives numbers about the scene again: the note goes.
    await send(page, "A shorter arm");
    await expect(caption(page)).toHaveText(/^Yes, a shorter arm/, { timeout: 30_000 });
    await expect(note).toHaveCount(0);
  });
});
