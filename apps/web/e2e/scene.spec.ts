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
const partsButton = (p: Page) => p.getByRole("button", { name: /^Parts/ });
/** Opens the Parts menu and picks a part (the menu closes on pick). */
async function pickPart(p: Page, name: string) {
  await partsButton(p).click();
  await option(p, name).click();
}
const label = (p: Page, id: string) => p.locator(`span[data-part-id="${id}"]`);
const camera = async (p: Page) => (await host(p).getAttribute("data-camera"))!.split(",").map(Number);
const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

async function openScene(page: Page, path = "/learn?lesson=lever") {
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
    await page.goto("/learn?lesson=lever");
    await expect(page.getByText("Loading the 3D view… here is a still picture of the parts meanwhile.")).toBeVisible();
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

  test("the still picture shows at once, works, and is replaced by 3D with no layout jump", async ({ page }) => {
    const html = await (await page.request.get("/learn")).text();
    const initial = new Set([...html.matchAll(/\/_next\/static\/[^"'\\\s]+?\.js/g)].map((m) => m[0]));
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    await page.route("**/_next/static/**/*.js", async (route) => {
      if (initial.has(new URL(route.request().url()).pathname)) return route.continue();
      await held; // keep the 3D code back until we have looked at the loading state
      await route.continue();
    });
    await page.goto("/learn?lesson=lever");
    const still = page.locator('[data-fallback="loading"]');
    await expect(still).toBeVisible();
    await expect(page.getByRole("img", { name: /Still side view of the placeholder model/ })).toBeVisible();
    // Usable meanwhile: pick a part in the still picture.
    await pickPart(page, "Arm");
    await expect(page.locator('g[data-part-id="arm"] text')).toHaveText("Selected: Arm");
    const controls = ["Labels", "Reset view", "Explanation", "Captions", "Mute", "Library", "Send"];
    const where = async () => {
      const out: Record<string, string> = {};
      for (const name of controls) {
        const b = (await page.getByRole("button", { name, exact: true }).first().boundingBox())!;
        out[name] = `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)},${Math.round(b.height)}`;
      }
      const sa = (await page.locator("[data-safe-area]").boundingBox())!;
      out.safeArea = `${Math.round(sa.x)},${Math.round(sa.y)},${Math.round(sa.width)},${Math.round(sa.height)}`;
      return out;
    };
    const before = await where();
    release();
    await expect(ready(page)).toBeVisible({ timeout: 20000 });
    await expect(still).toHaveCount(0);
    await expect(canvas(page)).toBeVisible();
    await expect(partsButton(page)).toHaveText("Parts: Arm"); // the selection carried over
    expect(await where()).toEqual(before);
  });

  test("both scenes stay within the triangle budget (arm, then lever)", async ({ page }) => {
    await installVoiceFakes(page, { speakMs: 200 });
    await openScene(page);
    await expect(host(page)).toHaveAttribute("data-triangles-scene", "base-joint-arm");
    const arm = Number(await host(page).getAttribute("data-triangles"));
    // The lesson switches the stage to the lever scene; its first frame reports again.
    await page.getByRole("group", { name: "Lesson" }).getByRole("button").click();
    await expect(host(page)).toHaveAttribute("data-triangles-scene", "lever-analogy", { timeout: 15000 });
    const lever = Number(await host(page).getAttribute("data-triangles"));
    console.log(`triangles: arm ${arm}, lever ${lever} (counts include a highlighted part's outline shell, if any)`);
    for (const t of [arm, lever]) {
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThanOrEqual(SCENE_TRIANGLE_BUDGET);
    }
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
    const t0 = Date.now();
    await page.getByRole("button", { name: "Reset view" }).click();
    await expect.poll(async () => dist(home, await camera(page)), { timeout: 3000, intervals: [20] }).toBeLessThan(0.002);
    // A tween takes about the spatial duration (600 ms); a cut would arrive at once. Load only adds time.
    expect(Date.now() - t0).toBeGreaterThanOrEqual(450);
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
    // Tap where the arm is, once the view has placed its label (the first frames may not have yet:
    // the position was then missing and the tap went to the page's corner) and it has stopped moving.
    const at = async () => `${await arm.getAttribute("data-x")},${await arm.getAttribute("data-y")}`;
    await expect.poll(async () => {
      const a = await at();
      if (a.includes("null")) return false;
      await page.waitForTimeout(300);
      return a === (await at());
    }, { timeout: 10_000 }).toBe(true);
    const x = Number(await arm.getAttribute("data-x"));
    const y = Number(await arm.getAttribute("data-y"));
    if (page.viewportSize()!.width >= 900) await page.mouse.click(c.x + x, c.y + y + 3);
    else await page.touchscreen.tap(c.x + x, c.y + y + 3);
    await expect(partsButton(page)).toHaveText("Parts: Arm");
    await expect(arm).toHaveText("Selected: Arm");
    await expect(arm).toBeVisible(); // labels are off, but the selected part keeps its label
    await expect(page.getByTestId("part-announcer")).toHaveText("Selected: Arm");
  });

  test("keyboard: the Parts menu opens on Enter, arrows select, Enter picks, Escape closes, Delete clears", async ({ page }) => {
    await openScene(page);
    await partsButton(page).focus();
    await page.keyboard.press("Enter");
    await expect(partsButton(page)).toHaveAttribute("aria-expanded", "true");
    await expect(option(page, "Base")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(option(page, "Servo body")).toBeFocused();
    await expect(option(page, "Servo body")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("part-announcer")).toHaveText("Selected: Servo body");
    await page.keyboard.press("End");
    await expect(option(page, "End weight")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowDown"); // wraps
    await expect(option(page, "Base")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(partsButton(page)).toHaveAttribute("aria-expanded", "false");
    await expect(partsButton(page)).toBeFocused();
    await expect(label(page, "base")).toHaveText("Selected: Base");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await expect(partsButton(page)).toHaveAttribute("aria-expanded", "false");
    await expect(partsButton(page)).toBeFocused();
    await expect(partsButton(page)).toHaveText("Parts: Base"); // Escape changed nothing
    await page.keyboard.press("Enter");
    await page.keyboard.press("Delete");
    await expect(page.locator('[role="option"][aria-selected="true"]')).toHaveCount(0);
    await expect(page.getByTestId("part-announcer")).toHaveText("");
  });


  test("Space in the parts list selects; it does not start voice", async ({ page }) => {
    await installVoiceFakes(page, { consent: { choice: "voice", mode: "online" } });
    await openScene(page);
    await partsButton(page).click();
    await option(page, "Arm").focus();
    await page.keyboard.press("Space");
    await expect(partsButton(page)).toHaveText("Parts: Arm");
    await expect(page.locator('p[role="status"][data-state]')).toHaveText("Ready");
  });
});

test.describe("clearing the selection", () => {
  /** A point in empty stage space: centred, just under the top controls, above the model. */
  async function emptyPoint(page: Page) {
    const top = await rect(page.getByRole("group", { name: "View" }));
    const c = await rect(canvas(page));
    return { x: c.x + c.width / 2, y: top.y + top.height + 30 };
  }

  test("'Clear selection' in the Parts list clears it and closes the list", async ({ page }) => {
    await openScene(page);
    await partsButton(page).click();
    await expect(page.getByRole("button", { name: "Clear selection" })).toBeDisabled(); // nothing selected yet
    await option(page, "Arm").click();
    await expect(partsButton(page)).toHaveText("Parts: Arm");
    await partsButton(page).click();
    await page.getByRole("button", { name: "Clear selection" }).click();
    await expect(partsButton(page)).toHaveText("Parts");
    await expect(partsButton(page)).toHaveAttribute("aria-expanded", "false");
    await expect(partsButton(page)).toBeFocused();
    await expect(page.getByTestId("part-announcer")).toHaveText("");
    await expect(label(page, "arm")).toBeHidden();
  });

  test("tapping empty stage space clears it; an orbit drag from empty space does not", async ({ page }, info) => {
    await openScene(page);
    const touch = info.project.name !== "desktop";
    await pickPart(page, "Arm");
    const empty = await emptyPoint(page);
    if (touch) await page.touchscreen.tap(empty.x, empty.y);
    else await page.mouse.click(empty.x, empty.y);
    await expect(partsButton(page)).toHaveText("Parts");
    await expect(page.getByTestId("part-announcer")).toHaveText("");

    await pickPart(page, "Arm");
    const start = await camera(page);
    if (touch) await touchDrag(page, [empty], [{ dx: 80, dy: 0 }]);
    else await drag(page, empty, 80, 0);
    await expect.poll(async () => dist(start, await camera(page))).toBeGreaterThan(0.01);
    await expect(partsButton(page)).toHaveText("Parts: Arm"); // still selected
  });
});

test.describe("exploded view", () => {
  const explode = async (p: Page) => Number(await host(p).getAttribute("data-explode"));

  test("moves parts apart over the spatial duration and back; parts stay selectable", async ({ page }, info) => {
    await openScene(page);
    const btn = page.getByRole("button", { name: "Exploded view" });
    await expect(btn).toHaveAttribute("aria-pressed", "false");
    const t0 = Date.now();
    await btn.click();
    await expect(btn).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => explode(page), { timeout: 3000, intervals: [20] }).toBe(1);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(450); // a tween, not a cut
    // Select the end weight where it now is.
    const c = await rect(canvas(page));
    const end = label(page, "end-weight");
    const x = c.x + Number(await end.getAttribute("data-x"));
    const y = c.y + Number(await end.getAttribute("data-y")) + 4;
    if (info.project.name === "desktop") await page.mouse.click(x, y);
    else await page.touchscreen.tap(x, y);
    await expect(partsButton(page)).toHaveText("Parts: End weight");
    await btn.click();
    await expect.poll(() => explode(page), { timeout: 3000 }).toBe(0);
  });

  test("cuts straight there under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openScene(page);
    await page.getByRole("button", { name: "Exploded view" }).click();
    await expect(host(page)).toHaveAttribute("data-explode", "1.000", { timeout: 250 });
  });
});

test.describe("inspector", () => {
  const inspector = (p: Page) => p.getByRole("region", { name: /^Inspector:/ });
  const armSlider = (p: Page) => p.getByRole("slider", { name: "Arm length" });

  test("shows the selected part's settings with units and bounds, and no results", async ({ page }) => {
    await openScene(page);
    await pickPart(page, "Arm");
    await expect(inspector(page)).toHaveAccessibleName("Inspector: Arm");
    await expect(inspector(page)).toContainText("Placeholder settings. They change the drawing only; nothing is calculated yet.");
    const s = armSlider(page);
    await expect(s).toHaveAttribute("min", "0.1");
    await expect(s).toHaveAttribute("max", "0.3");
    await expect(s).toHaveAttribute("step", "0.01");
    await expect(s).toHaveValue("0.18");
    await expect(s).toHaveAttribute("aria-valuetext", "0.18 metres");
    await expect(inspector(page)).toContainText("0.18 m");
    await expect(inspector(page)).toContainText("0.10 m to 0.30 m");
    await pickPart(page, "Servo body");
    await expect(inspector(page)).toContainText("No settings for this part yet.");
  });

  test("keyboard moves the slider within its bounds and the drawing follows", async ({ page }) => {
    await openScene(page);
    await pickPart(page, "Arm");
    const s = armSlider(page);
    const endX = async () => Number(await label(page, "end-weight").getAttribute("data-x"));
    const before = await endX();
    await s.focus();
    await page.keyboard.press("ArrowRight");
    await expect(s).toHaveValue("0.19");
    await expect(inspector(page)).toContainText("0.19 m");
    await page.keyboard.press("End");
    await expect(s).toHaveValue("0.3");
    await expect(inspector(page)).toContainText("0.30 m");
    await expect.poll(endX).toBeGreaterThan(before); // the end weight moved out with the longer arm
    await page.keyboard.press("Home");
    await expect(s).toHaveValue("0.1");
    await page.keyboard.press("ArrowLeft"); // already at the minimum
    await expect(s).toHaveValue("0.1");
  });

  test("Escape closes it and keeps the selection; Close does too; selecting reopens it", async ({ page }) => {
    await openScene(page);
    await pickPart(page, "Arm");
    await armSlider(page).focus();
    await page.keyboard.press("Escape");
    await expect(inspector(page)).toHaveCount(0);
    await expect(partsButton(page)).toHaveText("Parts: Arm");
    await expect(partsButton(page)).toBeFocused();
    await pickPart(page, "Arm");
    await expect(inspector(page)).toBeVisible();
    await page.locator("main").focus();
    await page.keyboard.press("Escape"); // focus elsewhere on the page
    await expect(inspector(page)).toHaveCount(0);
    await pickPart(page, "End weight");
    await page.getByRole("button", { name: "Close inspector" }).click();
    await expect(inspector(page)).toHaveCount(0);
    await expect(partsButton(page)).toHaveText("Parts: End weight");
  });

  test("at 768 px, exploded with the inspector open, the inspector sits below the model", async ({ page }, info) => {
    test.skip(info.project.name !== "tablet", "768 px tablet");
    await openScene(page);
    await page.getByRole("button", { name: "Exploded view" }).click();
    await expect.poll(async () => Number(await host(page).getAttribute("data-explode")), { timeout: 3000 }).toBe(1);
    await pickPart(page, "Arm");
    const box = await rect(inspector(page));
    const c = await rect(canvas(page));
    expect(box.y + box.height).toBeGreaterThan(c.y + c.height * 0.5); // along the bottom, not the right
    expect(box.width).toBeGreaterThan(c.width * 0.8);
    // The whole model (every part's corners, on screen) stays clear of the inspector and on screen.
    await page.waitForTimeout(700); // refit tween after the inspector opens
    const [x0, y0, x1, y1] = (await host(page).getAttribute("data-model-box"))!.split(",").map(Number) as [number, number, number, number];
    const model = { x: c.x + x0, y: c.y + y0, width: x1 - x0, height: y1 - y0 };
    expect(overlaps(model, box), "model under the inspector").toBe(false);
    expect(model.x).toBeGreaterThanOrEqual(c.x);
    expect(model.x + model.width).toBeLessThanOrEqual(c.x + c.width);
    expect(model.y).toBeGreaterThanOrEqual(c.y);
    await page.screenshot({ path: info.outputPath("tablet-768-exploded-inspector.png") });
  });

  test("never covers the voice orb, captions or bottom controls", async ({ page }) => {
    await installVoiceFakes(page, { speakMs: 8000 });
    await openScene(page);
    await page.getByRole("textbox", { name: "Ask Aili or answer" }).fill("hi");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("This is a prepared demo line, not a live answer.")).toBeVisible();
    await page.getByRole("button", { name: "Exploded view" }).click();
    await pickPart(page, "Arm");
    const box = await rect(inspector(page));
    const blockers = [
      page.getByText("This is a prepared demo line, not a live answer.").locator(".."),
      page.locator('p[role="status"][data-state]'),
      page.locator("main button[data-state]:visible"), // the voice orb (or the phone's mic button)
      ...["Captions", "Mute", "Library"].map((name) => page.locator('section[aria-label="Stage"]').getByRole("button", { name })),
    ];
    for (const b of blockers) expect(overlaps(box, await rect(b))).toBe(false);
  });
});

test.describe("labels", () => {
  test("labels are off by default; Labels shows them; the selected part always keeps its label", async ({ page }) => {
    await openScene(page);
    const btn = page.getByRole("button", { name: "Labels" });
    await expect(btn).toHaveAttribute("aria-pressed", "false");
    for (const id of ["base", "servo", "arm", "end-weight"]) await expect(label(page, id)).toBeHidden();
    await pickPart(page, "Arm");
    await expect(label(page, "arm")).toBeVisible();
    await expect(label(page, "arm")).toHaveText("Selected: Arm");
    for (const id of ["base", "servo", "end-weight"]) await expect(label(page, id)).toBeHidden();
    await btn.click();
    await expect(btn).toHaveAttribute("aria-pressed", "true");
    for (const id of ["base", "servo", "arm", "end-weight"]) await expect(label(page, id)).toBeVisible();
  });


  test("labels never overlap the voice orb, captions or controls, even zoomed in", async ({ page }) => {
    await installVoiceFakes(page, { speakMs: 8000 });
    await openScene(page);
    await page.getByRole("textbox", { name: "Ask Aili or answer" }).fill("hi");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("This is a prepared demo line, not a live answer.")).toBeVisible();
    await page.getByRole("button", { name: "Labels" }).click();
    const check = async () => {
      const blockers = [
        page.getByText("This is a prepared demo line, not a live answer.").locator(".."),
        page.locator('p[role="status"][data-state]'),
        page.locator("main [data-state]:visible").filter({ has: page.locator("svg") }),
        page.locator('main section[aria-label="Stage"] button:visible'),
        page.getByRole("button", { name: /^Parts/ }),
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
    await page.goto("/learn?lesson=lever");
    await expect(page.getByText("3D view isn't available on this device, so here is a still picture of the parts.")).toBeVisible();
    await expect(page.locator("canvas")).toHaveCount(0);
    await expect(page.getByRole("img", { name: /Still side view of the placeholder model/ })).toBeVisible();
    await pickPart(page, "Arm");
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
    await pickPart(page, "Arm");
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
    await page.setViewportSize({ width: 360, height: 440 });
    await openScene(page);
    // Only meaningful if the page is taller than the screen.
    expect(await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight)).toBe(true);
    // The orbit controls listen on React Three Fiber's wrapper (the canvas's grandparent).
    expect(await page.locator("[data-viewer] > div").evaluate((d) => getComputedStyle(d).touchAction)).toBe("none");
    const box = await rect(page.getByRole("textbox", { name: "Ask Aili or answer" }));
    await touchDrag(page, [{ x: box.x + 20, y: box.y + box.height / 2 }], [{ dx: 0, dy: -200 }]);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });
});

test.describe("honesty and accessibility", () => {
  test("the badge says Prepared · Draft (not expert-reviewed); the full wording shows on tap and on keyboard focus", async ({ page }) => {
    await openScene(page);
    const badge = page.getByRole("button", { name: /Prepared · Draft \(not expert-reviewed\)/ });
    const note = page.getByText(
      "Prepared content, written in advance. Not a live AI response. Draft (not expert-reviewed). Placeholder model for layout testing. Not a real product.",
    );
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAccessibleDescription(/Placeholder model for layout testing\. Not a real product\./);
    await expect(note).toBeHidden();
    await badge.click();
    await expect(note).toBeVisible();
    await badge.click();
    await expect(note).toBeHidden();
    await page.locator("main").focus();
    await page.keyboard.press("Tab");
    await expect(badge).toBeFocused();
    await expect(note).toBeVisible();
  });

  test("no engineering numbers on the stage", async ({ page }) => {
    await openScene(page);
    // Dimensions in metres are allowed in the inspector (placeholder drawing values); results such
    // as mass, force, torque, power or electrical values must never appear.
    await pickPart(page, "Arm");
    const text = await page.locator('section[aria-label="Stage"]').innerText();
    expect(text).toContain("0.18 m");
    expect(text).not.toMatch(/\d+(\.\d+)?\s?(kg|g|N|N·m|Nm|kgf|kgf·cm|W|V|A|mA)\b/);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`axe and screenshot with a part selected, ${scheme}`, async ({ page }, info) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openScene(page);
      await pickPart(page, "Servo body");
      await page.mouse.move(0, 0);
      await page.waitForTimeout(400);
      expect(await axe(page)).toEqual([]);
      await page.screenshot({ path: info.outputPath(`scene-selected-${scheme}.png`) });
    });

    test(`axe and screenshot, exploded with the inspector open, ${scheme}`, async ({ page }, info) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openScene(page);
      await page.getByRole("button", { name: "Exploded view" }).click();
      await pickPart(page, "Arm");
      await page.mouse.move(0, 0);
      await page.waitForTimeout(900);
      expect(await axe(page)).toEqual([]);
      await page.screenshot({ path: info.outputPath(`scene-exploded-inspector-${scheme}.png`) });
    });
  }
});

test.describe("testing-only performance readout (?demo=1)", () => {
  test("shows load, 3D-ready and orbit timings and the renderer; copies them as text", async ({ page, context }, info) => {
    test.skip(info.project.name === "tablet");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/learn?lesson=lever&demo=1");
    await expect(ready(page)).toBeVisible({ timeout: 20000 });
    await page.getByText("Demo controls (testing only)").click();
    const panel = page.getByRole("region", { name: "Performance readout (testing only)" });
    await expect(panel).toContainText("nothing is sent anywhere");
    await expect(panel.getByTestId("perf-load")).toHaveText(/^\d+ ms$/);
    await expect(panel.getByTestId("perf-scene")).toHaveText(/^\d+ ms$/);
    await expect(panel.getByTestId("perf-frames")).toHaveText("drag the 3D view to measure");
    await expect(panel.getByTestId("perf-renderer")).not.toBeEmpty();
    // Orbit with the panel closed (on a phone it covers part of the 3D view), then read it again.
    const summary = page.getByText("Demo controls (testing only)");
    await summary.click();
    await expect(page.locator("details[open]")).toHaveCount(0);
    // Drag only from a point that is on the 3D view once the layout has settled (on a phone the
    // closing panel and the command area move things for a moment).
    const at = async () => {
      const c = await rect(canvas(page));
      return { x: c.x + c.width / 2, y: c.y + c.height * 0.6 };
    };
    await expect
      .poll(async () => {
        const p = await at();
        return page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName === "CANVAS", p);
      })
      .toBe(true);
    await drag(page, await at(), 120, 10);
    await summary.click();
    await expect(panel.getByTestId("perf-frames")).toHaveText(/^median \d+\.\d ms, worst \d+\.\d ms \(\d+ frames\)$/);
    await panel.getByRole("button", { name: "Copy results" }).click();
    await expect(panel.getByRole("status")).toHaveText(/Copied/);
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toMatch(/^Aili phone test readout \(testing only\)\nPage load: \d+ ms\n3D scene ready: \d+ ms\nOrbit frames: \d+, median/);
  });

  test("is not shown without ?demo=1", async ({ page }) => {
    await page.goto("/learn?lesson=lever");
    await expect(ready(page)).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("region", { name: "Performance readout (testing only)" })).toHaveCount(0);
  });
});
