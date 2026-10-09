"use client";

import { useId, useState } from "react";
import { Button } from "@/components/Button";
import { SAMPLE_CHIPS } from "./sampleContent";
import { VoiceButton } from "./VoiceButton";
import styles from "./learn.module.css";

const NOT_CONNECTED = "Replies aren't connected yet. This is a prepared layout preview.";

/** Bottom command area: quick replies, text box, and the voice button on phones. */
export function CommandBar({ onNotice }: { onNotice: (text: string) => void }) {
  const [text, setText] = useState("");
  const inputId = useId();

  return (
    <div className={styles.command}>
      <div className={styles.chips} role="group" aria-label="Suggested replies">
        {SAMPLE_CHIPS.map((c) => (
          <button key={c} type="button" className={styles.chip} onClick={() => setText(c)}>
            {c}
          </button>
        ))}
      </div>

      <form
        className={styles.commandRow}
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          onNotice(NOT_CONNECTED);
          setText("");
        }}
      >
        <VoiceButton placement="bar" />

        <label htmlFor={inputId} className={styles.srOnly}>
          Ask Aili or answer
        </label>
        <input
          id={inputId}
          className={styles.input}
          value={text}
          onChange={(e) => setText(e.target.value)}
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
