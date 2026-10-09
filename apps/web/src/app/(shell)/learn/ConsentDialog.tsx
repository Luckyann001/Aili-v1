"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { Button } from "@/components/Button";
import type { RecognitionMode } from "@/voice/recognition";
import styles from "./learn.module.css";

// Wording approved by Lucky (Oct 9 2026). Version A only when on-device recognition is
// confirmed (processLocally with the language pack installed); otherwise Version B.
const FIRST: Record<RecognitionMode, string> = {
  "on-device": "Your device can turn your speech into text by itself, so your voice recording stays on this device.",
  online:
    "Your browser turns your speech into text using an online speech service. Your voice recording is sent to that service, which is run by your browser's maker or its speech provider, not by Aili. Their privacy terms apply.",
};

export type ConsentResult = "voice" | "text" | "dismiss";

/**
 * Shown before the microphone is first used. The mic stays off unless "Use voice" is chosen.
 * The dialog closes itself before reporting the choice, so the caller can move focus freely.
 */
export function ConsentDialog({ mode, onClose }: { mode: RecognitionMode; onClose: (result: ConsentResult) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const typeInstead = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    // Start on the choice that keeps the mic off, so a stray Enter can't consent.
    typeInstead.current?.focus();
    return () => d?.close();
  }, []);

  const close = (result: ConsentResult) => {
    ref.current?.close();
    onClose(result);
  };

  return (
    <dialog
      ref={ref}
      className={styles.consent}
      aria-labelledby="voice-consent-title"
      data-mode={mode}
      onCancel={(e) => {
        e.preventDefault();
        close("dismiss");
      }}
    >
      <h2 id="voice-consent-title" className={styles.consentTitle}>
        Before you use voice
      </h2>
      <p>{FIRST[mode]}</p>
      <p>Aili receives only the text, the same as if you had typed it. Aili never receives or stores your audio.</p>
      <p>You can type instead at any time.</p>
      <p>
        You can change this anytime in <Link href="/settings">Settings</Link>.
      </p>
      <div className={styles.consentActions}>
        <Button ref={typeInstead} variant="secondary" onClick={() => close("text")}>
          Type instead
        </Button>
        <Button variant="primary" onClick={() => close("voice")}>
          Use voice
        </Button>
      </div>
    </dialog>
  );
}
