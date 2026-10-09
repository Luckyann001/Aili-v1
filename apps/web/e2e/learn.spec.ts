import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const stage = (p: Page) => p.getByRole("region", { name: "Stage" });
const side = (p: Page) => p.getByRole("complementary");
const explanationBtn = (p: Page) => stage(p).getByRole("button", { name: "Explanation" });
const libraryBtn = (p: Page) => stage(p).getByRole("button", { name: "Library" });
const isWide = (p: Page) => p.viewportSize()!.width >= 900;

test.beforeEach(async ({ page }) => {
  await page.goto("/learn");
});

test("starts with the stage, command bar and captions; text panel closed", async ({ page }) => {
  await expect(stage(page)).toBeVisible();
  await expect(page.getByText("Prepared", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Sample caption/)).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Ask Aili or answer" })).toBeVisible();
  await expect(side(page)).toHaveCount(0);
  await expect(explanationBtn(page)).toHaveAttribute("aria-expanded", "false");
});

test("explanation panel opens by keyboard, takes focus, Esc closes and returns focus", async ({ page }) => {
  await explanationBtn(page).focus();
  await page.keyboard.press("Enter");
  await expect(side(page)).toBeVisible();
  await expect(explanationBtn(page)).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("heading", { name: "Explanation", level: 2 })).toBeFocused();
  await expect(side(page).getByText(/Not reviewed teaching content/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(side(page)).toHaveCount(0);
  await expect(explanationBtn(page)).toBeFocused();
});

test("panel is a right column on wide screens and a bottom sheet on narrow ones", async ({ page }) => {
  await explanationBtn(page).click();
  const vp = page.viewportSize()!;
  const s = (await side(page).boundingBox())!;
  const st = (await stage(page).boundingBox())!;
  if (isWide(page)) {
    expect(s.x).toBeGreaterThanOrEqual(st.x + st.width - 1);
    expect(st.width).toBeGreaterThan(vp.width / 2);
  } else {
    expect(s.width).toBeGreaterThan(vp.width - 2);
    expect(s.y + s.height).toBeGreaterThan(vp.height - 2);
    expect(s.y).toBeGreaterThan(vp.height * 0.2);
  }
});

test("library opens as a view in the same panel; tabs switch with arrow keys", async ({ page }) => {
  await libraryBtn(page).click();
  await expect(page.getByRole("heading", { name: "Library", level: 2 })).toBeFocused();
  const cards = side(page).locator("li");
  await expect(cards).toHaveCount(2);
  for (const c of await cards.all()) await expect(c).toContainText("Sample");
  await expect(side(page).getByText(/not real sources/)).toBeVisible();

  const libTab = page.getByRole("tab", { name: "Library" });
  await expect(libTab).toHaveAttribute("aria-selected", "true");
  await libTab.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "Explanation" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "Explanation" })).toBeFocused();
  await expect(page.getByRole("heading", { name: "Explanation", level: 2 })).toBeVisible();
});

test("close button closes the panel and returns focus", async ({ page }) => {
  await libraryBtn(page).click();
  await side(page).getByRole("button", { name: "Close" }).click();
  await expect(side(page)).toHaveCount(0);
  await expect(libraryBtn(page)).toBeFocused();
});

test("typing a space in the text box types a space", async ({ page }) => {
  const box = page.getByRole("textbox", { name: "Ask Aili or answer" });
  await box.click();
  await page.keyboard.type("why not ");
  await expect(box).toHaveValue("why not ");
});

test("sending says plainly that replies are not connected", async ({ page }) => {
  const box = page.getByRole("textbox", { name: "Ask Aili or answer" });
  await box.fill("What is a servo?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(/Replies aren't connected yet/)).toBeVisible();
  await expect(box).toHaveValue("");
});

test("quick-reply chips fill the text box", async ({ page }) => {
  await page.getByRole("group", { name: "Suggested replies" }).getByRole("button", { name: "Why?" }).click();
  await expect(page.getByRole("textbox", { name: "Ask Aili or answer" })).toHaveValue("Why?");
});

test("captions can be turned off and on", async ({ page }) => {
  const cc = page.getByRole("button", { name: "Captions" });
  await expect(cc).toHaveAttribute("aria-pressed", "true");
  await cc.click();
  await expect(cc).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText(/Sample caption/)).toHaveCount(0);
  await cc.click();
  await expect(page.getByText(/Sample caption/)).toBeVisible();
});

test("voice button is present but marked as not available yet", async ({ page }) => {
  const mic = page.getByRole("button", { name: "Voice input" });
  await expect(mic).toHaveAttribute("aria-disabled", "true");
  await expect(mic).toHaveAccessibleDescription(/Coming soon/);
});

test("no horizontal scrolling, with the panel closed and open", async ({ page }) => {
  const noScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(await noScroll()).toBe(true);
  await explanationBtn(page).click();
  expect(await noScroll()).toBe(true);
});

test("every control sits fully inside the screen (nothing clipped)", async ({ page }) => {
  const vw = page.viewportSize()!.width;
  for (const c of await page.locator("main button, main input").all()) {
    const box = (await c.boundingBox())!;
    const name = (await c.getAttribute("aria-label")) ?? (await c.innerText());
    expect(box.x, name).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, name).toBeLessThanOrEqual(vw);
  }
});

test("every control on the Learn stage is at least 44 px", async ({ page }) => {
  await libraryBtn(page).click();
  const controls = page.locator("main button, main input");
  for (const c of await controls.all()) {
    const box = (await c.boundingBox())!;
    const name = (await c.getAttribute("aria-label")) ?? (await c.innerText());
    expect(box.height, name).toBeGreaterThanOrEqual(44);
    expect(box.width, name).toBeGreaterThanOrEqual(44);
  }
});

for (const scheme of ["light", "dark"] as const) {
  for (const view of ["closed", "explanation", "library"] as const) {
    test(`axe: ${scheme}, panel ${view}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.reload();
      if (view !== "closed") await stage(page).getByRole("button", { name: view === "explanation" ? "Explanation" : "Library" }).click();
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`)).toEqual([]);
    });
  }
}

test("screenshots", async ({ page }, info) => {
  await page.screenshot({ path: info.outputPath("learn-closed.png") });
  await explanationBtn(page).click();
  await page.screenshot({ path: info.outputPath("learn-explanation.png") });
  await page.getByRole("tab", { name: "Library" }).click();
  await page.screenshot({ path: info.outputPath("learn-library.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(400); // let the 240 ms colour transitions finish
  await page.screenshot({ path: info.outputPath("learn-library-dark.png") });
});
