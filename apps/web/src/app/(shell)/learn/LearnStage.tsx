"use client";

import { useRef, useState } from "react";
import { ContentBadge } from "@/components/ContentBadge";
import { Button } from "@/components/Button";
import { useLearnUi, type SideView } from "@/state/learnUi";
import { CommandBar } from "./CommandBar";
import { SidePanel } from "./SidePanel";
import { SAMPLE_CAPTION } from "./sampleContent";
import styles from "./learn.module.css";

// Static Learn stage layout (M1 slice 2). No AI, voice or 3D yet: the stage shows a still placeholder.
export function LearnStage() {
  const side = useLearnUi((s) => s.side);
  const captionsOn = useLearnUi((s) => s.captionsOn);
  const toggleSide = useLearnUi((s) => s.toggleSide);
  const toggleCaptions = useLearnUi((s) => s.toggleCaptions);
  const [notice, setNotice] = useState<string | null>(null);
  const lastTrigger = useRef<HTMLButtonElement | null>(null);

  const open = (view: SideView, el: HTMLButtonElement) => {
    lastTrigger.current = el;
    toggleSide(view);
  };

  return (
    <div className={styles.learn} data-side={side ?? "closed"}>
      <h1 className={styles.srOnly}>Learn stage</h1>
      <section className={styles.stage} aria-label="Stage">
        <div className={styles.stageTop}>
          <ContentBadge kind="prepared" />
          <Button
            variant="secondary"
            aria-expanded={side === "explanation"}
            aria-controls="learn-side"
            onClick={(e) => open("explanation", e.currentTarget)}
          >
            <TextIcon /> Explanation
          </Button>
        </div>

        <div className={styles.scene} role="img" aria-label="Scene placeholder. The 3D scene arrives in a later build.">
          <span className={styles.orb} aria-hidden="true" />
          <p className={styles.sceneNote} aria-hidden="true">
            Scene placeholder
          </p>
        </div>

        {captionsOn && (
          <p className={styles.caption} aria-live="polite">
            {notice ?? SAMPLE_CAPTION}
          </p>
        )}

        <div className={styles.stageBottom}>
          <Button variant="secondary" aria-pressed={captionsOn} onClick={toggleCaptions}>
            <CaptionIcon /> Captions
          </Button>
          <Button
            variant="secondary"
            aria-expanded={side === "library"}
            aria-controls="learn-side"
            onClick={(e) => open("library", e.currentTarget)}
          >
            <BookIcon /> Library
          </Button>
        </div>
      </section>

      <CommandBar onNotice={setNotice} />

      {side && <SidePanel view={side} returnFocusTo={lastTrigger} />}
    </div>
  );
}

function TextIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M3 4h12M3 8h12M3 12h8" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <path d="M2.5 3.5h5a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 0-1.5-1.5h-5zM15.5 3.5h-5A1.5 1.5 0 0 0 9 5v10a1.5 1.5 0 0 1 1.5-1.5h5z" />
    </svg>
  );
}

function CaptionIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="2.5" y="4.5" width="15" height="11" rx="2" />
      <path d="M8.5 8.6a1.8 1.8 0 1 0 0 2.8M14 8.6a1.8 1.8 0 1 0 0 2.8" strokeLinecap="round" />
    </svg>
  );
}
