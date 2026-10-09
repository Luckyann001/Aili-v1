"use client";

import { useId, useState } from "react";
import { Button } from "@/components/Button";
import { SAMPLE_CHIPS } from "./sampleContent";
import styles from "./learn.module.css";

const NOT_CONNECTED = "Replies aren't connected yet. This is a prepared layout preview.";

/** Bottom command area: voice button, text box and quick replies. */
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
        <button type="button" className={styles.voice} aria-disabled="true" aria-describedby={`${inputId}-voice`}>
          <MicIcon />
          <span className={styles.srOnly}>Voice input</span>
        </button>
        <span id={`${inputId}-voice`} className={styles.srOnly}>
          Coming soon. Type instead.
        </span>

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

function MicIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <rect x="8" y="3" width="6" height="10" rx="3" />
      <path d="M5 10.5a6 6 0 0 0 12 0M11 16.5V19" />
    </svg>
  );
}
