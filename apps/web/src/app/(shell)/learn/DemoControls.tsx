"use client";

import { useSyncExternalStore } from "react";
import { isRecognitionSupported } from "@/voice/recognition";
import { useConsent } from "@/voice/consent";
import { useVoice } from "@/voice/store";
import type { VoiceStatus } from "@/voice/machine";
import styles from "./learn.module.css";

const STATES: VoiceStatus[] = ["idle", "listening", "thinking", "speaking", "error"];

/** Shown only with ?demo=1 in the address. Not linked anywhere; for testing the voice states. */
export function useDemoMode(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => new URLSearchParams(window.location.search).get("demo") === "1",
    () => false,
  );
}

export function DemoControls({ onPlay }: { onPlay: () => void }) {
  const dispatch = useVoice((s) => s.dispatch);
  const mode = useVoice((s) => s.mode);
  const consent = useConsent();
  const supported = useSyncExternalStore(() => () => {}, isRecognitionSupported, () => false);

  return (
    <details className={styles.demo}>
      <summary>Demo controls (testing only)</summary>
      <p className={styles.demoNote}>Not part of the product. Sets the voice state directly so each look can be checked.</p>
      <div className={styles.demoButtons}>
        {STATES.map((s) => (
          <button key={s} type="button" className={styles.demoButton} onClick={() => dispatch({ type: "demoSet", status: s })}>
            Show {s}
          </button>
        ))}
        <button type="button" className={styles.demoButton} onClick={onPlay}>
          Play prepared reply
        </button>
      </div>
      <dl className={styles.demoFacts}>
        <dt>Speech recognition in this browser</dt>
        <dd>{supported ? "supported" : "not supported"}</dd>
        <dt>Detected mode (after pressing the mic)</dt>
        <dd>{mode ?? "not detected yet"}</dd>
        <dt>Saved choice on this device</dt>
        <dd>{consent ? `${consent.choice}, ${consent.mode}` : "none"}</dd>
      </dl>
    </details>
  );
}
