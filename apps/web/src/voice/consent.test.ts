import { describe, expect, it } from "vitest";
import { consentCovers, parseConsent } from "./consent";

describe("voice consent", () => {
  it("parses only well-formed saved choices", () => {
    expect(parseConsent(null)).toBeNull();
    expect(parseConsent("not json")).toBeNull();
    expect(parseConsent(JSON.stringify({ choice: "voice", mode: "cloud", at: "x" }))).toBeNull();
    expect(parseConsent(JSON.stringify({ choice: "voice", mode: "online", at: "2026-10-09" }))).toEqual({
      choice: "voice",
      mode: "online",
      at: "2026-10-09",
    });
  });

  it("consent for on-device recognition does not cover online recognition", () => {
    const onDevice = { choice: "voice", mode: "on-device", at: "t" } as const;
    expect(consentCovers(onDevice, "on-device")).toBe(true);
    expect(consentCovers(onDevice, "online")).toBe(false);
  });

  it("choosing to type never counts as consent to use the microphone", () => {
    expect(consentCovers({ choice: "text", mode: "online", at: "t" }, "online")).toBe(false);
    expect(consentCovers(null, "online")).toBe(false);
  });
});
