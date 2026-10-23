import { expect, test, type Page } from "@playwright/test";

// 200% browser zoom (a 206 px-wide layout on a 412 px phone) and large system text (200% root
// font size on a 360 px phone): nothing may scroll sideways, be cut off, be clipped or overlap.
import { installVoiceFakes } from "./voiceFakes";

async function audit(page: Page, label: string, screenW: number) {
  const r = await page.evaluate((vw) => {
    const out: string[] = [];
    if (document.documentElement.scrollWidth > vw + 1) out.push(`page scrolls sideways (${document.documentElement.scrollWidth} > ${vw})`);
    const ctrls = [...document.querySelectorAll<HTMLElement>("main button, main input, header a, header button, [role=option]")].filter(
      (e) => e.offsetParent !== null && getComputedStyle(e).visibility !== "hidden",
    );
    const boxes = ctrls.map((e) => ({ n: e.getAttribute("aria-label") || e.textContent?.trim().slice(0, 24) || e.tagName, r: e.getBoundingClientRect(), e }));
    for (const b of boxes) {
      if (b.r.left < -1 || b.r.right > vw + 1) out.push(`cut off at the side: "${b.n}" (${Math.round(b.r.left)}–${Math.round(b.r.right)})`);
      if (b.e.scrollWidth > b.e.clientWidth + 2 && b.e.tagName !== "INPUT") out.push(`text clipped inside: "${b.n}"`);
    }
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!.r, c = boxes[j]!.r;
        if (boxes[i]!.e.contains(boxes[j]!.e) || boxes[j]!.e.contains(boxes[i]!.e)) continue;
        if (a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1) out.push(`overlap: "${boxes[i]!.n}" / "${boxes[j]!.n}"`);
      }
    return out;
  }, screenW);
  expect(r, label).toEqual([]);
}

for (const mode of ["zoom200", "largeText"] as const) {
  test(mode, async ({ page }, info) => {
    test.skip(info.project.name !== "phone");
    test.setTimeout(90000);
    if (mode === "zoom200") await page.setViewportSize({ width: 206, height: 420 });
    else await page.setViewportSize({ width: 360, height: 740 });
    await installVoiceFakes(page, { speakMs: 200 });
    if (mode === "largeText") await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => (document.documentElement.style.fontSize = "200%")));
    await page.goto("/learn");
    await page.locator('[data-viewer="ready"]').waitFor({ timeout: 20000 });
    await audit(page, `${mode} /learn idle`, mode === "zoom200" ? 206 : 360);
    await page.screenshot({ path: info.outputPath(`${mode}-idle.png`), fullPage: true });
    await page.getByRole("group", { name: "Lesson" }).getByRole("button").click();
    await page.getByRole("group", { name: "Suggested replies" }).waitFor({ timeout: 20000 });
    await page.waitForTimeout(900); // any refit tween settles
    await audit(page, `${mode} /learn probe`, mode === "zoom200" ? 206 : 360);
    await page.screenshot({ path: info.outputPath(`${mode}-probe.png`), fullPage: true });
  });
}

// Landing, login and Home: simple pages, checked at both sizes on the phone project.
for (const mode of ["zoom200", "largeText"] as const) {
  test(`${mode}: public pages and Home`, async ({ page }, info) => {
    test.skip(info.project.name !== "phone");
    const w = mode === "zoom200" ? 206 : 360;
    await page.setViewportSize(mode === "zoom200" ? { width: 206, height: 420 } : { width: 360, height: 740 });
    if (mode === "largeText") await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => (document.documentElement.style.fontSize = "200%")));
    for (const path of ["/", "/login", "/home"]) {
      await page.goto(path);
      await audit(page, `${mode} ${path}`, w);
      await page.screenshot({ path: info.outputPath(`${mode}${path.replace(/\//g, "-") || "-root"}.png`), fullPage: true });
    }
  });
}
