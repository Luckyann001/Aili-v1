"use client";

import { useId, useState, useSyncExternalStore } from "react";
import { StatusIcon } from "@/components/StatusIcon";
import { useScene } from "@/scene/sceneStore";
import { MARGIN, servoReadout, type MarginStatus, type ServoReadout } from "@/scene/servoArm";
import styles from "../learn.module.css";

// Servo + arm (M4 slice 2a): the torque the joint needs, from the solver, split by cause, and the
// margin against the rating the learner typed from their own datasheet. Pass / Warn / Fail each
// have their own icon shape and word (brand doc §3a); the bands come from config and say so.

const WORD: Record<MarginStatus, string> = { pass: "Pass", warn: "Warn", fail: "Fail" };
const MEANING: Record<MarginStatus, string> = {
  pass: "the rating leaves room to spare",
  warn: "the margin is thin",
  fail: "the load needs more than the rating",
};

export const nm = (v: number) => `${v.toFixed(2)} N·m`;
export const kgfcm = (v: number) => `${v.toFixed(1)} kgf·cm`;
export const times = (v: number) => `${v.toFixed(2)}×`;
const bands = `Fail below ${MARGIN.fail_below.toFixed(1)}×, Warn ${MARGIN.fail_below.toFixed(1)}× up to ${MARGIN.pass_at_or_above.toFixed(1)}×, Pass at ${MARGIN.pass_at_or_above.toFixed(1)}× and above`;

/** Pass / Warn / Fail with its icon, word and meaning; announced politely when it changes. */
export function MarginLine({ r }: { r: ServoReadout }) {
  if (r.margin === null || r.status === null) return <p className={styles.gaugeLine}>Enter your servo&apos;s rated torque (select the servo) to see the margin.</p>;
  return (
    <p className={styles.marginStatus} data-status={r.status} aria-live="polite">
      <StatusIcon status={r.status} />
      <strong>{WORD[r.status]}</strong>
      <span>
        Margin <span data-solver-value="margin">{times(r.margin)}</span>: {MEANING[r.status]}
      </span>
    </p>
  );
}

/** Wide screens start with the details open; phones start with the one-line summary (matches learn.module.css). */
const WIDE = "(min-width: 900px)";
const subscribeWide = (onChange: () => void) => {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
};

export function TorqueMargin() {
  const scene = useScene((s) => s.activeScene);
  const servo = useScene((s) => s.servo);
  const rating = useScene((s) => s.ratedTorque_nm);
  const inspectorOpen = useScene((s) => s.inspectorOpen);
  const select = useScene((s) => s.select);
  const wide = useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches, () => false);
  const [chosen, setOpen] = useState<boolean | null>(null); // null until the learner toggles it
  const open = chosen ?? wide;
  const detailsId = useId();
  // While the inspector is open, it carries the margin line itself (they share the same place).
  if (scene !== "servo-arm" || inspectorOpen) return null;
  const r = servoReadout(servo, rating);
  const loadShare = r.torque_nm > 0 ? r.load_torque_nm / r.torque_nm : 0;

  return (
    <section className={`${styles.gauge} ${styles.margin}`} data-reserve="auto" aria-label="Torque at the joint">
      <div className={styles.gaugeHead}>
        <span>Torque at the joint</span>
        <span className={styles.gaugeTag}>Illustrative (AI-composed)</span>
      </div>
      <p className={styles.gaugeLine}>
        Needed to hold level: <strong data-solver-value="torque_nm">{nm(r.torque_nm)}</strong> (<span data-solver-value="torque_kgf_cm">{kgfcm(r.torque_kgf_cm)}</span>), calculated
      </p>
      {rating === null ? (
        <p className={styles.gaugeLine}>
          To see the margin, enter your servo&apos;s rated torque from its datasheet.{" "}
          <button type="button" className={styles.linkButton} onClick={() => select("servo-case")}>
            Enter rating
          </button>
        </p>
      ) : (
        <MarginLine r={r} />
      )}
      <button type="button" className={styles.linkButton} aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen(!open)}>
        {open ? "Fewer details" : "Details"}
      </button>
      <div id={detailsId} hidden={!open}>
        {/* The split: solid for the load, striped for the arm's own weight (shape, not just colour). */}
        <div className={styles.splitTrack} aria-hidden="true">
          <div className={styles.splitLoad} style={{ width: `${(loadShare * 100).toFixed(1)}%` }} />
          <div className={styles.splitArm} style={{ width: `${((1 - loadShare) * 100).toFixed(1)}%` }} />
        </div>
        <ul className={styles.splitLegend}>
          <li>
            <span className={styles.swatchLoad} aria-hidden="true" />
            Load: <span data-solver-value="load_torque_nm">{nm(r.load_torque_nm)}</span>
          </li>
          <li>
            <span className={styles.swatchArm} aria-hidden="true" />
            Arm&apos;s own weight: <span data-solver-value="arm_torque_nm">{nm(r.arm_torque_nm)}</span>
          </li>
        </ul>
        {rating !== null && (
          <p className={styles.gaugeLine}>
            Your rating: <span data-solver-value="rating_nm">{nm(rating)}</span>
          </p>
        )}
        <p className={styles.marginNote}>
          {MARGIN.label}: {bands}. Simulation only; hardware untested. Level arm, holding still: no acceleration, friction or gear play.
        </p>
      </div>
    </section>
  );
}
