"use client";

import { useCallback, useEffect, useRef } from "react";
import { consentCovers, getConsent, getMuted } from "./consent";
import { isBusy, type Caption, type CaptionPart } from "./machine";
import {
  detectRecognitionMode,
  isRecognitionSupported,
  recognitionErrorText,
  recognitionLang,
  startRecognition,
  type RecognitionHandle,
  type RecognitionMode,
} from "./recognition";
import { PREPARED_CHIPS, PREPARED_REPLY, THINKING_MS } from "./script";
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

  /** Speaks lines as caption segments under revision `rev`; stops scheduling once `rev` is stale. */
  const playLines = useCallback(
    (rev: number, lines: readonly string[], chips: string[] | undefined, onDone?: () => void, meta?: { source: Caption["source"]; parts?: Array<CaptionPart[] | undefined> }) => {
    const lang = recognitionLang();
    const step = (seq: number) => {
      const s = useVoice.getState();
      if (s.rev !== rev) return; // interrupted or superseded: stop scheduling
      if (seq >= lines.length) {
        s.dispatch({ type: "done", rev, chips });
        onDone?.();
        return;
      }
      s.dispatch({ type: "speak", rev, seq, text: lines[seq]!, source: meta?.source, parts: meta?.parts?.[seq] });
      cancelSegment.current = speakSegment(lines[seq]!, { muted: getMuted(), lang, onDone: () => step(seq + 1) });
    };
    step(0);
    },
    [],
  );

  // The prepared reply ends with a question, so it offers quick replies.
  const playReply = useCallback((rev: number) => playLines(rev, PREPARED_REPLY, PREPARED_CHIPS), [playLines]);

  /**
   * Speaks prepared lesson lines straight away (no "thinking" pause). Returns the revision it runs
   * under; `onDone` fires only if nothing interrupted it.
   */
  const say = useCallback(
    (lines: readonly string[], onDone: () => void) => {
      const s = useVoice.getState();
      s.setHint(null);
      s.dispatch({ type: "submit" });
      stopEverything();
      const rev = useVoice.getState().rev;
      playLines(rev, lines, undefined, onDone);
      return rev;
    },
    [playLines, stopEverything],
  );

  /** A fake-director turn starts: Aili is "thinking" under a new revision, which is returned. */
  const beginTurn = useCallback(() => {
    const s = useVoice.getState();
    s.setHint(null);
    s.dispatch({ type: "submit" });
    stopEverything();
    return useVoice.getState().rev;
  }, [stopEverything]);

  /** Speaks a completed turn under `rev` (badged "Test fixture", or "Live AI" for a live one), then offers its chips. */
  const playTurn = useCallback(
    (rev: number, lines: ReadonlyArray<{ text: string; parts?: CaptionPart[] }>, chips?: string[], source: "fixture" | "live" = "fixture") =>
      playLines(rev, lines.map((l) => l.text), chips, undefined, { source, parts: lines.map((l) => l.parts) }),
    [playLines],
  );

  /** A turn ended without anything to say (an error or a dropped connection): back to idle, no note. */
  const settle = useCallback((rev: number) => {
    if (useVoice.getState().rev === rev) useVoice.getState().dispatch({ type: "reset" });
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

  return { press, interrupt, submit, startListening, say, beginTurn, playTurn, settle };
}
