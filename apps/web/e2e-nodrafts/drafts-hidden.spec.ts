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
  await page.getByRole("group", { name: "Lesson" }).getByRole("button").click();
  await expect(page.getByText("This lesson isn't available yet: its scenes are drafts that haven't been expert-reviewed.")).toBeVisible();
  await expect(page.getByRole("group", { name: "Suggested replies" })).toHaveCount(0);
  await expect(page.locator("canvas")).toHaveCount(0);
});

test("the development /preview page is not in production, and / no longer links to it", async ({ page }) => {
  const res = await page.goto("/preview");
  expect(res!.status()).toBe(404);
  await page.goto("/");
  await expect(page.locator('a[href="/preview"]')).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open the Learn stage" })).toHaveAttribute("href", "/learn");
});
