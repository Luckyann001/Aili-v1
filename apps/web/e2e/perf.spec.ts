import { expect, test, type Page } from "@playwright/test";

// Performance under EMULATION (headless Chrome on the laptop), not a real phone:
// CPU slowed 6x; network "Slow 4G" as used by Lighthouse's DevTools throttling
// (562.5 ms latency, 1.47 Mbps down, 0.675 Mbps up). Run with AILI_PERF=1 npm run test:e2e -- perf.
test.skip(process.env.AILI_PERF !== "1", "manual performance run (AILI_PERF=1)");

async function throttle(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 562.5,
    downloadThroughput: (1474.56 * 1024) / 8,
    uploadThroughput: (675 * 1024) / 8,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  return cdp;
}

test("load, 3D and orbit timings (emulated low-end phone)", async ({ page }, info) => {
  test.skip(info.project.name !== "phone");
  test.setTimeout(240_000);
  await throttle(page);
  const t0 = Date.now();
  await page.goto("/learn", { waitUntil: "commit" });
  // First picture: the still drawing shown while the 3D code loads.
  await expect(page.locator('[data-fallback="loading"]').or(page.locator('[data-viewer="ready"]'))).toBeVisible({ timeout: 120_000 });
  const picture = Date.now() - t0;
  // First usable: the page responds to input (the Menu opens), i.e. it has hydrated.
  const menu = page.getByRole("button", { name: "Menu" });
  await expect(async () => {
    await menu.click({ timeout: 2000 });
    await expect(menu).toHaveAttribute("aria-expanded", "true", { timeout: 500 });
  }).toPass({ timeout: 120_000, intervals: [250] });
  const usable = Date.now() - t0;
  await page.mouse.click(5, 300); // close the menu
  const fcp = await page.evaluate(() => performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? -1);
  await expect(page.locator('[data-viewer="ready"]')).toBeVisible({ timeout: 180_000 });
  const scene = Date.now() - t0;

  // Frame times while orbiting: record every animation frame during a 2 s one-finger drag.
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[] };
    w.__frames = [];
    let last = performance.now();
    const tick = (t: number) => {
      w.__frames.push(t - last);
      last = t;
      if (w.__frames.length < 2000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const c = (await page.locator("[data-viewer] canvas").boundingBox())!;
  const x = c.x + c.width / 2;
  const y = c.y + c.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 0; i < 40; i++) await page.mouse.move(x + Math.sin(i / 5) * 80, y + Math.cos(i / 7) * 30);
  await page.mouse.up();
  const frames = (await page.evaluate(() => (window as unknown as { __frames: number[] }).__frames)).slice(2).sort((a, b) => a - b);
  const pct = (p: number) => frames[Math.min(frames.length - 1, Math.floor(p * frames.length))]!.toFixed(1);
  console.log(
    `EMULATION (6x CPU, Slow 4G, Pixel 7 viewport): first contentful paint ${Math.round(fcp)} ms; ` +
      `still picture shown ${picture} ms; first usable (hydrated) ${usable} ms; 3D scene ready ${scene} ms; ` +
      `orbit frames: ${frames.length}, median ${pct(0.5)} ms, p95 ${pct(0.95)} ms, worst ${frames[frames.length - 1]!.toFixed(1)} ms`,
  );
});

test("JavaScript per route (gzip, as served)", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  test.setTimeout(120_000);
  const rows: string[] = [];
  for (const route of ["/", "/home", "/learn", "/settings", "/preview"]) {
    const sizes = new Map<string, number>();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.clearBrowserCache");
    const urls = new Map<string, string>();
    cdp.on("Network.responseReceived", (e) => urls.set(e.requestId, e.response.url));
    cdp.on("Network.loadingFinished", (e) => {
      const url = urls.get(e.requestId) ?? "";
      if (/\.js(\?|$)/.test(url)) sizes.set(url, e.encodedDataLength);
    });
    await page.goto(route, { waitUntil: "load" });
    const first = [...sizes.values()].reduce((a, b) => a + b, 0);
    if (route === "/learn") await expect(page.locator('[data-viewer="ready"]')).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(1500);
    const total = [...sizes.values()].reduce((a, b) => a + b, 0);
    rows.push(`${route}: first load ${(first / 1024).toFixed(1)} KB${first > 300 * 1024 ? "  <-- OVER 300 KB" : ""}; with lazy chunks ${(total / 1024).toFixed(1)} KB`);
    await cdp.detach();
  }
  console.log("JS (gzip as served):\n  " + rows.join("\n  "));
});
