"use client";

import { useId, type RefObject } from "react";
import { Button } from "@/components/Button";
import { useVoice } from "@/voice/store";
import { VoiceButton } from "./VoiceButton";
import styles from "./learn.module.css";

export interface ChipOffer {
  /** Accessible name of the chip group. */
  group: string;
  items: Array<{ id: string; label: string }>;
  onPick: (id: string) => void;
}

/**
 * Bottom command area: chips, text box, and the voice button on phones. Chips are either an
 * `offer` from the page (a lesson's choices, or starting a lesson) or the quick replies Aili
 * offers after asking a question (they fill the text box).
 */
export function CommandBar({
  text,
  onText,
  onSubmit,
  onVoice,
  inputRef,
  offer,
  note,
}: {
  text: string;
  onText: (text: string) => void;
  onSubmit: (text: string) => void;
  onVoice: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
  offer?: ChipOffer | null;
  /** A line about what the text box does, shown above it and read with it (e.g. the scripted demo). */
  note?: string;
}) {
  const inputId = useId();
  const noteId = useId();
  const replies = useVoice((s) => s.prompt?.chips ?? null);
  const chips: ChipOffer | null =
    offer ?? (replies ? { group: "Suggested replies", items: replies.map((r) => ({ id: r, label: r })), onPick: (id) => onText(id) } : null);

  return (
    <div className={styles.command}>
      {chips && (
        <div className={styles.chips} role="group" aria-label={chips.group}>
          {chips.items.map((c) => (
            <button key={c.id} type="button" className={styles.chip} onClick={() => chips.onPick(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
      )}

      {note && (
        <p id={noteId} className={styles.scriptedNote}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle cx="7" cy="7" r="5.5" />
            <path d="M7 6.2v3.6M7 4.3v.1" strokeLinecap="round" />
          </svg>
          {note}
        </p>
      )}

      <form
        className={styles.commandRow}
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          onSubmit(text);
          onText("");
        }}
      >
        <VoiceButton placement="bar" onPress={onVoice} />

        <label htmlFor={inputId} className={styles.srOnly}>
          Ask Aili or answer
        </label>
        <input
          ref={inputRef}
          id={inputId}
          className={styles.input}
          value={text}
          onChange={(e) => onText(e.target.value)}
          placeholder="Ask Aili or answer…"
          aria-describedby={note ? noteId : undefined}
          autoComplete="off"
        />
        <Button type="submit" variant="primary">
          Send
        </Button>
      </form>
    </div>
  );
}
