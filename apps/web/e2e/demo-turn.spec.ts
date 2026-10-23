import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { fakeLog, installVoiceFakes } from "./voiceFakes";

// Fake-director turns in the Learn stage under ?demo=1 (M2 slice 6b). This build sets both testing
// flags (playwright.config.ts). Speech engines are fakes; nothing leaves the page but /api/turn.

const SCRIPTED = "Scripted reply: it does not respond to what you typed.";
const LINE1 = "Holding this arm level takes 0.637 newton-metres.";
const stageBadge = (p: Page) => p.locator('[data-badge="fixture"]');
const prepared = (p: Page) => p.getByRole("button", { name: /^Prepared · / });
const alert = (p: Page) => p.locator('p[role="alert"]');
const status = (p: Page) => p.locator('p[role="status"][data-state]');
const replies = (p: Page) => p.getByRole("group", { name: "Suggested replies" });
const partsButton = (p: Page) => p.getByRole("button", { name: /^Parts/ });
const spoken = async (p: Page) => (await fakeLog(p)).spoken;
const axe = async (p: Page) =>
  (await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze()).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`);

async function openDemo(page: Page, speakMs = 300) {
  await installVoiceFakes(page, { speakMs });
  await page.goto("/learn?demo=1");
  await expect(page.locator('[data-viewer="ready"]')).toBeVisible({ timeout: 20000 });
}
async function typeAndSend(page: Page, text = "Why is it hard to hold?") {
  await page.getByRole("textbox", { name: "Ask Aili or answer" }).fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}
async function caseButton(page: Page, c: string) {
  const summary = page.getByText("Demo controls (testing only)");
  if (!(await page.locator("details[open]").count())) await summary.click();
  await page.getByRole("button", { name: `Fake turn: ${c}` }).click();
}
const shot = async (page: Page, name: string, info: { outputPath: (n: string) => string }) => {
  await page.mouse.move(0, 0);
  await page.screenshot({ path: info.outputPath(`${name}.png`) });
};

test.describe("fake-director turn under ?demo=1", () => {
  test.setTimeout(90_000);

  test("a typed question runs the valid case: narration, a marked calculated number, actions, chips, both labels", async ({ page }, info) => {
    await openDemo(page, 2500); // slow speech, so the first caption can be checked and photographed
    const input = page.getByRole("textbox", { name: "Ask Aili or answer" });
    await expect(page.getByText(SCRIPTED)).toBeVisible();
    await expect(input).toHaveAccessibleDescription(SCRIPTED);
    await typeAndSend(page);
    // The calculated value: icon + dotted underline, read as "0.637, calculated".
    const calc = page.locator("[data-calculated]");
    await expect(calc).toBeVisible({ timeout: 15000 });
    await expect(calc).toHaveText("0.637, calculated");
    expect(await calc.evaluate((el) => getComputedStyle(el).textDecorationStyle)).toBe("dotted");
    await expect(calc.locator("svg")).toHaveCount(1);
    await expect(page.locator("main").getByText("Test fixture", { exact: true })).toBeVisible(); // caption badge
    await expect(stageBadge(page)).toHaveText(/Test fixture · Fake director, not live AI/);
    await expect(prepared(page)).toBeVisible(); // both labels: the scene is prepared, the turn is a fixture
    await expect(partsButton(page)).toHaveText("Parts: Weight"); // the action arrived and was applied
    await shot(page, "1-badge-scripted-line-calculated", info);
    await expect.poll(() => spoken(page)).toContain(LINE1);
    await expect(replies(page).getByRole("button")).toHaveText(["Closer to my hand", "Not sure"], { timeout: 15000 });
  });

  for (const [c, words] of [
    ["invalid-id", /didn't pass its checks/],
    ["out-of-bounds", /didn't pass its checks/],
    ["hard-coded-number", /didn't pass its checks/],
    ["pedagogy-violation", /broke a teaching rule/],
    ["solver-failure", /A calculation couldn't run/],
  ] as const) {
    test(`${c}: a plain message under the stage, announced, not spoken; the stage unchanged`, async ({ page }) => {
      await openDemo(page);
      const before = await partsButton(page).innerText();
      const saidBefore = (await spoken(page)).length;
      await caseButton(page, c);
      await expect(alert(page)).toHaveText(words, { timeout: 15000 });
      await expect(alert(page)).toHaveText(/Nothing on the stage changed\.$/);
      expect((await spoken(page)).length).toBe(saidBefore); // shown, not spoken
      await expect(partsButton(page)).toHaveText(before);
      await expect(stageBadge(page)).toHaveCount(0);

    });
  }

  test("interrupt during the slow case: Stopped. announced, stream cancelled, interrupt sent, nothing changed", async ({ page }) => {
    await openDemo(page);
    const before = await partsButton(page).innerText();
    const interruptSent = page.waitForRequest((r) => r.url().endsWith("/api/turn/interrupt") && r.method() === "POST");
    await caseButton(page, "slow");
    await expect(status(page)).toHaveText(/Thinking/, { timeout: 5000 });
    await page.locator("main").focus();
    await page.keyboard.press("Escape");
    await expect(status(page)).toHaveText("Stopped."); // role="status": announced
    const req = await interruptSent;
    expect(req.postDataJSON()).toMatchObject({ request_id: expect.stringMatching(/^turn_\d+$/) });
    await expect(stageBadge(page)).toHaveCount(0);
    await expect(partsButton(page)).toHaveText(before);
    await expect(replies(page)).toHaveCount(0);
    await page.waitForTimeout(3500); // past the slow case's delay: nothing from the stopped turn appears
    expect(await spoken(page)).not.toContain(LINE1);
    await expect(stageBadge(page)).toHaveCount(0);

  });

  test("a dropped connection after actions arrived: the stage never changed, and it says so", async ({ page, request }) => {
    // Cut a real turn's stream just after its actions: no prompt, no turn.done.
    await openDemo(page);
    const before = await partsButton(page).innerText();
    await page.route("**/api/turn", async (route) => {
      const real = await request.post("/api/turn", { data: route.request().postDataJSON() });
      const text = await real.text();
      const cut = text.slice(0, text.indexOf("event: calc.result"));
      await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: cut });
    });
    // Record whether the turn's actions ever reached the stage. Since M4 slice 1 they wait for their
    // narration segment, which only plays once the whole turn has arrived: so never.
    await page.evaluate(() => {
      const w = window as unknown as { __sawWeight: boolean };
      w.__sawWeight = false;
      new MutationObserver(() => {
        if (document.querySelector('button[aria-haspopup="listbox"]')?.textContent?.includes("Weight")) w.__sawWeight = true;
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    await typeAndSend(page);
    await expect(alert(page)).toHaveText("The connection dropped. Nothing on the stage changed.", { timeout: 15000 });
    expect(await page.evaluate(() => (window as unknown as { __sawWeight: boolean }).__sawWeight)).toBe(false); // never applied
    await expect(partsButton(page)).toHaveText(before);
    await expect(stageBadge(page)).toHaveCount(0);
    expect(await spoken(page)).not.toContain(LINE1);
  });

  test("the stage badge stays visible with captions, labels and the text panel all off", async ({ page }) => {
    await openDemo(page);
    await typeAndSend(page);
    await expect(stageBadge(page)).toBeVisible({ timeout: 15000 });
    await page.getByRole("button", { name: "Captions" }).click(); // captions off
    await expect(page.getByRole("button", { name: "Captions" })).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("button", { name: "Labels" })).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("complementary")).toHaveCount(0);
    await expect(stageBadge(page)).toBeVisible();
    await expect(prepared(page)).toBeVisible();
    await expect(page.getByText(SCRIPTED)).toBeVisible();
  });

  test("only same-origin requests during a turn", async ({ page, baseURL }) => {
    const urls: string[] = [];
    page.on("request", (r) => urls.push(r.url()));
    await openDemo(page);
    urls.length = 0;
    await typeAndSend(page);
    await expect.poll(() => spoken(page), { timeout: 15000 }).toContain(LINE1);
    expect(urls.some((u) => u.endsWith("/api/turn"))).toBe(true);
    for (const u of urls) expect(u.startsWith(new URL(baseURL!).origin) || u.startsWith("data:") || u.startsWith("blob:"), u).toBe(true);
  });

  test("keyboard only: type, Enter, then Escape stops a slow turn", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "keyboard");
    await openDemo(page);
    await page.getByRole("textbox", { name: "Ask Aili or answer" }).focus();
    await page.keyboard.type("Why?");
    await page.keyboard.press("Enter");
    await expect.poll(() => spoken(page), { timeout: 15000 }).toContain(LINE1);
    await expect(stageBadge(page)).toBeVisible();
    // The slow case by keyboard: open the Demo controls, reach its button, start it, Escape.
    const summary = page.getByText("Demo controls (testing only)");
    await summary.focus();
    await page.keyboard.press("Enter");
    const slow = page.getByRole("button", { name: "Fake turn: slow" });
    for (let i = 0; i < 20 && !(await slow.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
    await expect(slow).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(status(page)).toHaveText(/Thinking/, { timeout: 5000 });
    await page.keyboard.press("Escape");
    await expect(status(page)).toHaveText("Stopped.");
    await expect(stageBadge(page)).toBeVisible(); // the completed first turn stays; only the stopped one was undone
  });

  for (const scheme of ["light", "dark"] as const)
    test(`axe after a turn, ${scheme}`, async ({ page }, info) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openDemo(page, 2500);
      await typeAndSend(page);
      await expect(page.locator("[data-calculated]")).toBeVisible({ timeout: 15000 });
      expect(await axe(page)).toEqual([]);
      await shot(page, `1-${scheme}-badge-calculated`, info);
      await caseButton(page, "out-of-bounds");
      await expect(alert(page)).toBeVisible({ timeout: 15000 });
      expect(await axe(page)).toEqual([]);
      await shot(page, `3-${scheme}-turn-error`, info);
      await caseButton(page, "slow");
      await expect(status(page)).toHaveText(/Thinking/, { timeout: 5000 });
      await page.locator("main").focus();
      await page.keyboard.press("Escape");
      await expect(status(page)).toHaveText("Stopped.");
      expect(await axe(page)).toEqual([]);
      await shot(page, `4-${scheme}-stopped`, info);
    });
});

test("without ?demo=1 nothing changes: no scripted line, the prepared reply, no turn request", async ({ page }) => {
  const turnCalls: string[] = [];
  page.on("request", (r) => r.url().includes("/api/turn") && turnCalls.push(r.url()));
  await installVoiceFakes(page, { speakMs: 100 });
  await page.goto("/learn");
  await expect(page.getByText(SCRIPTED)).toHaveCount(0);
  await expect(page.getByText("Demo controls (testing only)")).toHaveCount(0);
  await typeAndSend(page);
  await expect(page.locator("main").getByText("Prepared", { exact: true })).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(500);
  expect(turnCalls).toEqual([]);
  await expect(stageBadge(page)).toHaveCount(0);
});
