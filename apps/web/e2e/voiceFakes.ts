import type { Page } from "@playwright/test";

// Test doubles for the browser's speech engines, installed before the page loads.
// They also count any use of getUserMedia / MediaRecorder: Aili must never record audio itself.

export interface FakeOptions {
  /** What SpeechRecognition.available() reports, or "none" = no recognition, "no-available-api" = old API. */
  recognition?: "available" | "downloadable" | "unavailable" | "no-available-api" | "none";
  transcript?: string;
  recError?: string;
  listenMs?: number;
  speakMs?: number;
  consent?: { choice: "voice" | "text"; mode: "on-device" | "online" };
}

export interface FakeLog {
  gum: number;
  mediaRecorder: number;
  spoken: string[];
  cancels: number;
  recStarts: Array<{ processLocally: boolean | undefined; lang: string }>;
}

export async function installVoiceFakes(page: Page, opts: FakeOptions = {}) {
  await page.addInitScript((o: FakeOptions) => {
    const log = { gum: 0, mediaRecorder: 0, spoken: [] as string[], cancels: 0, recStarts: [] as unknown[] };
    (window as unknown as { __aili: typeof log }).__aili = log;

    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia = () => {
        log.gum++;
        return Promise.reject(new Error("blocked in test"));
      };
    }
    (window as unknown as { MediaRecorder: unknown }).MediaRecorder = function () {
      log.mediaRecorder++;
      throw new Error("blocked in test");
    };

    if (o.consent) localStorage.setItem("aili.voice.consent", JSON.stringify({ ...o.consent, at: "test" }));

    const w = window as unknown as Record<string, unknown>;
    if (o.recognition === "none") {
      delete w.SpeechRecognition;
      delete w.webkitSpeechRecognition;
    } else {
      class FakeRecognition {
        lang = "";
        processLocally?: boolean;
        onresult: ((e: unknown) => void) | null = null;
        onerror: ((e: unknown) => void) | null = null;
        onend: (() => void) | null = null;
        private t?: ReturnType<typeof setTimeout>;
        static available?: () => Promise<string>;
        start() {
          log.recStarts.push({ processLocally: this.processLocally, lang: this.lang });
          this.t = setTimeout(() => {
            if (o.recError) this.onerror?.({ error: o.recError });
            else {
              const result = Object.assign([{ transcript: o.transcript ?? "what is a servo" }], { isFinal: true });
              this.onresult?.({ results: [result] });
            }
            this.onend?.();
          }, o.listenMs ?? 400);
        }
        stop() {
          clearTimeout(this.t);
          this.onend?.();
        }
        abort() {
          clearTimeout(this.t);
          this.onerror?.({ error: "aborted" });
          this.onend?.();
        }
      }
      if (o.recognition !== "no-available-api") {
        const answer = o.recognition ?? "downloadable";
        FakeRecognition.available = async () => answer;
      }
      w.SpeechRecognition = FakeRecognition;
      w.webkitSpeechRecognition = FakeRecognition;
    }

    let current: { onend: (() => void) | null } | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const synth = {
      speak(u: { text: string; onend: (() => void) | null }) {
        log.spoken.push(u.text);
        current = u;
        timer = setTimeout(() => u.onend?.(), o.speakMs ?? 300);
      },
      cancel() {
        log.cancels++;
        clearTimeout(timer);
        const u = current;
        current = null;
        u?.onend?.(); // like browsers, cancelling ends the utterance
      },
      getVoices: () => [],
      addEventListener() {},
      removeEventListener() {},
    };
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  }, opts);
}

export const fakeLog = (page: Page) => page.evaluate(() => (window as unknown as { __aili: FakeLog }).__aili);
