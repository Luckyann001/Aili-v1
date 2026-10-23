import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { installVoiceFakes } from "./voiceFakes";

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
  await expect(page.getByRole("button", { name: /Prepared · Draft \(not expert-reviewed\)/ })).toBeVisible();
  await expect(page.getByRole("group", { name: "Suggested replies" })).toHaveCount(0); // no question yet
  await expect(page.locator('p[role="status"][data-state]')).toHaveText("Ready");
  await expect(page.getByRole("textbox", { name: "Ask Aili or answer" })).toBeVisible();
  await expect(side(page)).toHaveCount(0);
  await expect(explanationBtn(page)).toHaveAttribute("aria-expanded", "false");
});

test("explanation panel opens by keyboard, focuses its tab, Esc closes and returns focus", async ({ page }) => {
  await explanationBtn(page).focus();
  await page.keyboard.press("Enter");
  await expect(side(page)).toBeVisible();
  await expect(explanationBtn(page)).toHaveAttribute("aria-expanded", "true");
  const tab = page.getByRole("tab", { name: "Explanation" });
  await expect(tab).toBeFocused();
  await expect(tab).toHaveAttribute("aria-selected", "true");
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
  await expect(page.getByRole("tab", { name: "Library" })).toBeFocused();
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
  await expect(page.getByRole("tabpanel")).toContainText("Why reach makes holding harder");
});

test("the panel names each view once: tabs only, no repeated visible heading", async ({ page }) => {
  for (const [btn, name] of [[libraryBtn, "Library"], [explanationBtn, "Explanation"]] as const) {
    await btn(page).click();
    await expect(side(page).getByText(name, { exact: true })).toHaveCount(1);
    await expect(side(page).getByRole("heading", { name: "Text panel", level: 2 })).toBeAttached();
    await expect(side(page).getByRole("heading", { name: "Text panel" })).not.toBeInViewport();
    await side(page).getByRole("button", { name: "Close" }).click();
  }
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

test("quick-reply chips appear after Aili's question and fill the text box", async ({ page }) => {
  await installVoiceFakes(page, { speakMs: 200 });
  await page.reload();
  await page.getByRole("textbox", { name: "Ask Aili or answer" }).fill("hi");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("group", { name: "Suggested replies" }).getByRole("button", { name: "Why?" }).click({ timeout: 15000 });
  await expect(page.getByRole("textbox", { name: "Ask Aili or answer" })).toHaveValue("Why?");
});

test("captions and mute are toggle buttons", async ({ page }) => {
  for (const name of ["Captions", "Mute"]) {
    const b = page.getByRole("button", { name });
    const before = await b.getAttribute("aria-pressed");
    await b.click();
    await expect(b).toHaveAttribute("aria-pressed", before === "true" ? "false" : "true");
  }
});

test("voice button: bottom-centre of the stage from 768 px, command bar on phones", async ({ page }) => {
  const mic = page.locator("button[data-state]:visible");
  await expect(mic).toHaveCount(1); // the other placement is display:none at this width
  const m = (await mic.boundingBox())!;
  const st = (await stage(page).boundingBox())!;
  const box = (await page.getByRole("textbox", { name: "Ask Aili or answer" }).boundingBox())!;
  if (page.viewportSize()!.width >= 768) {
    expect(m.y).toBeGreaterThan(st.y + st.height * 0.7);
    expect(m.y + m.height).toBeLessThanOrEqual(st.y + st.height);
    expect(Math.abs(m.x + m.width / 2 - (st.x + st.width / 2))).toBeLessThan(2);
    expect(m.width).toBeGreaterThanOrEqual(64);
  } else {
    expect(m.y).toBeGreaterThan(st.y + st.height);
    expect(m.x + m.width).toBeLessThanOrEqual(box.x);
    expect(Math.abs(m.y + m.height / 2 - (box.y + box.height / 2))).toBeLessThan(4);
  }
});

test("Captions sits bottom-left and Library bottom-right of the stage at every width", async ({ page }) => {
  const st = (await stage(page).boundingBox())!;
  const cc = (await stage(page).getByRole("button", { name: "Captions" }).boundingBox())!;
  const lib = (await libraryBtn(page).boundingBox())!;
  expect(cc.x - st.x).toBeLessThan(24);
  expect(st.x + st.width - (lib.x + lib.width)).toBeLessThan(24);
});

test("captions never overlap the stage's bottom controls", async ({ page }) => {
  await installVoiceFakes(page, { speakMs: 4000 });
  await page.reload();
  await page.getByRole("textbox", { name: "Ask Aili or answer" }).fill("What is a servo?");
  await page.getByRole("button", { name: "Send" }).click();
  const capText = page.getByText("This is a prepared demo line, not a live answer.");
  await expect(capText).toBeVisible();
  const cap = (await capText.locator("..").boundingBox())!;
  for (const name of ["Captions", "Mute", "Start voice input", "Stop speaking", "Library"]) {
    const b = stage(page).getByRole("button", { name });
    if (!(await b.isVisible())) continue;
    const r = (await b.boundingBox())!;
    expect(cap.y + cap.height, name).toBeLessThanOrEqual(r.y);
  }
});

test("hover styles: work with a mouse, never stick after a tap", async ({ page }, info) => {
  const chip = stage(page).getByRole("button", { name: "Captions" });
  const bg = () => chip.evaluate((el) => getComputedStyle(el).backgroundColor);
  const resting = await bg();
  if (info.project.name === "desktop") {
    await chip.hover();
    await expect.poll(bg).not.toBe(resting);
  } else {
    await chip.tap();
    await page.waitForTimeout(400);
    expect(await bg()).toBe(resting);
  }
});

test("no horizontal scrolling, with the panel closed and open", async ({ page }) => {
  const noScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(await noScroll()).toBe(true);
  await explanationBtn(page).click();
  expect(await noScroll()).toBe(true);
});

test("every control sits fully inside the screen (nothing clipped)", async ({ page }) => {
  const vw = page.viewportSize()!.width;
  for (const c of await page.locator("main button:visible, main input:visible").all()) {
    const box = (await c.boundingBox())!;
    const name = (await c.getAttribute("aria-label")) ?? (await c.innerText());
    expect(box.x, name).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, name).toBeLessThanOrEqual(vw);
  }
});

test("every control on the Learn stage is at least 44 px", async ({ page }) => {
  await libraryBtn(page).click();
  const controls = page.locator("main button:visible, main input:visible");
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

test("screenshots, light and dark", async ({ page }, info) => {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(400); // let the 240 ms colour transitions finish
    await page.screenshot({ path: info.outputPath(`learn-closed-${scheme}.png`) });
    await explanationBtn(page).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: info.outputPath(`learn-explanation-${scheme}.png`) });
    await page.getByRole("tab", { name: "Library" }).click();
    await page.screenshot({ path: info.outputPath(`learn-library-${scheme}.png`) });
    await side(page).getByRole("button", { name: "Close" }).click();
  }
});
