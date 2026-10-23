import { expect, test } from "@playwright/test";

// Landing (/), the placeholder /login, and Home/Resume. Honesty: nothing unbuilt is promised,
// no form collects anything, unbuilt things say "Coming".
const STATUS = "Early beta. Lessons are prepared demos; the live professor is not connected yet.";

test.describe("landing", () => {
  test("landmarks, one h1, the status block and the two buttons", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByText(STATUS, { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Try the demo lesson" })).toHaveAttribute("href", "/learn");
    // Log in: once in the top bar, once on the page.
    await expect(page.getByRole("banner").getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
    await expect(page.getByRole("main").getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
    await expect(page.getByText("Beta by invitation. Waitlist coming.")).toBeVisible();
    // Drafts are shown in this build, so the review note must not appear.
    await expect(page.getByText("The demo lesson is waiting for expert review.")).toHaveCount(0);
  });

  test("the primary button uses the action colours", async ({ page }) => {
    await page.goto("/");
    const btn = page.getByRole("link", { name: "Try the demo lesson" });
    const [bg, fg] = await btn.evaluate((e) => {
      const s = getComputedStyle(e);
      return [s.backgroundColor, s.color];
    });
    const tokens = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      const probe = document.createElement("i");
      document.body.append(probe);
      probe.style.color = s.getPropertyValue("--aili-action-bg");
      const bg = getComputedStyle(probe).color;
      probe.style.color = s.getPropertyValue("--aili-action-text");
      const fg = getComputedStyle(probe).color;
      probe.remove();
      return [bg, fg];
    });
    expect([bg, fg]).toEqual(tokens);
  });

  test("robotics first; other subjects only as 'More subjects later' + Coming", async ({ page }) => {
    await page.goto("/");
    const robotics = page.getByRole("region", { name: "Starting with robotics" });
    await expect(robotics).toContainText("Robotics is the first subject.");
    await expect(robotics.getByText(/More subjects later/)).toContainText("Coming");
  });

  test("how it works: four steps with icon + name; only Build says Coming", async ({ page }) => {
    await page.goto("/");
    const steps = page.getByRole("region", { name: "How it works" }).getByRole("listitem");
    await expect(steps).toHaveCount(4);
    const names = ["Understand", "See it", "Try it", "Build"];
    for (let i = 0; i < 4; i++) {
      const step = steps.nth(i);
      await expect(step).toContainText(names[i]!);
      await expect(step.locator("svg")).toHaveCount(1);
      if (names[i] === "Build") await expect(step).toContainText("Coming");
      else await expect(step).not.toContainText("Coming");
    }
  });

  test("buttons go where they say", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("main").getByRole("link", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.getByRole("link", { name: "AILI" }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.getByRole("link", { name: "Try the demo lesson" }).click();
    await expect(page).toHaveURL(/\/learn$/);
  });

  test("keyboard: skip link, logo, Log in, then the page; Enter follows the primary button", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "AILI" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("banner").getByRole("link", { name: "Log in" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Try the demo lesson" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/learn$/);
  });
});

test.describe("login placeholder", () => {
  test("says plainly sign-in isn't open, offers the demo, and has no form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1, name: "Log in" })).toBeVisible();
    await expect(page.getByText("Sign-in opens with the beta. For now, you can try the demo lesson without an account.", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Try the demo lesson" })).toHaveAttribute("href", "/learn");
    await expect(page.locator("form, input, textarea, select, [contenteditable]")).toHaveCount(0);
  });
});

test.describe("public pages", () => {
  for (const path of ["/", "/login"]) {
    test(`${path}: no form fields, no waitlist form, 44 px targets`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("form, input, textarea, select")).toHaveCount(0);
      const targets = page.locator("header a, main a");
      expect(await targets.count()).toBeGreaterThan(0);
      for (const t of await targets.all()) {
        const box = (await t.boundingBox())!;
        expect(box.height, await t.innerText()).toBeGreaterThanOrEqual(44);
        expect(box.width, await t.innerText()).toBeGreaterThanOrEqual(44);
      }
    });
  }

  test("the word 'investigation' appears on no page", async ({ page }) => {
    for (const path of ["/", "/login", "/home", "/learn", "/settings"]) {
      await page.goto(path);
      expect((await page.locator("body").innerText()).toLowerCase(), path).not.toContain("investigation");
    }
  });
});

test.describe("home / resume", () => {
  test("first visit: Start the demo lesson; new goal says Coming", async ({ page }) => {
    await page.goto("/home");
    await expect(page.getByText(STATUS, { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Start here" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Start the demo lesson" })).toHaveAttribute("href", "/learn");
    await expect(page.getByRole("heading", { name: /Start a new goal/ })).toContainText("Coming");
    await expect(page.getByRole("region", { name: /Start a new goal/ }).getByRole("link")).toHaveCount(0);
  });

  test("after opening the Learn stage: Pick up where you left off, said honestly", async ({ page }) => {
    await page.goto("/learn");
    // The visit is recorded once the stage's scripts have run.
    await expect.poll(() => page.evaluate(() => localStorage.getItem("aili.learn.visited"))).toBe("1");
    await page.getByRole("link", { name: "AILI home" }).click();
    await expect(page.getByRole("heading", { name: "Pick up where you left off" })).toBeVisible();
    await expect(page.getByText("The demo lesson starts again from the beginning: answers aren't kept between visits yet.")).toBeVisible();
    await page.getByRole("link", { name: "Back to the Learn stage" }).click();
    await expect(page).toHaveURL(/\/learn$/);
  });

  test("blocked storage: Home still works, as a first visit", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", { get: () => { throw new Error("blocked"); } });
    });
    await page.goto("/learn");
    await page.goto("/home");
    await expect(page.getByRole("link", { name: "Start the demo lesson" })).toBeVisible();
  });
});

test("screenshots", async ({ page }, info) => {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const path of ["/", "/login", "/home"]) {
      await page.goto(path);
      await page.screenshot({ path: info.outputPath(`${path === "/" ? "landing" : path.slice(1)}-${scheme}.png`), fullPage: true });
    }
  }
});
