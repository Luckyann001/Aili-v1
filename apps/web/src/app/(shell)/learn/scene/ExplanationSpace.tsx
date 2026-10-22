"use client";

import { useEffect, useId, useState, useSyncExternalStore, type ReactNode } from "react";
import { StatusIcon } from "@/components/StatusIcon";
import { contentLabelOf } from "@/scene/manifests";
import type { SceneId } from "@/scene/models";
import { useScene } from "@/scene/sceneStore";
import { useStageContent } from "@/turn/stageContent";
import { RATIO_NOTE, RATIO_TEXT } from "@/scene/gears";
import { partNameIn } from "@/scene/models";
import { EQ_STEPS, eqLine, eqText, GRAVITY_TEXT, MARGIN, RATING_DEF, SERVO_PARTS, servoReadout, type EqStep, type MarginStatus, type ServoReadout } from "@/scene/servoArm";
import { DroneAdvanced, DroneChecks, DroneFootnote, DroneHeightPlot, DronePidBars, DroneRunButtons, DroneRunNote, DroneSwitches, DroneThrustGauge } from "./DronePanel";
import styles from "../learn.module.css";

// The stage's explanation space (docs/m4-plan.md, 16 Oct 2026): a column at the stage's right,
// inside the stage, from 1,100 px; below that a one-line strip with a button that opens the same
// content as a sheet over the stage (as the inspector does on phones). It shows only for a scene that has content, as a list of
// blocks per scene, so a later slice can add a block (the servo's parts, anatomy) without changes
// here. Every number comes from the solver readout; the learner's sliders work locally.

const WORD: Record<MarginStatus, string> = { pass: "Pass", warn: "Warn", fail: "Fail" };
const MEANING: Record<MarginStatus, string> = {
  pass: "the rating leaves room to spare",
  warn: "the margin is thin",
  fail: "the load needs more than the rating",
};

// Three significant figures, as the engine compiles calculated values.
export const nm = (v: number) => `${v.toPrecision(3)} N·m`;
export const kgfcm = (v: number) => `${v.toPrecision(3)} kgf·cm`;
export const times = (v: number) => `${v.toFixed(2)}×`;
const bands = `Fail below ${MARGIN.fail_below.toFixed(1)}×, Warn ${MARGIN.fail_below.toFixed(1)}× up to ${MARGIN.pass_at_or_above.toFixed(1)}×, Pass at ${MARGIN.pass_at_or_above.toFixed(1)}× and above`;

/** The rating field's id, so the servo's inspector can send focus to it. */
export const RATING_FIELD_ID = "servo-rated-torque";

