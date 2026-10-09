"use client";

import { useId } from "react";
import styles from "./learn.module.css";

/**
 * Voice button. Large, bottom-centre of the stage on tablet and desktop (Lucky's sketch);
 * in the command bar beside the text box on phones. CSS shows one placement per width.
 * Not connected yet (voice states arrive in slice 3), so it is marked as such.
 */
export function VoiceButton({ placement }: { placement: "stage" | "bar" }) {
  const id = useId();
  return (
    <>
      <button
        type="button"
        className={placement === "stage" ? styles.voiceStage : styles.voiceBar}
        aria-disabled="true"
        aria-describedby={id}
      >
        <MicIcon size={placement === "stage" ? 28 : 22} />
        <span className={styles.srOnly}>Voice input</span>
      </button>
      <span id={id} hidden>
        Coming soon. Type instead.
      </span>
    </>
  );
}

function MicIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <rect x="8" y="3" width="6" height="10" rx="3" />
      <path d="M5 10.5a6 6 0 0 0 12 0M11 16.5V19" />
    </svg>
  );
}
