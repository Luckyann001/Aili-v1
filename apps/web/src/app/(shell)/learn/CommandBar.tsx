"use client";

import { useId, type RefObject } from "react";
import { Button } from "@/components/Button";
import { useVoice } from "@/voice/store";
import { VoiceButton } from "./VoiceButton";
import styles from "./learn.module.css";

/** Bottom command area: quick replies (only after Aili asks a question), text box, and the voice button on phones. */
export function CommandBar({
  text,
  onText,
  onSubmit,
  onVoice,
  inputRef,
}: {
  text: string;
  onText: (text: string) => void;
  onSubmit: (text: string) => void;
  onVoice: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const inputId = useId();
  const chips = useVoice((s) => s.prompt?.chips ?? null);

  return (
    <div className={styles.command}>
      {chips && (
        <div className={styles.chips} role="group" aria-label="Suggested replies">
          {chips.map((c) => (
            <button key={c} type="button" className={styles.chip} onClick={() => onText(c)}>
              {c}
            </button>
          ))}
        </div>
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
          autoComplete="off"
        />
        <Button type="submit" variant="primary">
          Send
        </Button>
      </form>
    </div>
  );
}