/** Pass / Warn / Fail with its icon, word and meaning; announced politely when it changes. */
export function MarginLine({ r }: { r: ServoReadout }) {
  if (r.margin === null || r.status === null) return <p className={styles.gaugeLine}>Enter your servo&apos;s rated torque to see the margin.</p>;
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

const decimals = (step: number) => (step.toString().split(".")[1] ?? "").length;
const fmt = (v: number) => v.toFixed(decimals(RATING_DEF.step));

/**
 * The servo's rated torque, typed by the learner from their own datasheet: empty until then (no
 * value is ever offered as a product's spec). Out-of-bounds values are refused with a message and
 * change nothing. Once set, a slider adjusts it within the same bounds.
 */
export function RatingField() {
  const msgId = useId();
  const rating = useScene((s) => s.ratedTorque_nm);
  const setRatedTorque = useScene((s) => s.setRatedTorque);
  const [draft, setDraft] = useState(rating === null ? "" : String(rating));
  const [refused, setRefused] = useState(false);
  const d = RATING_DEF;
  const commit = (raw: string) => {
    setDraft(raw);
    if (raw.trim() === "") {
      setRefused(false);
      setRatedTorque(null);
      return;
    }
    setRefused(!setRatedTorque(Number(raw)));
  };
  return (
    <div className={styles.setting}>
      <div className={styles.settingTop}>
        <label htmlFor={RATING_FIELD_ID}>{d.label}</label>
        <span className={styles.settingValue}>{rating === null ? "Not set" : `${fmt(rating)} ${d.unit}`}</span>
      </div>
      <div className={styles.ratingRow}>
        <input
          id={RATING_FIELD_ID}
          type="number"
          inputMode="decimal"
          className={styles.ratingInput}
          min={d.min}
          max={d.max}
          step={d.step}
          placeholder="From your datasheet"
          value={draft}
          aria-invalid={refused || undefined}
          aria-describedby={msgId}
          onChange={(e) => commit(e.target.value)}
        />
        <span aria-hidden="true">{d.unit}</span>
      </div>
      {rating !== null && (
        <input
          type="range"
          className={styles.slider}
          aria-label="Rated torque"
          min={d.min}
          max={d.max}
          step={d.step}
          value={rating}
          aria-valuetext={`${fmt(rating)} newton-metres`}
          onChange={(e) => {
            setRatedTorque(Number(e.target.value));
            setDraft(e.target.value);
            setRefused(false);
          }}
        />
      )}
      <p id={msgId} className={styles.settingBounds} role={refused ? "alert" : undefined}>
        {refused ? `Enter a value from ${fmt(d.min)} to ${fmt(d.max)} ${d.unit}. Nothing was changed.` : `${fmt(d.min)} ${d.unit} to ${fmt(d.max)} ${d.unit}. Use the rated figure, not the stall figure.`}
      </p>
    </div>
  );
}

/** While the micro servo is open or exploded, the space is about its parts (slice 4). */
const useServoAway = () => useScene((s) => s.activeScene === "servo-arm" && s.servoView !== "assembled");

/**
 * The servo + arm's torque: the total, its split, the inputs, the rating and the margin. Compact while
 * the servo is open or exploded (the total, the rating and the margin only), so the numbers stay in
 * view, unchanged, beside the parts.
 */
function TorqueBlock() {
  const servo = useScene((s) => s.servo);
  const rating = useScene((s) => s.ratedTorque_nm);
  const compact = useServoAway();
  const r = servoReadout(servo, rating);
  const loadShare = r.torque_nm > 0 ? r.load_torque_nm / r.torque_nm : 0;
  const d = Math.min(servo.arm_length_m, servo.load_distance_m);
  return (
    <div className={styles.spaceBlock} data-space-block="torque" data-compact={compact ? "" : undefined}>
      <p className={styles.totalLine}>
        <span className={styles.totalLabel}>Total the servo must hold</span>
        <span className={styles.totalValue}>
          <strong data-solver-value="torque_nm">{nm(r.torque_nm)}</strong> <span data-solver-value="torque_kgf_cm">{kgfcm(r.torque_kgf_cm)}</span>
        </span>
      </p>
      {compact ? (
        <>
          <RatingField />
          <MarginLine r={r} />
        </>
      ) : (
        <TorqueDetail servo={servo} r={r} loadShare={loadShare} d={d} />
      )}
    </div>
  );
}

function TorqueDetail({ servo, r, loadShare, d }: { servo: ReturnType<typeof useScene.getState>["servo"]; r: ServoReadout; loadShare: number; d: number }) {
  return (
    <>
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
      <p className={styles.spaceInputs} data-space-inputs="">
        Load {servo.load_mass_kg.toFixed(2)} kg at {d.toFixed(2)} m · arm {servo.arm_length_m.toFixed(2)} m, {servo.arm_mass_kg.toFixed(3)} kg · {GRAVITY_TEXT}
      </p>
      <RatingField />
      <MarginLine r={r} />
      <p className={styles.marginNote}>
        {MARGIN.label}: {bands}. Simulation only; hardware untested. Level arm, holding still: no acceleration, friction or gear play.
      </p>
    </>
  );
}

/**
 * The micro servo's parts (open or exploded): each part's short name and its one-line role from the
 * asset manifest, tagged illustrative and generic; the gear train carries the ratio line, computed on
 * the page from the tooth counts. It takes the equation steps' place until the servo is assembled.
 */
function PartsBlock() {
  const away = useServoAway();
  const selectedId = useScene((s) => s.selectedId);
  if (!away) return null;
  return (
    <div className={styles.spaceBlock} data-space-block="parts">
      <p className={styles.partsHead}>
        <span>Inside the servo</span>
        <span className={styles.gaugeTag}>illustrative, generic</span>
      </p>
      <ul className={styles.partsRoles} aria-label="The servo's parts">
        {SERVO_PARTS.map((p) => (
          <li key={p.id} data-part-role={p.id} data-current={selectedId === p.id ? "" : undefined}>
            <strong>{partNameIn("servo-arm", p.id)}</strong>
            {selectedId === p.id && <span className={styles.eqTag}>Now</span>}
            <span>{p.role}</span>
            {p.id === "gear-train" && (
              <span className={styles.ratioLine} data-ratio-line="">
                <strong>{RATIO_TEXT}</strong> <span>({RATIO_NOTE})</span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * τ = F × d, line by line as the professor plays the eq-* steps (each with the segment that explains
 * it): a round symbol chip, the formula, the solver's value with its unit, and a text tag. The
 * current step is "Now", earlier ones "Done" (dimmed), the step after it "Next" (formula only).
 */
function EquationBlock() {
  const equation = useScene((s) => s.equation);
  const servo = useScene((s) => s.servo);
  const rating = useScene((s) => s.ratedTorque_nm);
  const latest = equation.at(-1);
  // The current line stays in view as the space scrolls (no jump: "nearest").
  useEffect(() => {
    if (latest) document.querySelector(`[data-eq-line="${latest}"]`)?.scrollIntoView({ block: "nearest" });
  }, [latest]);
  const away = useServoAway();
  if (!latest || away) return null; // open or exploded: the parts take this place; the steps come back on assemble
  const r = servoReadout(servo, rating);
  const d = Math.min(servo.arm_length_m, servo.load_distance_m);
  const next = EQ_STEPS.find((x) => !equation.includes(x));
  const rows: Array<{ step: EqStep; state: "done" | "now" | "next" }> = [...equation.map((step) => ({ step, state: step === latest ? ("now" as const) : ("done" as const) })), ...(next ? [{ step: next, state: "next" as const }] : [])];
  const TAG = { done: "Done", now: "Now", next: "Next" } as const;
  return (
    <div className={styles.spaceBlock} data-space-block="equation">
      <ol className={styles.eqLines} aria-label="The torque, step by step">
        {rows.map(({ step, state }) => {
          const l = eqLine(step, r, d);
          return (
            <li key={step} className={styles.eqLine} data-eq-line={step} data-state={state}>
              <span className={styles.eqChip} aria-hidden="true">
                {l.symbol}
              </span>
              <span className={styles.eqBody}>
                <span className={styles.eqFormula}>{l.formula}</span>
                {state !== "next" && l.value !== null && <span className={styles.eqValue}>{l.value}</span>}
                {state !== "next" && <span className={styles.eqNote}>{l.note}</span>}
              </span>
              <span className={styles.eqTag}>{TAG[state]}</span>
            </li>
          );
        })}
      </ol>
      {/* For screen readers: the new step in full, politely, as it appears. */}
      <p className={styles.srOnly} aria-live="polite">
        Now: {eqText(latest, r, d)}
      </p>
    </div>
  );
}

/** What each scene shows in the space, in order. A scene not listed has no space (the scene keeps the full width). */
export const SPACE_BLOCKS: Partial<Record<SceneId, Array<{ id: string; render: () => ReactNode }>>> = {
  "servo-arm": [
    { id: "parts", render: () => <PartsBlock key="parts" /> },
    { id: "equation", render: () => <EquationBlock key="equation" /> },
    { id: "torque", render: () => <TorqueBlock key="torque" /> },
  ],
  // The drone (step 3b): the beginner controls first, then what the run shows, then the advanced panel.
  "drone-altitude": [
    { id: "controls", render: () => <DroneControlsBlock key="controls" /> },
    { id: "note", render: () => <DroneRunNote key="note" /> },
    { id: "plot", render: () => <DroneHeightPlot key="plot" /> },
    { id: "gauge", render: () => <DroneThrustGauge key="gauge" /> },
    { id: "bars", render: () => <DronePidBars key="bars" /> },
    { id: "checks", render: () => <DroneChecks key="checks" /> },
    { id: "advanced", render: () => <DroneAdvanced key="advanced" /> },
    { id: "footnote", render: () => <DroneFootnote key="footnote" /> },
  ],
};

/** The space's heading for each scene. */
const SPACE_TITLE: Partial<Record<SceneId, string>> = { "servo-arm": "Torque at the joint", "drone-altitude": "Drone controls" };

function DroneControlsBlock() {
  return (
    <div className={styles.droneBlock}>
      <DroneSwitches />
      <DroneRunButtons />
    </div>
  );
}

/** The one-line summary for the strip (narrow screens): the current step, else the total. */
function Summary() {
  const servo = useScene((s) => s.servo);
  const rating = useScene((s) => s.ratedTorque_nm);
  const equation = useScene((s) => s.equation);
  const away = useServoAway();
  const r = servoReadout(servo, rating);
  // While the equation is being built, the strip shows the current step (not while the servo is apart).
  if (equation.length && !away) {
    const l = eqLine(equation.at(-1)!, r, Math.min(servo.arm_length_m, servo.load_distance_m));
    return (
      <span className={styles.stripText} data-strip-now="">
        <span className={styles.eqTag}>Now</span> <span className={styles.eqFormula}>{l.formula}</span>
        {l.value !== null ? <strong>= {l.value}</strong> : <span>{l.note}</span>}
      </span>
    );
  }
  return (
    <span className={styles.stripText}>
      Total the servo must hold: <strong>{nm(r.torque_nm)}</strong>
      {r.status && (
        <>
          {" · "}
          <StatusIcon status={r.status} /> {WORD[r.status]}
        </>
      )}
    </span>
  );
}

const WIDE = "(min-width: 1100px)";
const subscribeWide = (onChange: () => void) => {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
};

export function ExplanationSpace() {
  const scene = useScene((s) => s.activeScene);
  const inspectorOpen = useScene((s) => s.inspectorOpen);
  const wide = useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches, () => false);
  const sheetId = useId();
  const blocks = SPACE_BLOCKS[scene];
  // The sheet is open for one scene; a new scene means closed.
  const open = useStageContent((s) => s.spaceOpenFor === scene);
  const setOpen = (v: boolean) => useStageContent.getState().setSpaceOpenFor(v ? scene : null);
  // The servo's inspector asked for the rating field (the store opened the sheet): focus it.
  const ratingRequest = useStageContent((s) => s.ratingRequest);
  useEffect(() => {
    if (!ratingRequest) return;
    const raf = requestAnimationFrame(() => document.getElementById(RATING_FIELD_ID)?.focus());
    return () => cancelAnimationFrame(raf);
  }, [ratingRequest]);
  // While the inspector is open it takes the same place (it shows the margin line itself).
  if (!blocks || inspectorOpen) return null;
  const tag = contentLabelOf(scene);
  const content = blocks.map((b) => b.render());
  // On narrow screens the drone's switches and Run are in the strip itself, so the sheet leaves them out.
  const sheetContent = blocks.filter((b) => !(scene === "drone-altitude" && b.id === "controls")).map((b) => b.render());

  if (wide)
    return (
      <section className={styles.space} data-reserve="auto" aria-label="Explanation space" data-space="column">
        <div className={styles.spaceHead}>
          <span>{SPACE_TITLE[scene]}</span>
          <span className={styles.gaugeTag} title={tag.detail}>{tag.label}</span>
        </div>
        {content}
      </section>
    );

  return (
    <section
      className={`${styles.spaceStrip} ${open ? styles.spaceStripOpen : ""}`}
      // The strip is reserved (the model is framed above it); the open sheet covers the stage
      // instead, so the framing does not change underneath it.
      data-reserve={open ? undefined : "bottom"}
      aria-label="Explanation space"
      data-space={open ? "sheet" : "strip"}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
          document.getElementById(`${sheetId}-button`)?.focus();
        }
      }}
    >
      <div className={styles.stripRow}>
        {/* The drone's switches and Run stay in the strip, so the drone stays in view while they are used. */}
        {scene === "drone-altitude" ? (
          <div className={styles.droneStrip}>
            <DroneSwitches compact />
            <DroneRunButtons />
          </div>
        ) : (
          <Summary />
        )}
        <button id={`${sheetId}-button`} type="button" className={styles.linkButton} aria-expanded={open} aria-controls={sheetId} onClick={() => setOpen(!open)}>
          {open ? "Close the explanation space" : "Explanation space"}
        </button>
      </div>
      <div id={sheetId} className={styles.spaceSheet} hidden={!open}>
        <div className={styles.spaceHead}>
          <span>{SPACE_TITLE[scene]}</span>
          <span className={styles.gaugeTag} title={tag.detail}>{tag.label}</span>
        </div>
        {sheetContent}
      </div>
    </section>
  );
}
