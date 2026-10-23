import { useSyncExternalStore } from "react";
import { readLocal, subscribeLocal, writeLocal } from "./localValue";
import type { RecognitionMode } from "./recognition";

// The learner's voice choice, stored on this device only. Nothing is sent to Aili's server.
// Consent is tied to the recognition mode it was given for: consent for on-device recognition
// does not cover online recognition, so a change to "online" asks again.

export interface VoiceConsent {
  choice: "voice" | "text";
  mode: RecognitionMode;
  at: string;
}

const KEY = "aili.voice.consent";

export function parseConsent(raw: string | null): VoiceConsent | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<VoiceConsent>;
    if ((v.choice === "voice" || v.choice === "text") && (v.mode === "on-device" || v.mode === "online") && typeof v.at === "string") {
      return { choice: v.choice, mode: v.mode, at: v.at };
    }
  } catch {
    // fall through
  }
  return null;
}

/** Voice may start without asking only if the learner said yes for this exact mode. */
export function consentCovers(consent: VoiceConsent | null, mode: RecognitionMode): boolean {
  return consent?.choice === "voice" && consent.mode === mode;
}

export const getConsent = () => parseConsent(readLocal(KEY));
export const saveConsent = (choice: VoiceConsent["choice"], mode: RecognitionMode) =>
  writeLocal(KEY, JSON.stringify({ choice, mode, at: new Date().toISOString() } satisfies VoiceConsent));
export const forgetConsent = () => writeLocal(KEY, null);

export function useConsent(): VoiceConsent | null {
  const raw = useSyncExternalStore(
    (l) => subscribeLocal(KEY, l),
    () => readLocal(KEY),
    () => null,
  );
  return parseConsent(raw);
}

const MUTE_KEY = "aili.voice.muted";
export const setMuted = (muted: boolean) => writeLocal(MUTE_KEY, muted ? "1" : null);
export const getMuted = () => readLocal(MUTE_KEY) === "1";
export function useMuted(): boolean {
  return useSyncExternalStore(
    (l) => subscribeLocal(MUTE_KEY, l),
    getMuted,
    () => false,
  );
}
