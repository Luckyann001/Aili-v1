"use client";

import { useState } from "react";
import { ContentBadge } from "@/components/ContentBadge";
import { GEARS_ANIMATION_LABEL, RATIO_NOTE, RATIO_TEXT } from "@/scene/gears";
import { useVoice } from "@/voice/store";
import type { AssetView } from "@/scene/assetPose";
import { gearsTurn, servoTo, stopGears } from "@/scene/animations";
import { partNameIn } from "@/scene/models";
import { gearsInView, useScene, type Actor } from "@/scene/sceneStore";
import servoAsset from "../../../../../../../content/robotics/capabilities/asset.servo-generic-anatomy.json";
import type { LabelledItem } from "@aili/schemas/labels";
import styles from "../learn.module.css";

// The servo + arm's anatomy controls: Explode, Open and Assemble (text buttons, 44 px, keyboard),
// the same animations the professor plays. A line says who did what: Aili (a turn's action) or the
// learner, with a different icon for each, never colour alone.

const BUTTONS: Array<{ view: AssetView; label: string }> = [
  { view: "exploded", label: "Explode" },
  { view: "open", label: "Open" },
  { view: "assembled", label: "Assemble" },
];

const DONE: Record<AssetView, string> = { exploded: "exploded the servo", open: "opened the servo", assembled: "put the servo back together" };

export function ServoControls() {
  const view = useScene((s) => s.servoView);
  const by = useScene((s) => s.servoBy);
  const selectedId = useScene((s) => s.selectedId);
  const selectedBy = useScene((s) => s.selectedBy);
  const viewer = useScene((s) => s.viewer);
  const turning = useScene((s) => s.gearsTurning);
  const gearsBy = useScene((s) => s.gearsBy);
  const inView = useScene(gearsInView);
  const [hint, setHint] = useState(false);
  // The still picture (no WebGL) has no moving parts: the controls are for the 3D view only.
  if (viewer !== "ready") return null;
  const servoPart = selectedId && servoAsset.parts.some((p) => p.id === selectedId) ? partNameIn("servo-arm", selectedId) : null;
  return (
    <div className={styles.servoControls}>
      <div className={styles.sceneTools} role="group" aria-label="Servo">
        {BUTTONS.map((b) => (
          <button key={b.view} type="button" className={styles.servoButton} aria-pressed={view === b.view} onClick={() => void servoTo(b.view, "learner")(() => true)}>
            {b.label}
          </button>
        ))}
        <button
          type="button"
          className={styles.servoButton}
          aria-pressed={turning}
          onClick={() => {
            if (!useScene.getState().gearsTurning && !gearsInView(useScene.getState())) return setHint(true);
            setHint(false);
            if (useScene.getState().gearsTurning) return stopGears("learner");
            // A learner's start stops at the next turn too, like the professor's.
            const rev = useVoice.getState().rev;
            void gearsTurn("learner")(() => useVoice.getState().rev === rev);
          }}
        >
          {turning ? "Stop gears" : "Turn gears"}
        </button>
      </div>
      {hint && !inView && <p className={styles.servoNote}>Open or explode the servo, or pick the gear train, to see the gears turn.</p>}
      {turning && (
        <p className={styles.servoNote} data-testid="gears-label">
          <span>{GEARS_ANIMATION_LABEL}</span>
          {/* Reduced motion: no turning; arrows show the directions, and the ratio is said here. */}
          <span className={styles.reducedOnly}>
            {RATIO_TEXT} ({RATIO_NOTE})
          </span>
        </p>
      )}
      {/* Open or exploded: the servo's own label (from its manifest) and what is hidden, on one row. */}
      {view !== "assembled" && (
        <p className={styles.servoApartRow}>
          <ContentBadge kind="illustrative" item={servoAsset as LabelledItem} />
          <span className={styles.servoNote} data-testid="hidden-note">
            Arm and load hidden while you look inside
          </span>
        </p>
      )}
      <p className={styles.servoNote} aria-live="polite" data-testid="servo-note">
        {by && <ActorLine by={by} text={DONE[view]} />}
        {gearsBy && <ActorLine by={gearsBy} text={turning ? "turned the gears" : "stopped the gears"} />}
        {servoPart && selectedBy && <ActorLine by={selectedBy} text={selectedBy === "professor" ? `pointed at the ${servoPart.toLowerCase()}` : `picked the ${servoPart.toLowerCase()}`} />}
      </p>
    </div>
  );
}

function ActorLine({ by, text }: { by: Actor; text: string }) {
  return (
    <span className={styles.actorLine} data-actor={by}>
      {by === "professor" ? <AiliMark /> : <YouMark />}
      {by === "professor" ? "Aili" : "You"} {text}
    </span>
  );
}

/** Aili: a small filled orb (the logo's presence). */
function AiliMark() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="6" cy="6" r="4.5" fill="currentColor" />
    </svg>
  );
}

/** The learner: a pointer arrow, outline only. */
function YouMark() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <path d="M2 1.5l7.5 4.2-3.2.9 1.7 3.4-1.4.7-1.7-3.4L2.5 9.5z" />
    </svg>
  );
}
