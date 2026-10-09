"use client";

import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";
import { Button } from "@/components/Button";
import { ContentBadge } from "@/components/ContentBadge";
import { useLearnUi, type SideView } from "@/state/learnUi";
import { SAMPLE_EXPLANATION, SAMPLE_READINGS } from "./sampleContent";
import styles from "./learn.module.css";

const TABS: Array<{ view: SideView; label: string }> = [
  { view: "explanation", label: "Explanation" },
  { view: "library", label: "Library" },
];

/**
 * Right-hand text panel on desktop, bottom sheet on phones (stage layout doc §1).
 * Non-modal: the stage stays usable. Esc or Close returns focus to the button that opened it.
 */
export function SidePanel({ view, returnFocusTo }: { view: SideView; returnFocusTo: RefObject<HTMLButtonElement | null> }) {
  const openSide = useLearnUi((s) => s.openSide);
  const closeSide = useLearnUi((s) => s.closeSide);
  const heading = useRef<HTMLHeadingElement>(null);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  const close = () => {
    closeSide();
    returnFocusTo.current?.focus();
  };

  const onTabKey = (e: KeyboardEvent, index: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = (index + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    openSide(TABS[next]!.view);
    tabs.current[next]?.focus();
  };

  return (
    <aside
      id="learn-side"
      className={styles.side}
      aria-labelledby="learn-side-title"
      onKeyDown={(e) => {
        if (e.key === "Escape") close();
      }}
    >
      <div className={styles.sideHeader}>
        <h2 id="learn-side-title" ref={heading} tabIndex={-1} className={styles.sideTitle}>
          {view === "explanation" ? "Explanation" : "Library"}
        </h2>
        <Button variant="quiet" onClick={close}>
          Close
        </Button>
      </div>

      <div role="tablist" aria-label="Text panel" className={styles.tabs}>
        {TABS.map((t, i) => (
          <button
            key={t.view}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`learn-tab-${t.view}`}
            aria-selected={view === t.view}
            aria-controls="learn-tabpanel"
            tabIndex={view === t.view ? 0 : -1}
            className={styles.tab}
            onClick={() => openSide(t.view)}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div id="learn-tabpanel" role="tabpanel" aria-labelledby={`learn-tab-${view}`} className={styles.sideBody}>
        {view === "explanation" ? <ExplanationView /> : <LibraryView />}
      </div>
    </aside>
  );
}

function ExplanationView() {
  const e = SAMPLE_EXPLANATION;
  return (
    <>
      <p>
        <ContentBadge kind="prepared" />
      </p>
      <p className={styles.sampleNote}>Sample text for the layout. Not reviewed teaching content.</p>
      <h3 className={styles.stepTitle}>{e.title}</h3>
      <p>{e.body}</p>
      <h4 className={styles.listTitle}>Assumptions</h4>
      <ul>
        {e.assumptions.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
      <h4 className={styles.listTitle}>Where this stops applying</h4>
      <ul>
        {e.limits.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </>
  );
}

function LibraryView() {
  return (
    <>
      <p className={styles.sampleNote}>
        Only verified readings will appear here. These cards are samples for the layout, not real sources.
      </p>
      <ul className={styles.readings}>
        {SAMPLE_READINGS.map((r) => (
          <li key={r.id} className={styles.reading}>
            <span className={styles.sampleTag}>Sample</span>
            <h3 className={styles.readingTitle}>{r.title}</h3>
            <p>{r.purpose}</p>
          </li>
        ))}
      </ul>
    </>
  );
}
