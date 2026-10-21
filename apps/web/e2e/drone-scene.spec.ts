import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// The drone on its test stand (step 3a, docs/drone-pid-plan.md): reached through the testing-only Demo
// controls (?demo=1, a build with the demo-tools and drafts flags) until the lesson is wired in step 4.

/** Triangle budget for the whole drone scene: the drone (its asset manifest caps it at 3000) and the stand. */
const DRONE_SCENE_TRIANGLE_BUDGET = 3000;

const host = (p: Page) => p.locator("[data-viewer]");
const ready = (p: Page) => p.locator('[data-viewer="ready"]');

async function openDrone(page: Page) {
  await page.goto("/learn?demo=1");
  await expect(page.locator('[data-viewer="ready"], [data-fallback="no-webgl"]').first()).toBeVisible({ timeout: 20000 });
  await page.getByText("Demo controls (testing only)").click();
  // The button closes the testing panel itself before the scene changes, so the camera frames the free stage.
  await page.getByRole("button", { name: "Show the drone scene (draft)" }).click();
}

const stage = async (p: Page) => JSON.parse((await host(p).getAttribute("data-stage"))!) as { scene: string; settings: Record<string, number> };

const axe = async (p: Page) =>
  (await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze()).violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`,
  );

test("the drone scene: on stage with its manifest's settings, within the triangle budget, honestly labelled", async ({ page }) => {
  await openDrone(page);
  await expect(ready(page)).toBeVisible();
  await expect.poll(async () => (await stage(page)).scene).toBe("drone-altitude");
  expect((await stage(page)).settings).toMatchObject({ kp_n_per_m: 10, ki_n_per_m_s: 0, kd_n_s_per_m: 0, target_m: 2, payload_kg: 0 });
  await expect(host(page)).toHaveAttribute("data-triangles-scene", "drone-altitude", { timeout: 15000 });
  const triangles = Number(await host(page).getAttribute("data-triangles"));
  expect(triangles).toBeGreaterThan(500);
  expect(triangles).toBeLessThanOrEqual(DRONE_SCENE_TRIANGLE_BUDGET);
  // The badge says prepared and draft; opened, it gives the honest note (generic, simple shapes, why up and down only).
  const badge = page.getByRole("button", { name: /^Prepared · Draft/ });
  await expect(badge).toBeVisible();
  await badge.click();
  await expect(page.getByText(/Generic quadcopter drawn from simple shapes: not measured, not a named product\. The guide post through its body lets it move only up and down/)).toBeVisible();
});

test("the drone is framed in the free area, and its parts can be picked by name", async ({ page }) => {
  await openDrone(page);
  await expect(host(page)).toHaveAttribute("data-triangles-scene", "drone-altitude", { timeout: 15000 });
  const [x0, y0, x1, y1] = (await host(page).getAttribute("data-model-box"))!.split(",").map(Number);
  const [fx, fy, fw, fh] = (await host(page).getAttribute("data-free-area"))!.split(",").map(Number);
  // The drone's own box (not the stand) is on screen, inside the free area, and not a speck.
  expect(x0!).toBeGreaterThanOrEqual(fx! - 1);
  expect(y0!).toBeGreaterThanOrEqual(fy! - 1);
  expect(x1!).toBeLessThanOrEqual(fx! + fw! + 1);
  expect(y1!).toBeLessThanOrEqual(fy! + fh! + 1);
  expect(x1! - x0!).toBeGreaterThan(20);
  await page.getByRole("button", { name: /^Parts/ }).click();
  for (const name of ["Body", "Propeller 1", "Motor 1", "Height sensor", "Battery", "Camera (added payload)"]) await expect(page.getByRole("option", { name })).toBeVisible();
  await page.getByRole("option", { name: "Height sensor" }).click();
  await expect(page.locator('span[data-part-id="sensor-altitude"]')).toBeVisible();
  // The camera is not bolted on yet: no label for it, even with every label on.
  await expect(page.locator('span[data-part-id="payload-camera"]')).toBeHidden();
});

test("the drone scene passes axe", async ({ page }) => {
  await openDrone(page);
  await expect(host(page)).toHaveAttribute("data-triangles-scene", "drone-altitude", { timeout: 15000 });
  expect(await axe(page)).toEqual([]);
});

test("no WebGL: a still side view of the drone on its stand, named honestly", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (/webgl/i.test(type)) return null;
      return (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof original;
  });
  await openDrone(page);
  const still = page.getByRole("img", { name: /Still side view of the generic drone on a test stand/ });
  await expect(still).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Set height (not to scale)")).toBeVisible();
  // The camera is not drawn before a payload is set.
  await expect(page.locator('[data-fallback] [data-part-id="payload-camera"]')).toHaveCount(0);
  expect(await axe(page)).toEqual([]);
});
