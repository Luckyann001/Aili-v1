import { SPEECH_INPUT } from "./config";

// Browser speech recognition (Web Speech API). Aili receives only the text the browser returns;
// this module never touches the microphone stream itself (no getUserMedia, no MediaRecorder).
//
// Where audio goes (MDN): by default some browsers, like Chrome, send it to an online service.
// `processLocally = true` requires on-device recognition; it needs the language pack installed.

export type RecognitionMode = "on-device" | "online";

interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResultEvent {
  results: ArrayLike<ArrayLike<RecognitionAlternative> & { isFinal: boolean }>;
}
interface RecognitionErrorEvent {
  error: string;
}
interface BrowserRecognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  processLocally?: boolean;
  onresult: ((e: RecognitionResultEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
interface RecognitionCtor {
  new (): BrowserRecognition;
  available?: (opts: { langs: string[]; processLocally: boolean }) => Promise<string>;
}

function ctor(): RecognitionCtor | null {
  if (SPEECH_INPUT === "none" || typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const isRecognitionSupported = () => ctor() !== null;

export const recognitionLang = () => (typeof navigator !== "undefined" && navigator.language) || "en-US";

/**
 * On-device only when the browser confirms the language pack is installed ("available").
 * "downloadable", "downloading", "unavailable", a missing available() or any error → online.
 * Never starts a language-pack download.
 */
export async function detectRecognitionMode(lang = recognitionLang()): Promise<RecognitionMode> {
  const C = ctor();
  if (!C?.available) return "online";
  try {
    return (await C.available({ langs: [lang], processLocally: true })) === "available" ? "on-device" : "online";
  } catch {
    return "online";
  }
}

const ERROR_TEXT: Record<string, string> = {
  "not-allowed": "Microphone permission was refused. You can type instead, or allow the microphone in your browser settings.",
  "service-not-allowed": "This browser won't allow speech recognition here. Please type instead.",
  "audio-capture": "No microphone was found. Please type instead.",
  network: "The speech service couldn't be reached. Try again, or type instead.",
  "no-speech": "I didn't hear anything. Tap the microphone to try again.",
  "language-not-supported": "Speech recognition isn't available for your language here. Please type instead.",
};

export const recognitionErrorText = (code: string) =>
  ERROR_TEXT[code] ?? "Voice input stopped unexpectedly. Try again, or type instead.";

export interface RecognitionHandle {
  stop(): void;
  abort(): void;
}

export function startRecognition(opts: {
  mode: RecognitionMode;
  lang?: string;
  onFinal: (text: string) => void;
  onError: (code: string) => void;
  onEnd: () => void;
}): RecognitionHandle | null {
  const C = ctor();
  if (!C) return null;
  const r = new C();
  r.lang = opts.lang ?? recognitionLang();
  r.interimResults = false;
  r.continuous = false;
  r.processLocally = opts.mode === "on-device";
  r.onresult = (e) => {
    const last = e.results[e.results.length - 1];
    if (last?.isFinal && last[0]) opts.onFinal(last[0].transcript.trim());
  };
  r.onerror = (e) => opts.onError(e.error);
  r.onend = () => opts.onEnd();
  r.start();
  return { stop: () => r.stop(), abort: () => r.abort() };
}
