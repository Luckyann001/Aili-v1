"use client";

import { useSyncExternalStore, type RefObject } from "react";
import { StatusIcon } from "@/components/StatusIcon";
import { useScene } from "@/scene/sceneStore";
import { eqText, SCENE_G_M_PER_S2, servoReadout, type EqStep } from "@/scene/servoArm";
import styles from "../learn.module.css";

// τ = F × d built on the servo + arm (M4 slice B). Each step's label sits on the object (placed by
// the 3D view like the part labels); every number comes from the solver readout, with its unit. On
// phones only the latest step has its full label; earlier ones shrink to small marks (F, d, τ, …).

const MARK: Record<EqStep, string> = { "eq-force": "F", "eq-distance": "d", "eq-torque": "τ", "eq-arm-share": "+ arm", "eq-margin": "margin" };

const PHONE = "(max-width: 599px)";
const subscribePhone = (onChange: () => void) => {
  const mq = window.matchMedia(PHONE);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
};

/** The equation's labels, registered with the 3D view's label map (it positions them each frame). */
export function EquationLabels({ labels }: { labels: RefObject<Map<string, HTMLElement>> }) {
  const scene = useScene((s) => s.activeScene);
  const equation = useScene((s) => s.equation);
  const servo = useScene((s) => s.servo);
  const rating = useScene((s) => s.ratedTorque_nm);
  const phone = useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE).matches, () => false);
  if (scene !== "servo-arm" || equation.length === 0) return null;
  const r = servoReadout(servo, rating);
  const d = Math.min(servo.arm_length_m, servo.load_distance_m);
  const latest = equation.at(-1)!;
  return (
    <>
      <div className={styles.labelLayer} aria-hidden="true">
        {equation.map((step) => {
          const full = !phone || step === latest;
          return (
            <span
              key={step}
              ref={(el) => {
                if (el) labels.current.set(step, el);
                else labels.current.delete(step);
              }}
              className={full ? styles.eqLabel : styles.eqMark}
              data-eq-label={step}
              data-latest={step === latest ? "" : undefined}
              style={{ visibility: "hidden" }}
            >
              {step === "eq-margin" && r.status && full && <StatusIcon status={r.status} />}
              {full ? eqText(step, r, d) : MARK[step]}
            </span>
          );
        })}
      </div>
      {/* For screen readers: the latest step in full, as it appears. */}
      <p className={styles.srOnly} aria-live="polite">
        Step {equation.length}: {eqText(latest, r, d)}
      </p>
    </>
  );
}

/** Without WebGL: the same steps as a plain list beside the still picture. */
export function EquationList() {
  const scene = useScene((s) => s.activeScene);
  const equation = useScene((s) => s.equation);
  const servo = useScene((s) => s.servo);
  const rating = useScene((s) => s.ratedTorque_nm);
  if (scene !== "servo-arm" || equation.length === 0) return null;
  const r = servoReadout(servo, rating);
  const d = Math.min(servo.arm_length_m, servo.load_distance_m);
  return (
    <ol className={styles.eqList} aria-label="The torque, step by step">
      {equation.map((step) => (
        <li key={step} data-eq-label={step}>
          {eqText(step, r, d)}
        </li>
      ))}
      <li className={styles.eqListNote}>g = {SCENE_G_M_PER_S2} m/s²</li>
    </ol>
  );
}
