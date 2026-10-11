import styles from "./StatusNote.module.css";

/** The honest status block: an info icon (circle with "i") plus the words. */
export function StatusNote({ children }: { children: React.ReactNode }) {
  return (
    <p className={styles.status}>
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="10" cy="10" r="8" />
        <path d="M10 9v5M10 6.2v.1" />
      </svg>
      <span>{children}</span>
    </p>
  );
}
