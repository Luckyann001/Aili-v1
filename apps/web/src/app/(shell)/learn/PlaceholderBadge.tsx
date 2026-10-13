"use client";

import { useId, useState } from "react";
import { isDraft, reviewLabelOf } from "@/scene/manifests";
import { MODELS } from "@/scene/models";
import { useScene } from "@/scene/sceneStore";
import { FlaskIcon } from "@/components/ContentBadge";
import { useStageContent } from "@/turn/stageContent";
import styles from "./learn.module.css";

/**
 * The stage badge shows what is on the stage now: "Prepared · …" for the scene and lesson (always),
 * and beside it "Test fixture · …" while a fake-director turn's content is on stage, or
 * "Live AI · Test fixture content" while a live turn's content is on stage. The captions,
 * labels and text-panel toggles do not affect it, so it cannot be hidden.
 *
 * "Prepared · …" badge for the scene on the stage. A draft scene always says
 * "Draft (not expert-reviewed)". Tap for the full wording; keyboard focus shows it too.
 */
export function PlaceholderBadge() {
  const [open, setOpen] = useState(false);
  const id = useId();
  const activeScene = useScene((s) => s.activeScene);
  const fixture = useStageContent((s) => s.fixture);
  const live = useStageContent((s) => s.live);
  const status = isDraft(activeScene) ? reviewLabelOf(activeScene) : "placeholder";
  const full = `Prepared content, written in advance. Not a live AI response. ${isDraft(activeScene) ? `${reviewLabelOf(activeScene)}. ` : ""}${MODELS[activeScene].note}`;
  return (
    <>
    <span className={styles.badgeWrap}>
      <button
        type="button"
        className={styles.badgeButton}
        aria-expanded={open}
        aria-describedby={id}
        onClick={() => setOpen((v) => !v)}
        onFocus={(e) => {
          if (e.currentTarget.matches(":focus-visible")) setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      >
        {/* The visible outline hugs the text, so it grows with large text; the button stays 44 px. */}
        <span className={styles.badgePill}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
            <rect x="2" y="2" width="10" height="10" rx="1.5" />
            <path d="M4.5 5.5h5M4.5 8.5h3.5" />
          </svg>
          Prepared · {status}
        </span>
      </button>
      <span id={id} role="note" className={styles.badgeDetail} hidden={!open}>
        {full}
      </span>
    </span>
    {fixture && live && (
      <span className={`${styles.badgePill} ${styles.badgeLive}`} data-badge="live">
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="currentColor">
          <circle cx="7" cy="7" r="4.5" />
        </svg>
        Live AI · Test fixture content
        <span className={styles.srOnly}>. Answered by a real AI model, using test-fixture content that is not expert-reviewed.</span>
      </span>
    )}
    {fixture && !live && (
      <span className={`${styles.badgePill} ${styles.badgeFixture}`} data-badge="fixture">
        <FlaskIcon />
        Test fixture · Fake director, not live AI
        <span className={styles.srOnly}>. A scripted turn for testing; no AI model is connected.</span>
      </span>
    )}
    </>
  );
}
