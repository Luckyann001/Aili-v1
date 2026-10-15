"use client";

import { useId } from "react";
import { paramsFor } from "@/scene/layout";
import { partNameIn } from "@/scene/models";
import { useScene } from "@/scene/sceneStore";
import { useStageContent } from "@/turn/stageContent";
import { SERVO_PARAMS, SERVO_PARAMS_BY_PART, isServoParam, servoReadout, type ServoParamId } from "@/scene/servoArm";
import { MarginLine } from "./ExplanationSpace";
import styles from "../learn.module.css";

interface SettingDef {
  id: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
}

/** As many decimals as the step has (0.01 → 2, 0.005 → 3). */
const decimals = (d: SettingDef) => (d.step.toString().split(".")[1] ?? "").length;
const fmt = (d: SettingDef, v: number) => v.toFixed(decimals(d));
const UNIT_WORDS: Record<string, string> = { m: "metres", kg: "kilograms", "N·m": "newton-metres", deg: "degrees" };

/**
 * Temporary inspector for the selected part: settings with units and bounds. Placeholder values
 * that change the drawing only; no engineering results. Lives inside the stage's safe area, so it
 * never covers the voice orb, captions or controls; at the right from 900 px, along the bottom below. Escape or Close hides it (the selection stays).
 */
export function Inspector({ onClosed }: { onClosed: () => void }) {
  const selectedId = useScene((s) => s.selectedId);
  const activeScene = useScene((s) => s.activeScene);
  const open = useScene((s) => s.inspectorOpen);
  const params = useScene((s) => s.params);
  const setParam = useScene((s) => s.setParam);
  const servo = useScene((s) => s.servo);
  const setServoParam = useScene((s) => s.setServoParam);
  const rating = useScene((s) => s.ratedTorque_nm);
  const closeInspector = useScene((s) => s.closeInspector);
  const titleId = useId();
  if (!selectedId || !open) return null;

  const close = () => {
    closeInspector();
    onClosed();
  };
  // The lever's weight is moved by the lesson; the placeholder arm and the servo + arm have settings.
  const defs = activeScene === "base-joint-arm" ? paramsFor(selectedId) : [];
  const servoDefs = activeScene === "servo-arm" ? (SERVO_PARAMS_BY_PART[selectedId] ?? []).map((id) => SERVO_PARAMS.find((p) => p.id === id)!) : [];
  const servoScene = activeScene === "servo-arm";

  return (
    <section
      data-reserve="auto"
      className={styles.inspector}
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
    >
      <div className={styles.inspectorHeader}>
        <h2 id={titleId} className={styles.inspectorTitle}>
          Inspector: {partNameIn(activeScene, selectedId)}
        </h2>
        <button type="button" className={styles.inspectorClose} aria-label="Close inspector" onClick={close}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      {servoScene ? (
        <>
          <p className={styles.inspectorNote}>Settings for the simplified model. The torque comes from the solver.</p>
          {servoDefs.length === 0 && <p className={styles.inspectorNote}>No settings for this part.</p>}
          {servoDefs.map((d) =>
            isServoParam(d.id) ? (
              <Setting
                key={d.id}
                def={d}
                value={servo[d.id]}
                onChange={(v) => {
                  setServoParam(d.id as ServoParamId, v);
                  useStageContent.getState().learnerChangedSettings();
                }}
              />
            ) : (
              // The rating is entered in the stage's explanation space (one field for the whole stage).
              <p key={d.id} className={styles.inspectorNote}>
                The servo&apos;s rated torque goes in the explanation space.{" "}
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => {
                    closeInspector();
                    useStageContent.getState().requestRatingField(activeScene);
                  }}
                >
                  Enter rating
                </button>
              </p>
            ),
          )}
          <MarginLine r={servoReadout(servo, rating)} />
        </>
      ) : (
        <>
          <p className={styles.inspectorNote}>Placeholder settings. They change the drawing only; nothing is calculated yet.</p>
          {defs.length === 0 ? (
            <p className={styles.inspectorNote}>No settings for this part yet.</p>
          ) : (
            defs.map((d) => <Setting key={d.id} def={d} value={params[d.id]} onChange={(v) => setParam(d.id, v)} />)
          )}
        </>
      )}
    </section>
  );
}

function Setting({ def, value, onChange }: { def: SettingDef; value: number; onChange: (v: number) => void }) {
  const id = useId();
  return (
    <div className={styles.setting}>
      <div className={styles.settingTop}>
        <label htmlFor={id}>{def.label}</label>
        <output htmlFor={id} className={styles.settingValue}>
          {fmt(def, value)} {def.unit}
        </output>
      </div>
      <input
        id={id}
        type="range"
        className={styles.slider}
        min={def.min}
        max={def.max}
        step={def.step}
        value={value}
        aria-valuetext={`${fmt(def, value)} ${UNIT_WORDS[def.unit] ?? def.unit}`}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <p className={styles.settingBounds}>
        {fmt(def, def.min)} {def.unit} to {fmt(def, def.max)} {def.unit}
      </p>
    </div>
  );
}
