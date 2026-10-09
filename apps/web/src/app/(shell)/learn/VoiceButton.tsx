"use client";

import { useVoice } from "@/voice/store";
import type { VoiceStatus } from "@/voice/machine";
import styles from "./learn.module.css";

// Each state has its own icon, label and shape (never colour alone):
//   idle      mic          solid orb
//   listening sound bars   orb + thick ring
//   thinking  three dots   orb + dashed ring
//   speaking  sound waves  orb + double ring
//   error     warning      rounded square with heavy border
export const VOICE_LABEL: Record<VoiceStatus, string> = {
  idle: "Ready",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  error: "Voice error",
};

const BUTTON_NAME: Record<VoiceStatus, string> = {
  idle: "Start voice input",
  listening: "Stop listening",
  thinking: "Stop",
  speaking: "Stop speaking",
  error: "Voice error. Try again",
};

/**
 * Large orb at the bottom centre of the stage (768 px and wider); in the command bar on phones.
 * CSS shows one placement per width. While Aili is busy, pressing it interrupts.
 */
export function VoiceButton({ placement, onPress }: { placement: "stage" | "bar"; onPress: () => void }) {
  const status = useVoice((s) => s.status);
  return (
    <button
      type="button"
      className={placement === "stage" ? styles.voiceStage : styles.voiceBar}
      data-state={status}
      aria-label={BUTTON_NAME[status]}
      onClick={onPress}
    >
      <VoiceIcon status={status} size={placement === "stage" ? 28 : 22} />
    </button>
  );
}

/** Visible state label, also announced to screen readers. One instance, shown at every width. */
export function VoiceStatusLabel() {
  const status = useVoice((s) => s.status);
  const mode = useVoice((s) => s.mode);
  const note = useVoice((s) => s.note);
  const where = status === "listening" && mode ? (mode === "on-device" ? " (on this device)" : " (online speech service)") : "";
  const text = status === "idle" && note ? note : VOICE_LABEL[status] + where;
  return (
    <p className={styles.voiceLabel} role="status" data-state={status}>
      <VoiceIcon status={status} size={14} />
      <span>{text}</span>
    </p>
  );
}

export function VoiceIcon({ status, size }: { status: VoiceStatus; size: number }) {
  const p = { width: size, height: size, viewBox: "0 0 22 22", "aria-hidden": true, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  switch (status) {
    case "idle":
      return (
        <svg {...p}>
          <rect x="8" y="3" width="6" height="10" rx="3" />
          <path d="M5 10.5a6 6 0 0 0 12 0M11 16.5V19" />
        </svg>
      );
    case "listening":
      return (
        <svg {...p}>
          <path d="M4 9v4M7.5 6v10M11 3.5v15M14.5 6v10M18 9v4" />
        </svg>
      );
    case "thinking":
      return (
        <svg {...p} fill="currentColor" stroke="none">
          <circle cx="5" cy="11" r="1.9" />
          <circle cx="11" cy="11" r="1.9" />
          <circle cx="17" cy="11" r="1.9" />
        </svg>
      );
    case "speaking":
      return (
        <svg {...p}>
          <path d="M3.5 8.5h3l4-3.5v12l-4-3.5h-3z" />
          <path d="M14 8a4 4 0 0 1 0 6M16.5 5.5a7.5 7.5 0 0 1 0 11" />
        </svg>
      );
    case "error":
      return (
        <svg {...p}>
          <path d="M11 3l8.5 15h-17z" />
          <path d="M11 9v4M11 15.6v.1" />
        </svg>
      );
  }
}
