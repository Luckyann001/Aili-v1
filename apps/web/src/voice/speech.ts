import { SPEECH_OUTPUT } from "./config";

// Aili's spoken voice through the browser's speechSynthesis. Captions never depend on it:
// each segment also has a timer, so captions advance when muted, when synthesis is missing,
// or when a browser never fires `end`.

const MS_PER_WORD = 380;
export const estimateMs = (text: string) => Math.max(1500, text.split(/\s+/).length * MS_PER_WORD);

export const isSpeechOutputSupported = () =>
  SPEECH_OUTPUT === "browser" && typeof window !== "undefined" && "speechSynthesis" in window;

/** Speaks one segment (unless muted) and calls onDone once, on `end`, `error` or timeout. */
export function speakSegment(text: string, opts: { muted: boolean; lang: string; onDone: () => void }): () => void {
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    opts.onDone();
  };
  const speaking = !opts.muted && isSpeechOutputSupported();
  const timer = setTimeout(finish, estimateMs(text) + (speaking ? 2000 : 0));
  if (speaking) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = opts.lang;
    u.onend = finish;
    u.onerror = finish;
    window.speechSynthesis.speak(u);
  }
  return () => {
    finished = true;
    clearTimeout(timer);
  };
}

export function cancelSpeech(): void {
  if (isSpeechOutputSupported()) window.speechSynthesis.cancel();
}
