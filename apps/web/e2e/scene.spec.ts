import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { gzipSync } from "node:zlib";
import { installVoiceFakes } from "./voiceFakes";

// 3D scene on the Learn stage (M1 slice 4a): placeholder model, orbit, select, labels, reset,
// fallback, lazy loading and the size budget (docs/aili-stage-layout.md §5).

/** Size budget for the lazily loaded 3D code, gzip bytes. Keep in step with the stage layout doc. */
const SCENE_JS_BUDGET_GZ = 300 * 1024;
/** Triangle budget for the placeholder scene. */
const SCENE_TRIANGLE_BUDGET = 2000;

const host = (p: Page) => p.locator("[data-viewer]");
const ready = (p: Page) => p.locator('[data-viewer="ready"]');
const canvas = (p: Page) => p.locator("[data-viewer] canvas");
const option = (p: Page, name: string) => p.getByRole("option", { name });
const label = (p: Page, id: string) => p.locator(`span[data-part-id="${id}"]`);
const camera = async (p: Page) => (await host(p).getAttribute("data-camera"))!.split(",").map(Number);
const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

async function openScene(page: Page, path = "/learn") {
  await page.goto(path);
  await expect(ready(page)).toBeVisible({ timeout: 20000 });
}

async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number, button: "left" | "right" = "left") {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button });
  for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + (dx * i) / 8, from.y + (dy * i) / 8);
  await page.mouse.up({ button });
}

async function touchDrag(page: Page, points: Array<{ x: number; y: number }>, delta: Array<{ dx: number; dy: number }>) {
  const cdp = await page.context().newCDPSession(page);
  const at = (k: number) => points.map((p, i) => ({ x: p.x + delta[i]!.dx * k, y: p.y + delta[i]!.dy * k, id: i }));
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(0) });
  for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(i / 10) });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

