// Voice providers are configuration, never hard-coded (CLAUDE.md). Set at build time:
//   NEXT_PUBLIC_AILI_SPEECH_INPUT  = "browser" (Web Speech recognition) | "none" (typing only)
//   NEXT_PUBLIC_AILI_SPEECH_OUTPUT = "browser" (speechSynthesis)        | "none" (captions only)
export type SpeechInputProvider = "browser" | "none";
export type SpeechOutputProvider = "browser" | "none";

export const SPEECH_INPUT: SpeechInputProvider = process.env.NEXT_PUBLIC_AILI_SPEECH_INPUT === "none" ? "none" : "browser";
export const SPEECH_OUTPUT: SpeechOutputProvider = process.env.NEXT_PUBLIC_AILI_SPEECH_OUTPUT === "none" ? "none" : "browser";
