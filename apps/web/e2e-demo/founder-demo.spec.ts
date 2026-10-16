import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { installVoiceFakes } from "../e2e/voiceFakes";

// The founder demo mode's labels on the live PATH, answered by the RECORDED provider in a test build
// (playwright.demo.config.ts): no model, no key, no spend. The recording is not presented as live;
// this checks what the page labels and shows. The expected wording follows the review records: the
// asset has a founder record; the servo scene gets one only when Lucky adds it after looking.
const fx = (f: string) => JSON.parse(readFileSync(new URL(`../../../content/robotics/test-fixtures/${f}`, import.meta.url), "utf8"));
const reviewed = fx("scene.fx-servo-arm.json").review?.role === "founder" && fx("asset.fx-servo-generic-anatomy.json").review?.role === "founder";
const STAGE = reviewed ? "Prepared · reviewed by the founder, not an expert reviewer" : "Prepared · not reviewed";
const LIVE = reviewed ? "Live AI · Founder-reviewed demo content" : "Live AI · Demo content, not reviewed";
const NOTE = reviewed ? "Narration is live AI; the lesson content is prepared and founder-reviewed, not expert-reviewed" : "Narration is live AI; the lesson content is prepared and not reviewed yet";

const welcomeBox = (p: Page) => p.getByRole("textbox", { name: "What do you want to learn?" });
const bottomBox = (p: Page) => p.getByRole("textbox", { name: "Ask Aili or answer" });
const caption = (p: Page) => p.locator("main [aria-live]").last();

test.beforeEach(async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: "aili-e2e-live", value: "1", url: baseURL! }]);
});

test("founder demo mode, recorded path: the fixture servo scene shows without the drafts flag, labelled from its own manifests", async ({ page }) => {
  test.setTimeout(120_000);
  await installVoiceFakes(page, { speakMs: 1200 });
  await page.goto("/learn");
  await expect(page.locator("[data-content-mode]")).toHaveAttribute("data-content-mode", "founder-demo");
  await expect(welcomeBox(page)).toBeVisible({ timeout: 20_000 });
  // The live note: live versus prepared, true to the records.
  await expect(page.getByText(NOTE)).toBeVisible();
  await welcomeBox(page).fill("teach me robotics");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(caption(page)).toHaveText(/^If the weight slides farther/, { timeout: 40_000 });
  await bottomBox(page).fill("It gets harder");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(caption(page)).toHaveText(/^Yes, farther out is harder/, { timeout: 30_000 });
  await bottomBox(page).fill("show me a real servo");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(caption(page)).toHaveText(/^Now the same idea on a robot joint/, { timeout: 30_000 });
  // The real servo-arm scene is a draft and the drafts flag is off, yet the fixture scene shows.
  await expect(page.getByText("No expert-reviewed scene is available yet.")).toHaveCount(0);
  await expect(page.locator("[data-viewer]")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: STAGE })).toBeVisible();
  await expect(page.locator('[data-badge="live"]')).toContainText(LIVE);
  await expect(page.locator("main").getByText(LIVE.replace("Live AI · ", "")).first()).toBeVisible(); // beside "Live AI" on the caption
  // Never the draft label, the test-fixture wording, or a founder claim the records do not make.
  await expect(page.getByText(/Draft \(not expert-reviewed\)/)).toHaveCount(0);
  await expect(page.getByText("Test fixture content")).toHaveCount(0);
  if (!reviewed) await expect(page.getByText(/reviewed by the founder/)).toHaveCount(0);
});
