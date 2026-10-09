"use client";

import { Button } from "@/components/Button";
import { forgetConsent, saveConsent, setMuted, useConsent, useMuted } from "@/voice/consent";
import styles from "./settings.module.css";

export function VoiceSettings() {
  const consent = useConsent();
  const muted = useMuted();

  const current = !consent
    ? "Not chosen yet. Aili will ask the first time you press the microphone."
    : consent.choice === "text"
      ? "Typing only. Aili will ask again if you press the microphone."
      : consent.mode === "on-device"
        ? "Voice on, using speech recognition on this device."
        : "Voice on, using your browser's online speech service.";

  return (
    <section aria-labelledby="voice-settings" className={styles.section}>
      <h2 id="voice-settings">Voice</h2>
      <p className={styles.note}>These choices are saved on this device only. Aili never receives or stores your audio.</p>

      <h3 className={styles.label}>Voice input</h3>
      <p data-testid="voice-choice">{current}</p>
      <div className={styles.actions}>
        <Button variant="secondary" onClick={() => saveConsent("text", consent?.mode ?? "online")} disabled={consent?.choice === "text"}>
          Use typing only
        </Button>
        <Button variant="secondary" onClick={forgetConsent} disabled={!consent}>
          Ask me again next time
        </Button>
      </div>

      <h3 className={styles.label}>Aili&apos;s voice</h3>
      <label className={styles.toggle}>
        <input type="checkbox" checked={muted} onChange={(e) => setMuted(e.target.checked)} />
        <span>Mute Aili&apos;s voice (captions keep running)</span>
      </label>
    </section>
  );
}
