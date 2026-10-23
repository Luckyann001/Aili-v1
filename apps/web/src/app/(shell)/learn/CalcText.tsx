import type { CaptionPart } from "@/voice/machine";
import styles from "./learn.module.css";

/** A caption line with solver-calculated values marked: calculator icon, dotted underline, ", calculated". */
export function CaptionText({ parts }: { parts: CaptionPart[] }) {
  return (
    <>
      {parts.map((p, i) =>
        "value" in p ? (
          <span key={i} className={styles.calc} data-calculated="">
            <CalcIcon />
            {p.value}
            <span className={styles.srOnly}>, calculated</span>
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

export function CalcIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <rect x="2.5" y="1.5" width="9" height="11" rx="1.5" />
      <path d="M4.5 4h5M4.75 7h.5M7 7h.5M9.25 7h.5M4.75 9.5h.5M7 9.5h.5M9.25 9.5h.5" />
    </svg>
  );
}

