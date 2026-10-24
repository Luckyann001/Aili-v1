import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { installVoiceFakes } from "./voiceFakes";

// The anatomy view is big enough to teach (16 Oct 2026): measured in screen pixels. The servo's part
// boxes are projected through the real camera (data-servo-boxes) and compared with the free area
// (the safe area minus the explanation column or strip; the captions and mic sit outside it).

const welcomeBox = (p: Page) => p.getByRole("textbox", { name: "What do you want to learn?" });
const bottomBox = (p: Page) => p.getByRole("textbox", { name: "Ask Aili or answer" });
const caption = (p: Page) => p.locator("main [aria-live]").last();
const host = (p: Page) => p.locator("[data-viewer]");
const button = (p: Page, name: string) => p.getByRole("group", { name: "Servo" }).getByRole("button", { name, exact: true });
const total = (p: Page) => p.locator('[data-solver-value="torque_nm"]').first();
type Box = [number, number, number, number];

async function toServo(page: Page) {
  await installVoiceFakes(page, { speakMs: 1200 });
  await page.goto("/learn?lesson=lever");
  await expect(welcomeBox(page)).toBeVisible({ timeout: 20_000 });
  await welcomeBox(page).fill("teach me robotics");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(caption(page)).toHaveText(/^If the weight slides farther/, { timeout: 40_000 });
  await bottomBox(page).fill("It gets harder");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(caption(page)).toHaveText(/^Yes, farther out is harder/, { timeout: 30_000 });
  await bottomBox(page).fill("show me a real servo");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(caption(page)).toHaveText(/^What would you check on your own servo's datasheet/, { timeout: 30_000 });
  await expect(host(page)).toHaveAttribute("data-asset", "loaded", { timeout: 20_000 });
}

/** After a change: the motion and the camera have settled (two equal readings of the boxes). */
async function settled(page: Page, view: string) {
  await expect(host(page)).toHaveAttribute("data-servo", view, { timeout: 5_000 });
  await expect(host(page)).toHaveAttribute("data-camera-view", view === "assembled" ? "scene" : "anatomy");
  await expect
    .poll(async () => {
      const a = await host(page).getAttribute("data-servo-boxes");
      await page.waitForTimeout(250);
      return a !== null && a === (await host(page).getAttribute("data-servo-boxes"));
    }, { timeout: 8_000 })
    .toBe(true);
}

async function measure(page: Page) {
  const free = (await host(page).getAttribute("data-free-area"))!.split(",").map(Number) as Box; // x, y, w, h
  const boxes = JSON.parse((await host(page).getAttribute("data-servo-boxes"))!) as Record<string, Box>;
  const all = Object.values(boxes);
  const spread: Box = [Math.min(...all.map((b) => b[0])), Math.min(...all.map((b) => b[1])), Math.max(...all.map((b) => b[2])), Math.max(...all.map((b) => b[3]))];
  const body = boxes["upper-case"]!;
  return { free, body, spread, ratio: { bodyH: (body[3] - body[1]) / free[3], spreadH: (spread[3] - spread[1]) / free[3], spreadW: (spread[2] - spread[0]) / free[2] } };
}

/** Every shown servo label: its rect never overlaps the box of the part it names. */
async function labelsClearOfTheirParts(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("[data-viewer] canvas")!.getBoundingClientRect();
    const bad: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("span[data-part-id][data-box]"))) {
      if (el.hidden || getComputedStyle(el).visibility === "hidden") continue;
      const [x0, y0, x1, y1] = el.dataset.box!.split(",").map(Number) as [number, number, number, number];
      const r = el.getBoundingClientRect();
      const lx0 = r.left - canvas.left, ly0 = r.top - canvas.top, lx1 = r.right - canvas.left, ly1 = r.bottom - canvas.top;
      if (lx0 < x1 - 1 && x0 < lx1 - 1 && ly0 < y1 - 1 && y0 < ly1 - 1) bad.push(el.dataset.partId!);
    }
    return bad;
  });
}

