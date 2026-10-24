"use client";

import { useId } from "react";
import { Button } from "@/components/Button";
import { ComingTag } from "@/components/ComingTag";
import { StatusIcon } from "@/components/StatusIcon";
import { CHECKS_LABEL, DRONE_PRESETS, droneChecks, m2, n1, runLength_s, runTerms, sampleAt, SWITCHES, type DroneRun } from "@/scene/droneRun";
import { useScene } from "@/scene/sceneStore";
import { prefersReducedMotion } from "@/scene/useDronePlayback";
import { MANIFESTS } from "@/scene/manifests";
import styles from "../learn.module.css";

// The drone's controls and readouts in the explanation space (step 3b, docs/drone-pid-plan.md):
// beginner switches for P, I and D with lamps, Run and Gust; an advanced panel with the gain sliders,
// the set height and the presets; then the thrust gauge, the P/I/D bars, the height plot with a ghost of
// the previous run, and the checks. Every number shown is the solver's, read from the run being played.

const WORD = { pass: "Pass", warn: "Warn", fail: "Fail" } as const;

/** Quantised playback time, so the readouts re-render about ten times a second, not every frame. */
const usePlayT = () => useScene((s) => Math.round(s.droneT_s * 10) / 10);

const run = (kind: "run" | "gust") => useScene.getState().startDroneRun(kind, { snap: prefersReducedMotion() });

