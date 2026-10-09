import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { fakeLog, installVoiceFakes } from "./voiceFakes";

// Voice states, consent, captions and interrupt (M1 slice 3). Browser speech engines are
// replaced by scripted fakes (voiceFakes.ts), so these tests never use a real microphone.

const status = (p: Page) => p.locator('p[role="status"][data-state]');
const voiceBtn = (p: Page) => p.locator('button[data-state]:visible');
const textbox = (p: Page) => p.getByRole("textbox", { name: "Ask Aili or answer" });
const caption = (p: Page) => p.locator("main").getByText(/prepared demo line|Live replies|stop me at any time|Demo caption/);
const dialog = (p: Page) => p.getByRole("dialog", { name: "Before you use voice" });

const REPLY = [
  "This is a prepared demo line, not a live answer.",
  "Live replies from Aili arrive in a later build.",
  "You can stop me at any time with the stop button or the Escape key.",
];

const ask = async (p: Page, q = "What is a servo?") => {
  await textbox(p).fill(q);
  await p.getByRole("button", { name: "Send" }).click();
};

const axe = async (p: Page) => {
  const r = await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`);
};

test.describe("voice states (demo controls)", () => {
  const STATES = [
    { state: "idle", label: "Ready", button: "Start voice input" },
    { state: "listening", label: "Listening", button: "Stop listening" },
    { state: "thinking", label: "Thinking", button: "Stop" },
    { state: "speaking", label: "Speaking", button: "Stop speaking" },
    { state: "error", label: "Voice error", button: "Voice error. Try again" },
  ] as const;

  test("demo controls are hidden from normal users", async ({ page }) => {
    await page.goto("/learn");
    await expect(page.getByText("Demo controls (testing only)")).toHaveCount(0);
  });

  test("each state has its own label, icon, shape and button name", async ({ page }) => {
    await installVoiceFakes(page);
    await page.goto("/learn?demo=1");
    await page.getByText("Demo controls (testing only)").click();
    const icons = new Set<string>();
    const shapes = new Set<string>();
    for (const s of STATES) {
      await page.getByRole("button", { name: `Show ${s.state}` }).click();
      await expect(status(page)).toHaveText(s.label);
      await expect(status(page)).toHaveAttribute("data-state", s.state);
      await expect(voiceBtn(page)).toHaveAttribute("data-state", s.state);
      await expect(voiceBtn(page)).toHaveAccessibleName(s.button);
      icons.add(await voiceBtn(page).locator("svg").innerHTML());
      shapes.add(
        await voiceBtn(page).evaluate((el) => {
          const c = getComputedStyle(el);
          return [c.outlineStyle, c.outlineWidth, c.borderRadius, c.borderTopWidth].join(" ");
        }),
      );
    }
    expect(icons.size).toBe(5);
    expect(shapes.size).toBe(5);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`screenshots and axe for every state, ${scheme}`, async ({ page }, info) => {
      await installVoiceFakes(page);
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/learn?demo=1");
      await expect(page.getByText("Demo controls (testing only)")).toBeVisible(); // hydrated
      for (const s of STATES) {
        await page.evaluate(() => (document.querySelector("details") as HTMLDetailsElement).open = true);
        await page.getByRole("button", { name: `Show ${s.state}` }).click();
        await page.evaluate(() => (document.querySelector("details") as HTMLDetailsElement).open = false);
        await page.mouse.move(0, 0);
        await page.waitForTimeout(350);
        await page.screenshot({ path: info.outputPath(`voice-${s.state}-${scheme}.png`) });
        expect(await axe(page), s.state).toEqual([]);
      }
    });
  }
});

test.describe("prepared reply, captions and interrupt", () => {
  // Interrupt tests use slow fake speech so a segment is still playing when they stop it.
  test.beforeEach(async ({ page }, info) => {
    const slow = /interrupt|Escape|replaces|toggle/.test(info.title);
    await installVoiceFakes(page, { speakMs: slow ? 4000 : 1500 });
    await page.goto("/learn");
  });

  test("typing a question → thinking → speaking with captions in order → ready", async ({ page }) => {
    await expect(status(page)).toHaveText("Ready");
    await ask(page);
    await expect(status(page)).toHaveText("Thinking");
    for (const line of REPLY) await expect(page.getByText(line)).toBeVisible();
    await expect(status(page)).toHaveText("Ready");
    const captionBox = page.locator("main").getByText(REPLY[2]!).locator("..");
    await expect(captionBox.getByText("Prepared", { exact: true })).toBeVisible();
    expect((await fakeLog(page)).spoken).toEqual(REPLY);
  });

  test("interrupt: the voice button stops speech and drops queued captions immediately", async ({ page }) => {
    await ask(page);
    await expect(page.getByText(REPLY[0]!)).toBeVisible();
    await expect(voiceBtn(page)).toHaveAccessibleName("Stop speaking");
    await voiceBtn(page).click();
    await expect(status(page)).toHaveText("Stopped");
    await expect(caption(page)).toHaveCount(0);
    const after = await fakeLog(page);
    expect(after.cancels).toBeGreaterThan(0);
    await page.waitForTimeout(1500); // queued segments would have arrived by now
    await expect(caption(page)).toHaveCount(0);
    expect((await fakeLog(page)).spoken).toEqual(after.spoken);
  });

  test("Escape interrupts while Aili is speaking", async ({ page }) => {
    await ask(page);
    await expect(page.getByText(REPLY[0]!)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(status(page)).toHaveText("Stopped");
    await expect(caption(page)).toHaveCount(0);
  });

  test("a new question while speaking replaces the old reply (no stale segments)", async ({ page }) => {
    await ask(page, "first");
    await expect(page.getByText(REPLY[0]!)).toBeVisible();
    await ask(page, "second");
    await expect(status(page)).toHaveText("Thinking");
    await expect(caption(page)).toHaveCount(0);
    await expect(status(page)).toHaveText("Ready", { timeout: 15000 });
    expect((await fakeLog(page)).spoken.slice(-3)).toEqual(REPLY);
  });

  test("mute silences Aili's voice; captions keep running", async ({ page }) => {
    const mute = page.getByRole("button", { name: "Mute" });
    await expect(mute).toHaveAttribute("aria-pressed", "false");
    await mute.click();
    await expect(mute).toHaveAttribute("aria-pressed", "true");
    await ask(page);
    await expect(page.getByText(REPLY[0]!)).toBeVisible();
    await expect(page.getByText(REPLY[1]!)).toBeVisible({ timeout: 8000 });
    expect((await fakeLog(page)).spoken).toEqual([]);
    await expect(page.getByText(REPLY[1]!)).toHaveAttribute("aria-live", "polite");
  });

  test("captions toggle hides captions while Aili keeps speaking", async ({ page }) => {
    await page.getByRole("button", { name: "Captions" }).click();
    await ask(page);
    await expect(status(page)).toHaveText("Speaking");
    await expect(caption(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Captions" }).click();
    await expect(caption(page)).toHaveCount(1);
  });
});

test.describe("consent before the microphone", () => {
  test("Version B when on-device recognition isn't confirmed; Type instead keeps the mic off", async ({ page }) => {
    await installVoiceFakes(page, { recognition: "downloadable" });
    await page.goto("/learn");
    await voiceBtn(page).click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toContainText(
      "Your browser turns your speech into text using an online speech service. Your voice recording is sent to that service, which is run by your browser's maker or its speech provider, not by Aili. Their privacy terms apply.",
    );
    await expect(dialog(page)).toContainText("Aili receives only the text, the same as if you had typed it. Aili never receives or stores your audio.");
    await expect(dialog(page)).toContainText("You can type instead at any time.");
    await expect(dialog(page)).toContainText("You can change this anytime in Settings.");
    await expect(dialog(page)).not.toContainText("Google");
    await expect(dialog(page).getByRole("button", { name: "Type instead" })).toBeFocused();
    expect(await axe(page)).toEqual([]);

    await dialog(page).getByRole("button", { name: "Type instead" }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(textbox(page)).toBeFocused();
    expect((await fakeLog(page)).recStarts).toEqual([]);
  });

  test("Version A only when the language pack is confirmed; listens on-device", async ({ page }) => {
    await installVoiceFakes(page, { recognition: "available", listenMs: 800 });
    await page.goto("/learn");
    await voiceBtn(page).click();
    await expect(dialog(page)).toContainText(
      "Your device can turn your speech into text by itself, so your voice recording stays on this device.",
    );
    await expect(dialog(page)).not.toContainText("online speech service");
    await dialog(page).getByRole("button", { name: "Use voice" }).click();
    await expect(status(page)).toHaveText("Listening (on this device)");
    await expect(textbox(page)).toHaveValue("what is a servo");
    await expect(page.getByText("Heard you. Check the text box, then press Send.")).toBeVisible();
    await expect(status(page)).toHaveText("Ready");
    expect((await fakeLog(page)).recStarts[0]?.processLocally).toBe(true);
  });

  test("a browser without the availability check uses online mode (Version B)", async ({ page }) => {
    await installVoiceFakes(page, { recognition: "no-available-api", listenMs: 800 });
    await page.goto("/learn");
    await voiceBtn(page).click();
    await expect(dialog(page)).toContainText("online speech service");
    await dialog(page).getByRole("button", { name: "Use voice" }).click();
    await expect(status(page)).toHaveText("Listening (online speech service)");
    expect((await fakeLog(page)).recStarts[0]?.processLocally).toBe(false);
  });

  test("a saved yes skips the notice, but on-device consent does not cover online", async ({ page }) => {
    await installVoiceFakes(page, { recognition: "downloadable", consent: { choice: "voice", mode: "on-device" } });
    await page.goto("/learn");
    await voiceBtn(page).click();
    await expect(dialog(page)).toContainText("online speech service");
  });

  test("with a saved yes for this mode, the mic starts straight away", async ({ page }) => {
    await installVoiceFakes(page, { recognition: "downloadable", listenMs: 800, consent: { choice: "voice", mode: "online" } });
    await page.goto("/learn");
    await voiceBtn(page).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(status(page)).toHaveText("Listening (online speech service)");
  });

  test("Escape closes the notice without saving and returns focus to the voice button", async ({ page }) => {
    await installVoiceFakes(page);
    await page.goto("/learn");
    await voiceBtn(page).focus();
    await page.keyboard.press("Enter");
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await expect(voiceBtn(page)).toBeFocused();
    expect(await page.evaluate(() => localStorage.getItem("aili.voice.consent"))).toBeNull();
  });
});

test.describe("fallbacks, errors and keyboard", () => {
  test("no speech recognition: says so plainly and moves to the text box", async ({ page }) => {
    await installVoiceFakes(page, { recognition: "none" });
    await page.goto("/learn");
    await voiceBtn(page).click();
    await expect(page.getByText("Voice input isn't available in this browser. Type your question in the box below.")).toBeVisible();
    await expect(textbox(page)).toBeFocused();
    await expect(dialog(page)).toHaveCount(0);
  });

  test("a refused microphone shows the error state with a plain message; pressing again retries", async ({ page }) => {
    await installVoiceFakes(page, { recError: "not-allowed", consent: { choice: "voice", mode: "online" } });
    await page.goto("/learn");
    await voiceBtn(page).click();
    await expect(status(page)).toHaveText("Voice error");
    await expect(page.locator("main").getByRole("alert")).toHaveText(
      "Microphone permission was refused. You can type instead, or allow the microphone in your browser settings.",
    );
    await expect(voiceBtn(page)).toHaveAccessibleName("Voice error. Try again");
    await voiceBtn(page).click();
    await expect(status(page)).toHaveText(/Listening|Voice error/);
    expect((await fakeLog(page)).recStarts.length).toBe(2);
  });

  test("Space starts voice when focus is on the page, never while typing", async ({ page }) => {
    await installVoiceFakes(page, { listenMs: 800, consent: { choice: "voice", mode: "online" } });
    await page.goto("/learn");
    await textbox(page).click();
    await page.keyboard.type("a b c");
    await expect(textbox(page)).toHaveValue("a b c");
    await expect(status(page)).toHaveText("Ready");

    const captions = page.getByRole("button", { name: "Captions" });
    await captions.focus();
    await page.keyboard.press("Space");
    await expect(captions).toHaveAttribute("aria-pressed", "false"); // Space pressed the focused button only
    await expect(status(page)).toHaveText("Ready");

    await page.locator("main").focus();
    await page.keyboard.press("Space");
    await expect(status(page)).toHaveText(/Listening/);
  });

  test("the page never records audio itself (no getUserMedia, no MediaRecorder)", async ({ page }) => {
    await installVoiceFakes(page, { recognition: "available", listenMs: 500 });
    await page.goto("/learn");
    await voiceBtn(page).click();
    await dialog(page).getByRole("button", { name: "Use voice" }).click();
    await expect(textbox(page)).toHaveValue("what is a servo");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(REPLY[0]!)).toBeVisible();
    await voiceBtn(page).click();
    const log = await fakeLog(page);
    expect(log.gum).toBe(0);
    expect(log.mediaRecorder).toBe(0);
  });

  test("leaving the page stops Aili speaking", async ({ page }) => {
    await installVoiceFakes(page, { speakMs: 5000 });
    await page.goto("/learn");
    await ask(page);
    await expect(page.getByText(REPLY[0]!)).toBeVisible();
    const before = (await fakeLog(page)).cancels;
    await page.getByRole("link", { name: "AILI home" }).click();
    await expect(page).toHaveURL(/\/home$/);
    await expect.poll(async () => (await fakeLog(page)).cancels).toBeGreaterThan(before);
  });
});

test.describe("settings", () => {
  test("the menu opens Settings; the voice choice can be changed and forgotten", async ({ page }) => {
    await installVoiceFakes(page, { consent: { choice: "voice", mode: "online" } });
    await page.goto("/learn");
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/settings$/);
    const choice = page.getByTestId("voice-choice");
    await expect(choice).toHaveText("Voice on, using your browser's online speech service.");
    await page.getByRole("button", { name: "Use typing only" }).click();
    await expect(choice).toHaveText("Typing only. Aili will ask again if you press the microphone.");
    await page.getByRole("button", { name: "Ask me again next time" }).click();
    await expect(choice).toHaveText("Not chosen yet. Aili will ask the first time you press the microphone.");
    expect(await axe(page)).toEqual([]);
  });

  test("mute in Settings and on the stage are the same setting", async ({ page }) => {
    await installVoiceFakes(page);
    await page.goto("/settings");
    await page.getByRole("checkbox", { name: /Mute Aili's voice/ }).check();
    await page.goto("/learn");
    await expect(page.getByRole("button", { name: "Mute" })).toHaveAttribute("aria-pressed", "true");
  });
});