const rect = async (l: Locator) => (await l.boundingBox())!;
const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const axe = async (p: Page) =>
  (await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze()).violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`,
  );

test.describe("loading and budget", () => {
  test("3D code loads after the page is usable, within the size budget", async ({ page, request }, info) => {
    test.skip(info.project.name !== "desktop", "measured once");
    const html = await (await request.get("/learn")).text();
    const initial = new Set([...html.matchAll(/\/_next\/static\/[^"'\\\s]+?\.js/g)].map((m) => m[0]));
    const lazy: Array<{ path: string; raw: number; gz: number }> = [];
    await page.route("**/_next/static/**/*.js", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (initial.has(path)) return route.continue();
      const response = await route.fetch();
      const body = await response.body();
      lazy.push({ path, raw: body.length, gz: gzipSync(body).length });
      await new Promise((r) => setTimeout(r, 2500)); // hold the 3D code back
      await route.fulfill({ response, body });
    });
    await installVoiceFakes(page);
    await page.goto("/learn");
    await expect(page.getByText("Loading 3D view…")).toBeVisible();
    // The rest of the stage works while the 3D code is still on its way.
    await page.getByRole("textbox", { name: "Ask Aili or answer" }).fill("What is a servo?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.locator('p[role="status"][data-state]')).toHaveText(/Thinking|Speaking/);
    await expect(ready(page)).toBeVisible({ timeout: 20000 });

    const gz = lazy.reduce((n, c) => n + c.gz, 0);
    const raw = lazy.reduce((n, c) => n + c.raw, 0);
    console.log(`lazy 3D chunks: ${lazy.length}, ${(raw / 1024).toFixed(1)} KB raw, ${(gz / 1024).toFixed(1)} KB gzip`);
    expect(lazy.length).toBeGreaterThan(0);
    expect(gz).toBeLessThanOrEqual(SCENE_JS_BUDGET_GZ);
  });

  test("the scene stays within the triangle budget", async ({ page }) => {
    await openScene(page);
    const triangles = Number(await host(page).getAttribute("data-triangles"));
    console.log(`triangles: ${triangles}`);
    expect(triangles).toBeGreaterThan(0);
    expect(triangles).toBeLessThanOrEqual(SCENE_TRIANGLE_BUDGET);
  });
});

test.describe("orbit, zoom, pan and reset", () => {
  test("mouse: drag orbits, wheel zooms, right-drag pans", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "mouse");
    await openScene(page);
    const c = await rect(canvas(page));
    const mid = { x: c.x + c.width / 2, y: c.y + c.height / 2 };
    const start = await camera(page);
    await drag(page, mid, 120, 30);
    const orbited = await camera(page);
    expect(dist(start, orbited)).toBeGreaterThan(0.01);
    const before = Math.hypot(...orbited);
    await page.mouse.move(mid.x, mid.y);
    await page.mouse.wheel(0, -400);
    await expect.poll(async () => Math.hypot(...(await camera(page)))).toBeLessThan(before);
    const zoomed = await camera(page);
    await drag(page, mid, 60, 0, "right");
    expect(dist(zoomed, await camera(page))).toBeGreaterThan(0.001);
  });

  test("touch: one finger orbits, two fingers zoom", async ({ page }, info) => {
    test.skip(info.project.name === "desktop", "touch");
    await openScene(page);
    const c = await rect(canvas(page));
    const mid = { x: c.x + c.width / 2, y: c.y + c.height / 2 };
    const start = await camera(page);
    await touchDrag(page, [mid], [{ dx: 80, dy: 0 }]);
    await expect.poll(async () => dist(start, await camera(page))).toBeGreaterThan(0.01);
    const before = await camera(page);
    await touchDrag(
      page,
      [
        { x: mid.x - 30, y: mid.y },
        { x: mid.x + 30, y: mid.y },
      ],
      [
        { dx: -60, dy: 0 },
        { dx: 60, dy: 0 },
      ],
    );
    await expect.poll(async () => dist(before, await camera(page))).toBeGreaterThan(0.005);
  });

  test("the gaps beside the voice controls and captions still orbit the scene", async ({ page }) => {
    await installVoiceFakes(page, { speakMs: 6000 });
    await openScene(page);
    await page.getByRole("textbox", { name: "Ask Aili or answer" }).fill("hi");
    await page.getByRole("button", { name: "Send" }).click();
    const cap = page.getByText("This is a prepared demo line, not a live answer.");
    await expect(cap).toBeVisible();
    const status = await rect(page.locator('p[role="status"][data-state]'));
    const capBox = await rect(cap.locator(".."));
    // Just left of the voice status label, and just left of the caption box.
    for (const point of [
      { x: status.x - 12, y: status.y + status.height / 2 },
      { x: capBox.x - 8, y: capBox.y + capBox.height / 2 },
    ]) {
      const start = await camera(page);
      await drag(page, point, -70, -10);
      await expect.poll(async () => dist(start, await camera(page)), { message: JSON.stringify(point) }).toBeGreaterThan(0.005);
    }
  });

  test("Reset view tweens back over the spatial duration", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "mouse");
    await openScene(page);
    const home = await camera(page);
    const c = await rect(canvas(page));
    await drag(page, { x: c.x + c.width / 2, y: c.y + c.height / 2 }, 150, 40);
    expect(dist(home, await camera(page))).toBeGreaterThan(0.02);
    await page.getByRole("button", { name: "Reset view" }).click();
    await page.waitForTimeout(120);
    expect(dist(home, await camera(page))).toBeGreaterThan(0.001); // still moving
    await expect.poll(async () => dist(home, await camera(page)), { timeout: 2000 }).toBeLessThan(0.002);
  });

  test("Reset view cuts straight back under reduced motion", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "mouse");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openScene(page);
    const home = await camera(page);
    const c = await rect(canvas(page));
    await drag(page, { x: c.x + c.width / 2, y: c.y + c.height / 2 }, 150, 40);
    await page.getByRole("button", { name: "Reset view" }).click();
    expect(dist(home, await camera(page))).toBeLessThan(0.002); // read immediately: no tween
  });
});

test.describe("selection", () => {
  test("tapping or clicking a part selects it: outline label, list and announcement agree", async ({ page }) => {
    await openScene(page);
    const c = await rect(canvas(page));
    const arm = label(page, "arm");
    const x = Number(await arm.getAttribute("data-x"));
    const y = Number(await arm.getAttribute("data-y"));
    if (page.viewportSize()!.width >= 900) await page.mouse.click(c.x + x, c.y + y + 3);
    else await page.touchscreen.tap(c.x + x, c.y + y + 3);
    await expect(option(page, "Arm")).toHaveAttribute("aria-selected", "true");
    await expect(arm).toHaveText("Selected: Arm");
    await expect(page.getByTestId("part-announcer")).toHaveText("Selected: Arm");
  });

  test("keyboard: Tab into the parts list, arrows select, Enter selects, Escape clears", async ({ page }) => {
    await openScene(page);
    await option(page, "Base").focus();
    await page.keyboard.press("ArrowRight");
    await expect(option(page, "Servo body")).toBeFocused();
    await expect(option(page, "Servo body")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("part-announcer")).toHaveText("Selected: Servo body");
    await page.keyboard.press("End");
    await expect(option(page, "End weight")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowRight"); // wraps
    await expect(option(page, "Base")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(label(page, "base")).toHaveText("Selected: Base");
    await page.keyboard.press("Escape");
    await expect(page.locator('[role="option"][aria-selected="true"]')).toHaveCount(0);
    await expect(page.getByTestId("part-announcer")).toHaveText("");
  });

  test("Space in the parts list selects; it does not start voice", async ({ page }) => {
    await installVoiceFakes(page, { consent: { choice: "voice", mode: "online" } });
    await openScene(page);
    await option(page, "Arm").focus();
    await page.keyboard.press("Space");
    await expect(option(page, "Arm")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('p[role="status"][data-state]')).toHaveText("Ready");
  });
});

test.describe("labels", () => {
  test("Labels toggles part labels; the selected part keeps its label", async ({ page }) => {
    await openScene(page);
    const btn = page.getByRole("button", { name: "Labels" });
    await expect(btn).toHaveAttribute("aria-pressed", "true");
    for (const id of ["base", "servo", "arm", "end-weight"]) await expect(label(page, id)).toBeVisible();
    await option(page, "Arm").click();
    await btn.click();
    await expect(btn).toHaveAttribute("aria-pressed", "false");
    for (const id of ["base", "servo", "end-weight"]) await expect(label(page, id)).toBeHidden();
    await expect(label(page, "arm")).toBeVisible();
    await expect(label(page, "arm")).toHaveText("Selected: Arm");
  });

  test("labels never overlap the voice orb, captions or controls, even zoomed in", async ({ page }) => {
    await installVoiceFakes(page, { speakMs: 8000 });
    await openScene(page);
    await page.getByRole("textbox", { name: "Ask Aili or answer" }).fill("hi");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("This is a prepared demo line, not a live answer.")).toBeVisible();
    const check = async () => {
      const blockers = [
        page.getByText("This is a prepared demo line, not a live answer.").locator(".."),
        page.locator('p[role="status"][data-state]'),
        page.locator("main [data-state]:visible").filter({ has: page.locator("svg") }),
        page.locator('main section[aria-label="Stage"] button:visible'),
        page.locator('[role="option"]'),
      ];
      const boxes = [];
      for (const b of blockers) for (const el of await b.all()) boxes.push(await rect(el));
      for (const id of ["base", "servo", "arm", "end-weight"]) {
        const l = label(page, id);
        if (!(await l.isVisible())) continue;
        const r = await rect(l);
        for (const b of boxes) expect(overlaps(r, b), `${id} label overlaps a control`).toBe(false);
      }
    };
    await check();
    if (page.viewportSize()!.width >= 900) {
      const c = await rect(canvas(page));
      await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
      await page.mouse.wheel(0, -1500);
      await page.waitForTimeout(300);
      await check();
    }
  });
});

test.describe("fallback", () => {
  test("no WebGL: a still picture with the parts, selection still works", async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (/webgl/i.test(type)) return null;
        return (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof original;
    });
    await page.goto("/learn");
    await expect(page.getByText("3D view isn't available on this device, so here is a still picture of the parts.")).toBeVisible();
    await expect(page.locator("canvas")).toHaveCount(0);
    await expect(page.getByRole("img", { name: /Still side view of the placeholder model/ })).toBeVisible();
    await option(page, "Arm").click();
    await expect(page.locator('g[data-part-id="arm"] text')).toHaveText("Selected: Arm");
    expect(await axe(page)).toEqual([]);
  });

  test("WebGL lost while running: falls back to the still picture", async ({ page }) => {
    await openScene(page);
    await canvas(page).evaluate((c) => {
      const gl = (c as HTMLCanvasElement).getContext("webgl2") ?? (c as HTMLCanvasElement).getContext("webgl");
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    });
    await expect(page.getByText(/3D view isn't available on this device/)).toBeVisible();
  });

  test("leaving and coming back shows the 3D view again", async ({ page }) => {
    await openScene(page);
    await page.getByRole("link", { name: "AILI home" }).click();
    await expect(page).toHaveURL(/\/home$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/learn$/);
    await expect(ready(page)).toBeVisible({ timeout: 20000 });
    await expect(canvas(page)).toHaveCount(1);
    // Still rendering and interactive: selecting re-labels the part and the camera still orbits.
    await option(page, "Arm").click();
    await expect(label(page, "arm")).toHaveText("Selected: Arm");
    await expect(label(page, "arm")).toBeVisible();
    const c = await rect(canvas(page));
    const start = await camera(page);
    await drag(page, { x: c.x + c.width / 2, y: c.y + c.height / 2 }, 90, 0);
    await expect.poll(async () => dist(start, await camera(page))).toBeGreaterThan(0.005);
  });
});

test.describe("phones", () => {
  test("touching outside the stage still scrolls a short phone screen", async ({ page }, info) => {
    test.skip(info.project.name !== "phone", "phone only");
    await page.setViewportSize({ width: 360, height: 560 });
    await openScene(page);
    // The orbit controls listen on React Three Fiber's wrapper (the canvas's grandparent).
    expect(await page.locator("[data-viewer] > div").evaluate((d) => getComputedStyle(d).touchAction)).toBe("none");
    const chips = await rect(page.getByRole("group", { name: "Suggested replies" }));
    await touchDrag(page, [{ x: chips.x + 10, y: chips.y + chips.height / 2 }], [{ dx: 0, dy: -200 }]);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });
});

test.describe("honesty and accessibility", () => {
  test("placeholder note and Prepared badge are visible; no engineering numbers on the stage", async ({ page }) => {
    await openScene(page);
    await expect(page.getByText("Placeholder model for layout testing. Not a real product.")).toBeVisible();
    await expect(page.locator('section[aria-label="Stage"]').getByText("Prepared", { exact: true }).first()).toBeVisible();
    const text = await page.locator('section[aria-label="Stage"]').innerText();
    expect(text).not.toMatch(/\d+(\.\d+)?\s?(kg|g|N|N·m|Nm|mm|cm|m|kgf)\b/);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`axe and screenshot with a part selected, ${scheme}`, async ({ page }, info) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openScene(page);
      await option(page, "Servo body").click();
      await page.mouse.move(0, 0);
      await page.waitForTimeout(400);
      expect(await axe(page)).toEqual([]);
      await page.screenshot({ path: info.outputPath(`scene-selected-${scheme}.png`) });
    });
  }
});
