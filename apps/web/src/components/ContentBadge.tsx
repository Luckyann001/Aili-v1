import styles from "./ContentBadge.module.css";

/** Prepared vs live vs AI-composed content must always be visibly labelled (CLAUDE.md, honesty rules). */
export type ContentKind = "prepared" | "live" | "illustrative" | "fixture";

const LABEL: Record<ContentKind, string> = {
  prepared: "Prepared",
  live: "Live",
  illustrative: "Illustrative (AI-composed)",
  fixture: "Test fixture",
};

const DESCRIPTION: Record<ContentKind, string> = {
  prepared: "Prepared content, written in advance. Not a live AI response.",
  live: "Live response from the AI professor.",
  illustrative: "Illustrative, composed by AI from library parts. No verified model.",
  fixture: "Test fixture: a scripted fake-director turn for testing. Not a live AI response.",
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

// Distinct shapes: square (prepared, fixed script), filled circle (live), dashed circle
// (illustrative), flask (test fixture).
function BadgeIcon({ kind }: { kind: ContentKind }) {
  const p = { width: 14, height: 14, viewBox: "0 0 14 14", "aria-hidden": true, stroke: "currentColor", strokeWidth: 1.6 } as const;
  if (kind === "prepared")
    return (
      <svg {...p} fill="none">
        <rect x="2" y="2" width="10" height="10" rx="1.5" />
        <path d="M4.5 5.5h5M4.5 8.5h3.5" />
      </svg>
    );
  if (kind === "fixture") return <FlaskIcon />;
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

/** Test fixture: a laboratory flask, outline only. */
export function FlaskIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
      <path d="M5.5 1.5h3M6 1.5v3.8L2.6 11a1 1 0 0 0 .9 1.5h7a1 1 0 0 0 .9-1.5L8 5.3V1.5" />
      <path d="M4.2 8.8h5.6" />
    </svg>
  );
}