test.describe("anatomy view size (16 Oct 2026), recorded live path", () => {
  test.setTimeout(180_000);
  test.beforeEach(async ({ page, baseURL }) => {
    await page.context().addCookies([{ name: "aili-e2e-live", value: "1", url: baseURL! }]);
  });

  test("open: the body is at least 45% of the free height; exploded: the spread at least 65%, the body at least 20%; labels never cover their parts; assembled: the whole scene is back, nothing hidden, numbers unchanged", async ({ page }) => {
    await toServo(page);
    const before = await total(page).textContent();

    await button(page, "Open").click();
    await settled(page, "open");
    await expect(page.getByTestId("hidden-note")).toHaveText("Arm and load hidden while you look inside");
    await expect(host(page)).toHaveAttribute("data-hidden-parts", "arm-link,load,base");
    const open = await measure(page);
    console.log(`open: body ${(open.ratio.bodyH * 100).toFixed(0)}% of the free height; free area ${open.free.join(",")}`);
    expect(open.ratio.bodyH).toBeGreaterThanOrEqual(0.45);
    expect(await labelsClearOfTheirParts(page)).toEqual([]);
    expect(await total(page).textContent()).toBe(before);

    await button(page, "Explode").click();
    await settled(page, "exploded");
    const ex = await measure(page);
    console.log(`exploded: spread ${(ex.ratio.spreadH * 100).toFixed(0)}% of the height, ${(ex.ratio.spreadW * 100).toFixed(0)}% of the width; body ${(ex.ratio.bodyH * 100).toFixed(0)}%`);
    expect(Math.max(ex.ratio.spreadH, ex.ratio.spreadW)).toBeGreaterThanOrEqual(0.65);
    expect(ex.ratio.bodyH).toBeGreaterThanOrEqual(0.2);
    // Inside the free area, and centred in it (within a tenth of its size).
    const [fx, fy, fw, fh] = ex.free;
    expect(ex.spread[0]).toBeGreaterThanOrEqual(fx - 2);
    expect(ex.spread[2]).toBeLessThanOrEqual(fx + fw + 2);
    expect(Math.abs((ex.spread[0] + ex.spread[2]) / 2 - (fx + fw / 2))).toBeLessThan(fw * 0.1);
    expect(Math.abs((ex.spread[1] + ex.spread[3]) / 2 - (fy + fh / 2))).toBeLessThan(fh * 0.1);
    expect(await labelsClearOfTheirParts(page)).toEqual([]);
    expect(await total(page).textContent()).toBe(before);

    await button(page, "Assemble").click();
    await settled(page, "assembled");
    await expect(host(page)).toHaveAttribute("data-hidden-parts", "");
    await expect(page.getByTestId("hidden-note")).toHaveCount(0);
    expect(await total(page).textContent()).toBe(before);
  });

  test("the part Aili points at keeps its label, clear of its part, in the exploded view", async ({ page }) => {
    await toServo(page);
    await button(page, "Explode").click();
    await settled(page, "exploded");
    await page.getByRole("button", { name: /^Parts/ }).click();
    await page.getByRole("option", { name: "Motor and position sensor" }).click();
    const close = page.getByRole("button", { name: "Close inspector" });
    if (await close.isVisible()) await close.click();
    await expect(page.locator('span[data-part-id="motor-and-sensor"]')).toBeVisible();
    expect(await labelsClearOfTheirParts(page)).toEqual([]);
  });

  // Screenshots for Lucky (git-ignored apps/web/screenshots/servo-fit), judged by eye.
  test("screenshots: open with the gear train turning, exploded with the horn, assembled again", async ({ browser, baseURL }, info) => {
    test.skip(info.project.name !== "desktop", "taken once");
    test.setTimeout(300_000);
    const dir = "screenshots/servo-fit";
    mkdirSync(dir, { recursive: true });
    for (const [width, height, name] of [[1280, 800, "desktop"], [412, 915, "phone"]] as const) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
      await context.addCookies([{ name: "aili-e2e-live", value: "1", url: baseURL! }]);
      const page = await context.newPage();
      await toServo(page);
      const pick = async (part: string) => {
        await page.getByRole("button", { name: /^Parts/ }).click();
        await page.getByRole("option", { name: part }).click();
        const close = page.getByRole("button", { name: "Close inspector" });
        if (await close.isVisible()) await close.click();
      };
      await button(page, "Open").click();
      await settled(page, "open");
      await pick("Gear train");
      await button(page, "Turn gears").click();
      await page.mouse.move(0, 0);
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${dir}/${name}-1-open-gear-train-turning.png` });
      await button(page, "Stop gears").click();
      await button(page, "Explode").click();
      await settled(page, "exploded");
      await pick("Output horn");
      await page.mouse.move(0, 0);
      await page.screenshot({ path: `${dir}/${name}-2-exploded-horn-selected.png` });
      await button(page, "Assemble").click();
      await settled(page, "assembled");
      await page.mouse.move(0, 0);
      await page.screenshot({ path: `${dir}/${name}-3-assembled-again.png` });
      await context.close();
    }
  });
});
