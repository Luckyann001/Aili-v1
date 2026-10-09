"use client";

import { useCallback, useEffect, useRef } from "react";
import { consentCovers, getConsent, getMuted } from "./consent";
import { isBusy } from "./machine";
import {
  detectRecognitionMode,
  isRecognitionSupported,
  recognitionErrorText,
  recognitionLang,
  startRecognition,
  type RecognitionHandle,
  type RecognitionMode,
} from "./recognition";
import { PREPARED_REPLY, THINKING_MS } from "./script";
import { cancelSpeech, speakSegment } from "./speech";
import { useVoice } from "./store";

export const UNSUPPORTED_TEXT = "Voice input isn't available in this browser. Type your question in the box below.";

/**
 * Coordinates listening, the prepared reply, captions and interrupt. Every timer and callback
 * carries the revision it started under; the reducer drops anything stale, and the callbacks
 * here also stop scheduling further work once their revision is out of date.
 */
export function useVoiceController(opts: {
  onTranscript: (text: string) => void;
  onUnsupported: () => void;
  askConsent: (mode: RecognitionMode) => void;
}) {
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const cancelSegment = useRef<(() => void) | null>(null);
  const recognition = useRef<RecognitionHandle | null>(null);
  const { onTranscript, onUnsupported, askConsent } = opts;

  // Callers bump the revision *before* calling this, so any callback fired synchronously by
  // abort()/cancel() is already stale. Detach our own handlers before cancelling the browser's.
  const stopEverything = useCallback(() => {
    cancelSegment.current?.();
    cancelSegment.current = null;
    timers.current.forEach(clearTimeout);
    timers.current.clear();
    const r = recognition.current;
    recognition.current = null;
    r?.abort();
    cancelSpeech();
  }, []);

  const later = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, ms);
    timers.current.add(t);
  }, []);

  const interrupt = useCallback(() => {
    useVoice.getState().dispatch({ type: "interrupt" });
    stopEverything();
  }, [stopEverything]);

  const playReply = useCallback((rev: number) => {
    const lang = recognitionLang();
    const step = (seq: number) => {
      const s = useVoice.getState();
      if (s.rev !== rev) return; // interrupted or superseded: stop scheduling
      if (seq >= PREPARED_REPLY.length) {
        s.dispatch({ type: "done", rev });
        return;
      }
      s.dispatch({ type: "speak", rev, seq, text: PREPARED_REPLY[seq]! });
      cancelSegment.current = speakSegment(PREPARED_REPLY[seq]!, { muted: getMuted(), lang, onDone: () => step(seq + 1) });
    };
    step(0);
  }, []);

  const submit = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      const s = useVoice.getState();
      s.setHint(null);
      s.dispatch({ type: "submit" });
      stopEverything();
      const rev = useVoice.getState().rev;
      later(() => playReply(rev), THINKING_MS);
    },
    [later, playReply, stopEverything],
  );

  const startListening = useCallback(
    (mode: RecognitionMode) => {
      const s = useVoice.getState();
      s.setMode(mode);
      s.setHint(null);
      s.dispatch({ type: "listen" });
      stopEverything();
      const rev = useVoice.getState().rev;
      const current = () => useVoice.getState().rev === rev;
      recognition.current = startRecognition({
        mode,
        onFinal: (text) => {
          if (!current() || !text) return;
          useVoice.getState().setHint({ text: "Heard you. Check the text box, then press Send.", kind: "info" });
          onTranscript(text);
        },
        onError: (code) => {
          if (!current() || code === "aborted") return;
          useVoice.getState().dispatch({ type: "error", rev, message: recognitionErrorText(code) });
        },
        onEnd: () => {
          if (current()) recognition.current = null;
          useVoice.getState().dispatch({ type: "listenEnd", rev });
        },
      });
    },
    [onTranscript, stopEverything],
  );

  /** The voice button / Space: start (asking consent if needed), or stop when busy. */
  const press = useCallback(async () => {
    const s = useVoice.getState();
    if (isBusy(s.status)) {
      interrupt();
      return;
    }
    if (s.status === "error") s.dispatch({ type: "reset" });
    if (!isRecognitionSupported()) {
      s.setHint({ text: UNSUPPORTED_TEXT, kind: "info" });
      onUnsupported();
      return;
    }
    const mode = await detectRecognitionMode();
    useVoice.getState().setMode(mode);
    if (consentCovers(getConsent(), mode)) startListening(mode);
    else askConsent(mode);
  }, [askConsent, interrupt, onUnsupported, startListening]);

  // Leaving the page (or Next hiding the route) stops speech and drops anything queued.
  useEffect(() => () => interrupt(), [interrupt]);

  return { press, interrupt, submit, startListening };
}
