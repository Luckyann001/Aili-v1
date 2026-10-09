import styles from "./ContentBadge.module.css";

/** Prepared vs live vs AI-composed content must always be visibly labelled (CLAUDE.md, honesty rules). */
export type ContentKind = "prepared" | "live" | "illustrative";

const LABEL: Record<ContentKind, string> = {
  prepared: "Prepared",
  live: "Live",
  illustrative: "Illustrative (AI-composed)",
};

const DESCRIPTION: Record<ContentKind, string> = {
  prepared: "Prepared content, written in advance. Not a live AI response.",
  live: "Live response from the AI professor.",
  illustrative: "Illustrative, composed by AI from library parts. No verified model.",
};

export function ContentBadge({ kind }: { kind: ContentKind }) {
  return (
    <span className={`${styles.badge} ${styles[kind]}`} title={DESCRIPTION[kind]}>
      <BadgeIcon kind={kind} />
      <span>{LABEL[kind]}</span>
      <span className={styles.srOnly}>: {DESCRIPTION[kind]}</span>
    </span>
  );
}

// Distinct shapes: square (prepared, fixed script), filled circle (live), dashed circle (illustrative).
function BadgeIcon({ kind }: { kind: ContentKind }) {
  const p = { width: 14, height: 14, viewBox: "0 0 14 14", "aria-hidden": true, stroke: "currentColor", strokeWidth: 1.6 } as const;
  if (kind === "prepared")
    return (
      <svg {...p} fill="none">
        <rect x="2" y="2" width="10" height="10" rx="1.5" />
        <path d="M4.5 5.5h5M4.5 8.5h3.5" />
      </svg>
    );
  if (kind === "live")
    return (
      <svg {...p} fill="currentColor">
        <circle cx="7" cy="7" r="4.5" />
      </svg>
    );
  return (
    <svg {...p} fill="none" strokeDasharray="2.2 1.8">
      <circle cx="7" cy="7" r="5" />
    </svg>
  );
}