/** P, I and D as switches with a lamp and the word On / Off (never colour alone). */
export function DroneSwitches({ compact = false }: { compact?: boolean }) {
  const settings = useScene((s) => s.drone.settings);
  const setSwitch = useScene((s) => s.setDroneSwitch);
  return (
    <div className={styles.droneSwitches} role="group" aria-label="Controller terms">
      {SWITCHES.map((sw) => {
        const on = (settings[sw.gain] ?? 0) > 0;
        return (
          <button key={sw.id} type="button" role="switch" aria-checked={on} className={styles.droneSwitch} data-on={on} onClick={() => setSwitch(sw.id, !on)}>
            <span className={styles.droneLamp} aria-hidden="true" />
            <span className={styles.droneSwitchText}>
              <span>
                <span className={styles.droneSwitchName}>{sw.name}</span> <span className={styles.droneSwitchState}>{on ? "On" : "Off"}</span>
              </span>
              {!compact && <span className={styles.droneSwitchRole}>{sw.role}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Run (from the ground) and Gust (a short downward push, from where this controller holds the drone). */
export function DroneRunButtons() {
  const playing = useScene((s) => s.dronePlaying);
  const gustNote = useId();
  return (
    <div className={styles.droneButtons}>
      <Button variant="primary" onClick={() => run("run")}>
        {playing ? "Run again" : "Run"}
      </Button>
      <Button aria-describedby={gustNote} onClick={() => run("gust")}>
        Gust
      </Button>
      <span id={gustNote} className={styles.srOnly}>
        A short downward push, starting from where this controller holds the drone.
      </span>
    </div>
  );
}

/** Which switches a run used, in words. */
const usedTerms = runTerms;

/** True when the settings changed since the run: its readouts are then the last run's, and we say so. */
const useStale = () =>
  useScene((s) => {
    const r = s.droneRun;
    if (!r) return false;
    return Object.keys(s.drone.settings).some((k) => s.drone.settings[k] !== r.settings[k]);
  });

/** Thrust against the motors' maximum, with a tick at the weight (the thrust that holds the drone still). */
export function DroneThrustGauge() {
  const r = useScene((s) => s.droneRun);
  const t = usePlayT();
  if (!r) return null;
  const now = sampleAt(r.result, t);
  const max = r.result.max_thrust_n;
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / max) * 100)).toFixed(1)}%`;
  return (
    <div className={styles.droneBlock} aria-label="Thrust gauge" role="group">
      <div className={styles.droneGaugeRow}>
        <span className={styles.droneBlockHead}>Thrust</span>
        <div className={styles.droneGauge}>
          <span className={styles.droneGaugeFill} style={{ width: pct(now.thrust_n) }} />
          <span className={styles.droneGaugeTick} style={{ left: pct(r.result.weight_n) }} aria-hidden="true" />
        </div>
      </div>
      <p className={styles.droneGaugeText}>
        <span>
          ↑ thrust <strong data-solver-value="thrust">{n1(now.thrust_n)}</strong>
        </span>
        <span>
          tick: ↓ weight <strong data-solver-value="weight">{n1(r.result.weight_n)}</strong>
        </span>
        <span>max {n1(max)}</span>
      </p>
    </div>
  );
}

/** Each term's push on the thrust at the playback time (signed: D pushes down while the drone climbs). */
export function DronePidBars() {
  const r = useScene((s) => s.droneRun);
  const t = usePlayT();
  if (!r) return null;
  const now = sampleAt(r.result, t);
  const max = r.result.max_thrust_n;
  const bars = [
    { id: "p", name: "P", value: now.p_n },
    { id: "i", name: "I", value: now.i_n },
    { id: "d", name: "D", value: now.d_n },
  ];
  return (
    <div className={styles.droneBlock} role="group" aria-label="What P, I and D each push">
      <p className={styles.droneBlockHead}>What each term pushes</p>
      {bars.map((b) => {
        const share = Math.max(-1, Math.min(1, b.value / max));
        return (
          <div key={b.id} className={styles.droneBar} data-bar={b.id}>
            <span className={styles.droneBarName}>{b.name}</span>
            <span className={styles.droneBarTrack} aria-hidden="true">
              <span
                className={styles.droneBarFill}
                data-dir={share < 0 ? "down" : "up"}
                style={share < 0 ? { right: "50%", width: `${(-share * 50).toFixed(1)}%` } : { left: "50%", width: `${(share * 50).toFixed(1)}%` }}
              />
            </span>
            <span className={styles.droneBarValue}>
              {Math.abs(b.value) < 0.05 ? "0.0 N" : `${b.value > 0 ? "↑" : "↓"} ${n1(Math.abs(b.value))}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Short enough that the drone, this plot and the thrust gauge fit together on a 1366×768 laptop.
const PLOT = { w: 300, h: 100, left: 34, right: 8, top: 8, bottom: 18 };

/** Height over the run: the target line, this run up to the playback time, the previous run as a ghost, and the gap now. */
export function DroneHeightPlot() {
  const r = useScene((s) => s.droneRun);
  const ghost = useScene((s) => s.droneGhost);
  const t = usePlayT();
  if (!r) return null;
  const target = r.settings.target_m ?? 2;
  const end = runLength_s(r.result);
  const top = Math.ceil((Math.max(target, r.result.peak_height_m, ghost?.result.peak_height_m ?? 0) + 0.2) / 0.5) * 0.5;
  const x = (ts: number) => PLOT.left + (ts / end) * (PLOT.w - PLOT.left - PLOT.right);
  const y = (h: number) => PLOT.top + (1 - h / top) * (PLOT.h - PLOT.top - PLOT.bottom);
  const path = (run: DroneRun, until: number) => {
    const { t_s, height_m } = run.result.trace;
    const pts: string[] = [];
    for (let k = 0; k < t_s.length && t_s[k]! <= until + 1e-9; k++) pts.push(`${x(t_s[k]!).toFixed(1)},${y(height_m[k]!).toFixed(1)}`);
    return pts.length > 1 ? `M${pts.join("L")}` : "";
  };
  const now = sampleAt(r.result, t);
  const grid: number[] = [];
  for (let h = 0; h <= top + 1e-9; h += 0.5) grid.push(Number(h.toFixed(1)));
  const ghostTarget = ghost?.settings.target_m;
  const summary = `${r.kind === "gust" ? "Gust" : "Run"} with ${usedTerms(r)}. Height over ${end.toFixed(0)} seconds: at ${t.toFixed(1)} s it is ${m2(now.height_m)}, the target is ${m2(target)}${ghost ? `; the faint line is the previous run (${usedTerms(ghost)})` : ""}.`;
  return (
    <div className={styles.droneBlock}>
      {/* The readout in the heading line, so the plot and the thrust gauge fit with the drone on a laptop. */}
      <p className={styles.droneBlockHead}>
        Height{" "}
        <span className={styles.droneHeadNote} aria-live="off">
          {t.toFixed(1)} s · <strong data-solver-value="height">{m2(now.height_m)}</strong> · gap <strong data-solver-value="gap">{m2(Math.abs(now.error_m))}</strong>{" "}
          {now.error_m > 0.005 ? "below" : now.error_m < -0.005 ? "above" : "on target"}
        </span>
      </p>
      <svg viewBox={`0 0 ${PLOT.w} ${PLOT.h}`} className={styles.dronePlot} role="img" aria-label={summary}>
        {grid.map((h) => (
          <g key={h}>
            <line x1={PLOT.left} x2={PLOT.w - PLOT.right} y1={y(h)} y2={y(h)} className={styles.dronePlotGrid} />
            {Number.isInteger(h) && (
              <text x={PLOT.left - 4} y={y(h) + 3} textAnchor="end" className={styles.dronePlotText}>
                {h} m
              </text>
            )}
          </g>
        ))}
        {[0, 5, 10, 15].filter((s) => s <= end).map((s) => (
          <text key={s} x={x(s)} y={PLOT.h - 6} textAnchor="middle" className={styles.dronePlotText}>
            {s} s
          </text>
        ))}
        <line x1={PLOT.left} x2={PLOT.w - PLOT.right} y1={y(target)} y2={y(target)} className={styles.dronePlotTarget} />
        <text x={PLOT.w - PLOT.right} y={y(target) - 4} textAnchor="end" className={styles.dronePlotText}>
          target
        </text>
        {ghost && <path d={path(ghost, Infinity)} className={styles.dronePlotGhost} data-ghost-target={ghostTarget} />}
        <path d={path(r, t)} className={styles.dronePlotRun} />
        <line x1={x(t)} x2={x(t)} y1={PLOT.top} y2={PLOT.h - PLOT.bottom} className={styles.dronePlotNow} />
        {/* The gap now: a bracket from the drone's height to the target. */}
        {Math.abs(now.error_m) > 0.01 && (
          <g data-gap="">
            <line x1={x(t) + 6} x2={x(t) + 6} y1={y(now.height_m)} y2={y(target)} className={styles.dronePlotGap} />
            <line x1={x(t) + 2} x2={x(t) + 10} y1={y(now.height_m)} y2={y(now.height_m)} className={styles.dronePlotGap} />
            <line x1={x(t) + 2} x2={x(t) + 10} y1={y(target)} y2={y(target)} className={styles.dronePlotGap} />
          </g>
        )}
      </svg>
    </div>
  );
}

/** Pass / Warn / Fail for the run, each with its icon and word; thresholds from config (a design choice). */
export function DroneChecks() {
  const r = useScene((s) => s.droneRun);
  const playing = useScene((s) => s.dronePlaying);
  if (!r) return null;
  if (playing) return <p className={styles.droneNote}>The checks appear when the run ends.</p>;
  return (
    <div className={styles.droneBlock} role="group" aria-label="Checks">
      <p className={styles.droneBlockHead}>Checks</p>
      <ul className={styles.droneChecks} aria-live="polite">
        {droneChecks(r).map((c) => (
          <li key={c.id} className={styles.marginStatus} data-status={c.status} data-check={c.id}>
            <StatusIcon status={c.status} />
            <strong>{WORD[c.status]}</strong>
            <span>
              {c.label} <span data-solver-value={c.id}>{c.value}</span>: {c.meaning}
            </span>
          </li>
        ))}
      </ul>
      <p className={styles.droneNote}>{CHECKS_LABEL}.</p>
    </div>
  );
}

/** The run the readouts show, and a plain note when the settings have changed since. */
export function DroneRunNote() {
  const r = useScene((s) => s.droneRun);
  const stale = useStale();
  if (!r) return <p className={styles.droneNote}>Switch terms on, then press Run to fly the drone.</p>;
  // The run itself is named in the plot's heading; this line speaks up only when the settings changed since.
  if (!stale) return null;
  return (
    <p className={styles.droneNote} data-stale="">
      You changed the settings since: these are the last run&apos;s results. Press Run to fly again.
    </p>
  );
}

const droneManifest = MANIFESTS["drone-altitude"];
type Param = (typeof droneManifest.params)[number];
const ADVANCED: Param[] = droneManifest.params.filter((p) => ["kp_n_per_m", "ki_n_per_m_s", "kd_n_s_per_m", "target_m", "payload_kg"].includes(p.id));
const stepDecimals = (step: number) => (step.toString().split(".")[1] ?? "").length;

/** Advanced: the gain sliders (units and bounds from the scene manifest), the set height, the camera's mass, and the presets. */
export function DroneAdvanced() {
  const settings = useScene((s) => s.drone.settings);
  const setSetting = useScene((s) => s.setDroneSetting);
  const applyPreset = useScene((s) => s.applyDronePreset);
  const id = useId();
  return (
    <details className={styles.droneAdvanced}>
      <summary>Advanced: gains, set height and presets</summary>
      <div className={styles.droneButtons} role="group" aria-label="Presets">
        {DRONE_PRESETS.map((p) => (
          <Button key={p.id} onClick={() => applyPreset(p.id)}>
            {p.label}
          </Button>
        ))}
      </div>
      {ADVANCED.map((p) => {
        const v = settings[p.id] ?? p.default ?? p.min;
        return (
          <div key={p.id} className={styles.droneSlider}>
            <label htmlFor={`${id}-${p.id}`}>
              {p.label} <output htmlFor={`${id}-${p.id}`}>{`${v.toFixed(stepDecimals(p.step))} ${p.unit}`}</output>
            </label>
            <input id={`${id}-${p.id}`} type="range" min={p.min} max={p.max} step={p.step} value={v} onChange={(e) => setSetting(p.id, Number(e.target.value))} />
            <span className={styles.droneSliderBounds} aria-hidden="true">
              {p.min}–{p.max} {p.unit}
            </span>
          </div>
        );
      })}
    </details>
  );
}

/** The model's limits in words, and the visual report link marked as coming. */
export function DroneFootnote() {
  return (
    <p className={styles.droneNote}>
      Simplified teaching model: the drone moves only up and down; drag is simplified and exaggerated so the bounce dies out quickly. Not settings for a real drone. Report a problem with this visual <ComingTag />
    </p>
  );
}
