"use client";

import { useId } from "react";
import { paramsFor, type ParamDef } from "@/scene/layout";
import { partName } from "@/scene/placeholderModel";
import { useScene } from "@/scene/sceneStore";
import styles from "../learn.module.css";

/** As many decimals as the step has (0.01 → 2, 0.005 → 3). */
const decimals = (d: ParamDef) => (d.step.toString().split(".")[1] ?? "").length;
const fmt = (d: ParamDef, v: number) => v.toFixed(decimals(d));

/**
 * Temporary inspector for the selected part: settings with units and bounds. Placeholder values
 * that change the drawing only; no engineering results. Lives inside the stage's safe area, so it
 * never covers the voice orb, captions or controls; at the right from 900 px, along the bottom below. Escape or Close hides it (the selection stays).
 */
export function Inspector({ onClosed }: { onClosed: () => void }) {
  const selectedId = useScene((s) => s.selectedId);
  const open = useScene((s) => s.inspectorOpen);
  const params = useScene((s) => s.params);
  const setParam = useScene((s) => s.setParam);
  const closeInspector = useScene((s) => s.closeInspector);
  const titleId = useId();
  if (!selectedId || !open) return null;

  const close = () => {
    closeInspector();
    onClosed();
  };
  const defs = paramsFor(selectedId);

  return (
    <section
      data-inspector=""
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
          Inspector: {partName(selectedId)}
        </h2>
        <button type="button" className={styles.inspectorClose} aria-label="Close inspector" onClick={close}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      <p className={styles.inspectorNote}>Placeholder settings. They change the drawing only; nothing is calculated yet.</p>
      {defs.length === 0 ? (
        <p className={styles.inspectorNote}>No settings for this part yet.</p>
      ) : (
        defs.map((d) => <Setting key={d.id} def={d} value={params[d.id]} onChange={(v) => setParam(d.id, v)} />)
      )}
    </section>
  );
}

function Setting({ def, value, onChange }: { def: ParamDef; value: number; onChange: (v: number) => void }) {
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
        aria-valuetext={`${fmt(def, value)} metres`}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <p className={styles.settingBounds}>
        {fmt(def, def.min)} {def.unit} to {fmt(def, def.max)} {def.unit}
      </p>
    </div>
  );
}
