"use client";

import { useEffect, useId, useState, type RefObject } from "react";
import { Button } from "@/components/Button";
import styles from "./learn.module.css";

/**
 * The opening state in live mode only (demo Option A, Lucky's decision 2026-10-13): a calm,
 * centred "What do you want to learn?" over the dimmed stage. No suggestions, no pre-filled or
 * example topic. On the first message it fades away (UI duration; none with reduced motion, via
 * the tokens) and the normal bottom input takes over.
 */
export function LiveWelcome({
  note,
  text,
  onText,
  inputRef,
  onSubmit,
  onGone,
}: {
  note: string;
  /** The page's text (shared with the bottom box, so a voice transcript lands here too). */
  text: string;
  onText: (text: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  onSubmit: (text: string) => void;
  onGone: () => void;
}) {
  const [leaving, setLeaving] = useState(false);
  const headingId = useId();
  const noteId = useId();

  // The page's one task in this state: the box takes focus once, on arrival.
  useEffect(() => inputRef.current?.focus(), [inputRef]);

  return (
    <section className={styles.welcome} aria-labelledby={headingId} data-leaving={leaving ? "" : undefined}>
      <form
        className={styles.welcomeCard}
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (!t || leaving) return;
          setLeaving(true);
          onText("");
          onSubmit(t); // sent at once; the card fades while Aili thinks
          // Removed once the fade is over: --aili-duration-ui (240 ms, or 0 with reduced motion).
          const ms = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--aili-duration-ui")) || 0;
          setTimeout(onGone, ms);
        }}
      >
        <h2 id={headingId} className={styles.welcomeTitle}>
          <label htmlFor={`${headingId}-input`}>What do you want to learn?</label>
        </h2>
        <p id={noteId} className={styles.welcomeNote}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="currentColor">
            <circle cx="7" cy="7" r="4.5" />
          </svg>
          {note}
        </p>
        <div className={styles.welcomeRow}>
          <input
            ref={inputRef}
            id={`${headingId}-input`}
            className={styles.input}
            value={text}
            onChange={(e) => onText(e.target.value)}
            aria-describedby={noteId}
            autoComplete="off"
            maxLength={500}
          />
          <Button type="submit" variant="primary">
            Send
          </Button>
        </div>
      </form>
    </section>
  );
}
