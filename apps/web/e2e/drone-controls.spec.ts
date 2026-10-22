import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { installVoiceFakes } from "./voiceFakes";

// The drone's controls and readouts (step 3b, docs/drone-pid-plan.md): switches with lamps, Run and Gust,
// the advanced panel, the plot with its ghost, the thrust gauge, the P/I/D bars and the checks. Under
// reduced motion a run shows its end at once, so the solver's final values can be checked directly.

const host = (p: Page) => p.locator("[data-viewer]");
const stage = async (p: Page) => JSON.parse((await host(p).getAttribute("data-stage"))!) as { scene: string; settings: Record<string, number> };
const axe = async (p: Page) =>
  (await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze()).violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`,
  );

async function openDrone(page: Page, path = "/learn?demo=1") {
  await page.goto(path);
  await expect(page.locator('[data-viewer="ready"], [data-fallback="no-webgl"]').first()).toBeVisible({ timeout: 20000 });
  await page.getByText("Demo controls (testing only)").click();
  await page.getByRole("button", { name: "Show the drone scene (draft)" }).click();
  await expect.poll(async () => (await stage(page)).scene).toBe("drone-altitude");
}

/** On narrow screens the readouts are in the sheet: open it. */
async function openReadouts(page: Page) {
  const sheet = page.getByRole("button", { name: "Explanation space" });
  if (await sheet.isVisible()) await sheet.click();
}

const sw = (p: Page, name: "P" | "I" | "D") => p.getByRole("switch", { name: new RegExp(`^${name}\\b`) }).first();
const check = (p: Page, id: string) => p.locator(`[data-check="${id}"]`).first();

test.describe("reduced motion: a run shows its end at once", () => {
  test.use({ reducedMotion: "reduce" });

  test("P only: settles below the target by m·g/Kp; the checks say so with icon and word", async ({ page }) => {
    await openDrone(page);
    await expect(sw(page, "P")).toHaveAttribute("aria-checked", "true");
    await expect(sw(page, "I")).toHaveAttribute("aria-checked", "false");
    await expect(sw(page, "I")).toContainText("Off");
    await page.getByRole("button", { name: "Run", exact: true }).first().click();
    await openReadouts(page);
    // The gap is the solver's: 1 kg × 9.80665 m/s² ÷ 10 N/m = 0.98 m.
    await expect(page.locator('[data-solver-value="gap"]').first()).toHaveText("0.98 m");
    await expect(page.locator('[data-solver-value="weight"]').first()).toHaveText("9.8 N");
    await expect(check(page, "gap")).toHaveAttribute("data-status", "fail");
    await expect(check(page, "gap")).toContainText("Fail");
    await expect(check(page, "stability")).toHaveAttribute("data-status", "pass");
    await expect(check(page, "stability")).toContainText("Pass");
  });

  test("switching I and D on: the drone reaches the target; the I bar alone holds the weight at rest", async ({ page }) => {
    await openDrone(page);
    await sw(page, "I").click();
    await sw(page, "D").click();
    await expect(sw(page, "I")).toHaveAttribute("aria-checked", "true");
    expect((await stage(page)).settings).toMatchObject({ kp_n_per_m: 10, ki_n_per_m_s: 4, kd_n_s_per_m: 6 });
    await page.getByRole("button", { name: "Run", exact: true }).first().click();
    await openReadouts(page);
    await expect(page.locator('[data-solver-value="gap"]').first()).toHaveText("0.00 m");
    await expect(check(page, "gap")).toHaveAttribute("data-status", "pass");
    await expect(page.locator('[data-bar="i"]').first()).toContainText("↑ 9.8 N");
    await expect(page.locator('[data-bar="p"]').first()).toContainText("0.0 N");
  });

  test("Too much I: still oscillating at the end, a Warn; the previous run stays as a ghost", async ({ page }) => {
    await openDrone(page);
    await page.getByRole("button", { name: "Run", exact: true }).first().click();
    await openReadouts(page);
    await page.getByText("Advanced: gains, set height and presets").first().click();
    await page.getByRole("button", { name: "Too much I" }).first().click();
    expect((await stage(page)).settings).toMatchObject({ ki_n_per_m_s: 40 });
    // The readouts now belong to the last run, and say so.
    await expect(page.getByText(/You changed the settings since/).first()).toBeVisible();
    await page.getByRole("button", { name: /^Run/ }).first().click();
    await expect(check(page, "stability")).toHaveAttribute("data-status", "warn");
    await expect(check(page, "stability")).toContainText("still oscillating");
    await expect(page.locator("path[data-ghost-target]").first()).toBeAttached();
  });

  test("Gust with P + D: a push from where it rests, back to the same gap", async ({ page }) => {
    await openDrone(page);
    await sw(page, "D").click();
    await page.getByRole("button", { name: "Gust" }).first().click();
    await openReadouts(page);
    await expect(page.getByText("Gust with P + D.").first()).toBeVisible();
    await expect(page.locator('[data-solver-value="gap"]').first()).toHaveText("0.98 m");
  });

  test("the set-height slider is bounded by the scene (0.5–3 m) and the gain sliders show their units", async ({ page }) => {
    await openDrone(page);
    await openReadouts(page);
    await page.getByText("Advanced: gains, set height and presets").first().click();
    const target = page.getByRole("slider", { name: /Target height/ }).first();
    await expect(target).toHaveAttribute("max", "3");
    await target.fill("2.5");
    expect((await stage(page)).settings.target_m).toBe(2.5);
    await expect(page.getByText("P gain (Kp) 10 N/m").first()).toBeVisible();
    expect(await axe(page)).toEqual([]);
  });
});

test("a run plays in real time: the drone climbs, and the checks wait for the end", async ({ page }) => {
  await openDrone(page);
  await page.getByRole("button", { name: "Run", exact: true }).first().click();
  await openReadouts(page);
  await expect(page.getByText("The checks appear when the run ends.").first()).toBeVisible();
  // Partway through, the height is above the rest and below the target.
  await expect
    .poll(async () => Number((await page.locator('[data-solver-value="height"]').first().textContent())!.replace(" m", "")), { timeout: 8000 })
    .toBeGreaterThan(0.3);
  expect(await axe(page)).toEqual([]);
});

test.describe("live mode on the drone scene (recorded provider)", () => {
  test.setTimeout(90_000);
  test.beforeEach(async ({ page, baseURL }) => {
    await page.context().addCookies([{ name: "aili-e2e-live", value: "1", url: baseURL! }]);
  });

  test("a question gets the prepared placeholder line, not a live turn about the servo", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "the routing is the same on every screen");
    // Long enough per line that the placeholder caption is still showing when it is checked.
    await installVoiceFakes(page, { speakMs: 1500 });
    await page.goto("/learn?demo=1");
    const welcome = page.getByRole("textbox", { name: "What do you want to learn?" });
    await expect(welcome).toBeVisible({ timeout: 20_000 });
    await welcome.fill("teach me robotics");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("group", { name: "Suggested replies" })).toBeVisible({ timeout: 20_000 });
    await page.getByText("Demo controls (testing only)").click();
    await page.getByRole("button", { name: "Show the drone scene (draft)" }).click();
    await expect.poll(async () => (await stage(page)).scene).toBe("drone-altitude");
    const turns: string[] = [];
    page.on("request", (r) => {
      if (new URL(r.url()).pathname === "/api/turn") turns.push(r.url());
    });
    await page.getByRole("textbox", { name: /Ask Aili/ }).fill("what is PID?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.locator("main").getByText("This is a prepared placeholder line, not a live answer.")).toBeVisible({ timeout: 10_000 });
    expect(turns).toEqual([]);
  });
});
