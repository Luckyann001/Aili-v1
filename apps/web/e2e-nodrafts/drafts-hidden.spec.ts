import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Production build with NEXT_PUBLIC_AILI_INCLUDE_DRAFTS=0 and no preview flag
// (see playwright.nodrafts.config.ts), i.e. what a real deployment gets.
// Both scenes are drafts, so no scene may be shown, and the lesson must say plainly why.

test("draft scenes are hidden: no 3D, no draft badge, a plain notice", async ({ page }) => {
  await page.goto("/learn");
  await expect(page.getByText("No expert-reviewed scene is available yet.")).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(page.locator("[data-viewer]")).toHaveCount(0);
  await expect(page.getByText(/Draft \(not expert-reviewed\)/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Parts/ })).toHaveCount(0);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
});

test("the lesson says plainly it isn't available yet, and asks nothing", async ({ page }) => {
  await page.goto("/learn");
  // The default lesson is the drone's (24 Oct 2026); its scene is a draft, so production says so plainly.
  await expect(page.getByRole("group", { name: "Lesson" }).getByRole("button")).toHaveText("Start: a drone holding its height");
  await page.getByRole("group", { name: "Lesson" }).getByRole("button").click();
  await expect(page.getByText("This lesson isn't available yet: its scenes are drafts that haven't been expert-reviewed.")).toBeVisible();
  await expect(page.getByRole("group", { name: "Suggested replies" })).toHaveCount(0);
  await expect(page.locator("canvas")).toHaveCount(0);
});

test("the development /preview page is not in production, and / does not link to it", async ({ page }) => {
  const res = await page.goto("/preview");
  expect(res!.status()).toBe(404);
  await page.goto("/");
  await expect(page.locator('a[href="/preview"]')).toHaveCount(0);
});

// Landing and Home keep the button but say why the lesson can't run yet; /login stays a plain page.
test("landing and Home say the demo lesson is waiting for expert review", async ({ page }) => {
  for (const path of ["/", "/home"]) {
    await page.goto(path);
    await expect(page.getByText("The demo lesson is waiting for expert review."), path).toBeVisible();
    await expect(page.locator('main a[href="/learn"]').first(), path).toBeVisible();
  }
});

for (const path of ["/", "/login"]) {
  test(`${path}: no form fields; axe clean`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("form, input, textarea, select")).toHaveCount(0);
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);
  });
}

test("/login offers the demo lesson without an account", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByText("Sign-in opens with the beta. For now, you can try the demo lesson without an account.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Try the demo lesson" })).toHaveAttribute("href", "/learn");
});

// The fake-director demo is off in production (M2 slice 6a): no routes, no fixture files.
test("the fake-director routes return 404", async ({ request }) => {
  const turn = await request.post("/api/turn", { data: { session_id: "nodrafts-0001", state_rev: 1, input: { text: "x" } } });
  expect(turn.status()).toBe(404);
  expect((await request.post("/api/turn/interrupt", { data: { session_id: "nodrafts-0001", request_id: "turn_1", state_rev: 1 } })).status()).toBe(404);
  // The local demand log (step 4 session 2) is dev only: a production build answers 404.
  expect((await request.post("/api/demand", { data: { topic: "learned-controllers", from: "drone-pid lesson" } })).status()).toBe(404);
});

// Live turns are laptop-only dev (docs/m3-live-browser-plan.md): this server runs with AILI_LIVE=1
// (playwright.nodrafts.config.ts) and must still refuse it.
test("live mode is off in production even with AILI_LIVE=1", async ({ request }) => {
  const status = await request.get("/api/live");
  expect(status.status()).toBe(200);
  expect(await status.json()).toEqual({ live: false });
});

// The e2e recording of the live path (slice 6) is only in builds made with AILI_E2E_RECORDED_LIVE=1.
test("the recorded live path is off: the variable at run time and the test's cookie are not enough", async ({ request, context }) => {
  await context.addCookies([{ name: "aili-e2e-live", value: "1", domain: "localhost", path: "/" }]);
  const headers = { cookie: "aili-e2e-live=1" };
  expect(await (await request.get("/api/live", { headers })).json()).toEqual({ live: false });
  expect((await request.post("/api/turn", { headers, data: { session_id: "nodrafts-0002", state_rev: 1, input: { text: "x" } } })).status()).toBe(404);
});

test("the production build contains no part of the e2e recording", async () => {
  const { filesWithText } = await import("../e2e/fixture-text");
  expect(filesWithText(".next-nodrafts", "AILI-E2E-RECORDING")).toEqual([]);
});

test("the production build contains nothing from content/robotics/test-fixtures", async () => {
  const { filesWithFixtureText } = await import("../e2e/fixture-text");
  expect(filesWithFixtureText(".next-nodrafts")).toEqual([]);
});

test("?demo=1 does nothing in production: no Demo controls, no readout, no fixture label, no scripted-reply line", async ({ page }) => {
  await page.goto("/learn?demo=1");
  await expect(page.getByRole("heading", { level: 1 })).toBeAttached();
  await expect(page.getByText("Demo controls (testing only)")).toHaveCount(0);
  await expect(page.getByText(/Performance readout/)).toHaveCount(0);
  await expect(page.getByText("Test fixture")).toHaveCount(0);
  await expect(page.getByText(/Scripted reply/)).toHaveCount(0);
});

// The founder demo mode (npm run dev:demo) is set in this build's environment and must have no effect.
test("the founder demo mode is ignored: standard mode, no demo wording, the turn routes 404", async ({ page, request }) => {
  await page.goto("/learn");
  await expect(page.locator("[data-content-mode]")).toHaveAttribute("data-content-mode", "standard");
  await expect(page.getByText(/demo content|founder-reviewed/i)).toHaveCount(0);
  expect((await request.post("/api/turn", { data: { session_id: "nodrafts-0003", state_rev: 1, input: { text: "x" } } })).status()).toBe(404);
});
