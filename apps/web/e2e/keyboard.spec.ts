import { expect, test, type Page } from "@playwright/test";
import { fakeLog, installVoiceFakes } from "./voiceFakes";

// Keyboard only (Tab, Shift+Tab, Enter, Escape): the Learn stage, the lesson and the fallback.

/** Tab (or Shift+Tab) until the focused element matches; fails if it isn't reachable. */
async function tabTo(page: Page, name: RegExp, back = false, max = 40) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press(back ? "Shift+Tab" : "Tab");
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el ? el.getAttribute("aria-label") || el.textContent?.trim() || "" : "";
    });
    if (name.test(focused)) return;
  }
  throw new Error(`could not reach ${name} by ${back ? "Shift+Tab" : "Tab"}`);
}

const visibleFocusRing = (page: Page) =>
  page.evaluate(() => {
    const cs = getComputedStyle(document.activeElement as HTMLElement);
    return (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== "none";
  });

test("the whole lesson works by keyboard alone, with a visible focus ring at every stop", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "keyboard");
  test.setTimeout(120_000);
  await installVoiceFakes(page, { speakMs: 200 });
  await page.goto("/learn");
  await expect(page.locator('[data-viewer="ready"]')).toBeVisible({ timeout: 20000 });

  await tabTo(page, /^Start: why reach/);
  expect(await visibleFocusRing(page)).toBe(true);
  await page.keyboard.press("Enter");
  // The probe's choices become the next chips; reach them by Tab.
  await expect(page.getByRole("group", { name: "Suggested replies" })).toBeVisible({ timeout: 15000 });
  await page.locator("main").focus();
  await tabTo(page, /^Far from you$/);
  expect(await visibleFocusRing(page)).toBe(true);
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Result: harder/)).toBeVisible({ timeout: 20000 });

  // Escape interrupts while Aili is speaking; the lesson offers to continue.
  await expect.poll(async () => (await fakeLog(page)).spoken.length).toBeGreaterThan(0);
  await expect(page.locator('p[role="status"][data-state]')).toHaveText(/Speaking|Thinking|Ready/);
  if ((await page.locator('p[role="status"][data-state]').getAttribute("data-state")) === "speaking") {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("group", { name: "Lesson" }).getByRole("button")).toHaveText("Continue the lesson");
    await page.locator("main").focus();
    await tabTo(page, /^Continue the lesson$/);
    await page.keyboard.press("Enter");
  }
  await expect(page.getByRole("group", { name: "Suggested replies" }).getByRole("button", { name: "Easier" })).toBeVisible({ timeout: 40000 });
  await page.locator("main").focus();
  await tabTo(page, /^Easier$/);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("group", { name: "Lesson" }).getByRole("button")).toHaveText("Start the lesson again", { timeout: 20000 });
  // Shift+Tab walks back up through the stage controls to the skip link: no trap.
  await tabTo(page, /^Skip to content$/, true, 60);
});

for (const scene of ["arm", "lever"] as const) {
  test(`fallback drawing (no WebGL), ${scene} scene, by keyboard`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "keyboard");
    test.setTimeout(90_000);
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (/webgl/i.test(type)) return null;
        return (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof original;
    });
    await installVoiceFakes(page, { speakMs: 200 });
    await page.goto("/learn");
    await expect(page.getByText("3D view isn't available on this device, so here is a still picture of the parts.")).toBeVisible();
    if (scene === "lever") {
      await tabTo(page, /^Start: why reach/);
      await page.keyboard.press("Enter");
      await expect(page.getByRole("img", { name: /Still side view of the ruler/ })).toBeVisible({ timeout: 15000 });
      await page.keyboard.press("Escape"); // stop the lesson so the parts list is ours
    }
    await page.locator("main").focus();
    await tabTo(page, /^Parts/);
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    const picked = scene === "arm" ? "Servo body" : "Ruler";
    await expect(page.locator(`g[data-part-id] text`, { hasText: `Selected: ${picked}` })).toBeVisible();
    await expect(page.getByRole("button", { name: `Parts: ${picked}` })).toBeFocused();
  });
}

for (const scheme of ["light", "dark"] as const) {
  test(`every focused control passes axe colour contrast, ${scheme}`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "keyboard");
    test.setTimeout(120_000);
    const { default: AxeBuilder } = await import("@axe-core/playwright");
    await page.emulateMedia({ colorScheme: scheme });
    await installVoiceFakes(page, { speakMs: 200 });
    await page.goto("/learn");
    await expect(page.locator('[data-viewer="ready"]')).toBeVisible({ timeout: 20000 });
    const failures: string[] = [];
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("Tab");
      const name = await page.evaluate(() => (document.activeElement as HTMLElement)?.getAttribute("aria-label") || document.activeElement?.textContent?.trim() || "");
      if (!name) break;
      const r = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
      for (const v of r.violations) failures.push(`${name}: ${v.nodes.map((n) => n.target).join(", ")}`);
    }
    expect(failures).toEqual([]);
  });
}

test("reduced motion: every CSS animation and transition is effectively off", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "covers the sheet animation too");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installVoiceFakes(page, { speakMs: 200 });
  await page.goto("/learn?demo=1");
  await expect(page.locator('[data-viewer="ready"]')).toBeVisible({ timeout: 20000 });
  // The listening pulse on the voice button (via the demo control)…
  await page.getByText("Demo controls (testing only)").click();
  await page.getByRole("button", { name: "Show listening" }).click();
  // …and the text panel's slide-up sheet.
  await page.getByRole("button", { name: "Explanation" }).click();
  const slow = await page.evaluate(() => {
    const ms = (v: string) => Math.max(...v.split(",").map((x) => (x.trim().endsWith("ms") ? parseFloat(x) : parseFloat(x) * 1000)));
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("*")) {
      const cs = getComputedStyle(el);
      if (cs.animationName !== "none" && ms(cs.animationDuration) > 1) out.push(`animation ${cs.animationName} ${cs.animationDuration} on ${el.className}`);
      if (cs.transitionProperty !== "none" && ms(cs.transitionDuration) > 1) out.push(`transition ${cs.transitionDuration} on ${el.className}`);
    }
    return out;
  });
  expect(slow).toEqual([]);
});
