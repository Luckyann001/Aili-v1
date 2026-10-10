import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const SHELL_PAGES = ["/home", "/learn"];

test.describe("app shell", () => {
  for (const path of SHELL_PAGES) {
    test(`${path}: labelled landmarks`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("banner")).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
      await expect(page.getByRole("main")).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    });
  }

  test("skip link is the first tab stop and moves focus to main", async ({ page }) => {
    await page.goto("/learn");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
  });

  test("logo links home", async ({ page }) => {
    await page.goto("/learn");
    await page.getByRole("link", { name: "AILI home" }).click();
    await expect(page).toHaveURL(/\/home$/);
  });

  test("menu opens and closes by keyboard; Esc returns focus", async ({ page }) => {
    await page.goto("/home");
    const toggle = page.getByRole("button", { name: "Menu" });
    await toggle.focus();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: /Plan and contents/ })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toBeFocused();
    await expect(page.getByRole("button", { name: /Notes/ })).toBeHidden();
  });

  test("menu closes when focus or a tap leaves it", async ({ page }) => {
    await page.goto("/home");
    const toggle = page.getByRole("button", { name: "Menu" });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    // Tap empty space well below the open menu (on a phone the menu covers the heading).
    const vp = page.viewportSize()!;
    await page.mouse.click(16, vp.height - 16);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("unbuilt menu items say Coming and do nothing; Settings is a link", async ({ page }) => {
    await page.goto("/home");
    await page.getByRole("button", { name: "Menu" }).click();
    const items = page.locator("nav li button");
    await expect(items).toHaveCount(4);
    for (const item of await items.all()) {
      await expect(item).toHaveAttribute("aria-disabled", "true");
      await expect(item).toContainText("Coming");
    }
    // Playwright refuses to click aria-disabled elements unless forced; forcing proves the click is inert.
    await page.getByRole("button", { name: /Sign out/ }).click({ force: true });
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });


  test("touch targets in the top bar are at least 44 px", async ({ page }) => {
    await page.goto("/home");
    await page.getByRole("button", { name: "Menu" }).click();
    const targets = page.locator("header a, header button");
    expect(await targets.count()).toBeGreaterThan(0);
    for (const t of await targets.all()) {
      const box = await t.boundingBox();
      expect(box, await t.innerText()).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
  });

  test("the Prepared badge says what it means", async ({ page }) => {
    await page.goto("/learn");
    const badge = page.getByRole("button", { name: /Prepared · placeholder/ });
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAccessibleDescription(/Not a live AI response/);
  });
});

test.describe("accessibility (axe, WCAG 2.2 A/AA)", () => {
  for (const path of ["/", "/home", "/learn", "/preview"]) {
    for (const scheme of ["light", "dark"] as const) {
      test(`${path} ${scheme}`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(path);
        // Scan the shell with the menu open too, so its items are checked.
        if (SHELL_PAGES.includes(path)) await page.getByRole("button", { name: "Menu" }).click();
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`)).toEqual([]);
      });
    }
  }
});

test("screenshots", async ({ page }, info) => {
  for (const path of ["/home", "/learn"]) {
    await page.goto(path);
    await page.getByRole("button", { name: "Menu" }).click();
    await page.screenshot({ path: info.outputPath(`${path.slice(1)}-menu-open.png`), fullPage: true });
  }
});
