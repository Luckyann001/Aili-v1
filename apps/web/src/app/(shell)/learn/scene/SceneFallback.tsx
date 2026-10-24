"use client";

import { BAG_REACH, LEVER_LENGTH_M } from "@/scene/layout";
import { MODELS } from "@/scene/models";
import { useScene } from "@/scene/sceneStore";
import { JOINT, layoutServoArm, SERVO_PARTS, type ServoParams } from "@/scene/servoArm";
import styles from "../learn.module.css";

// Still side views used when WebGL is unavailable or fails. Same parts, same selection.
type Shape = {
  x: number;
  y: number;
  w: number;
  h: number;
  label: [number, number];
  /** Label text alignment (default: centred on the label point). */
  anchor?: "start" | "middle";
  /** A leader line from the label to the part. */
  leader?: [number, number, number, number];
  /** Hidden inside the assembled model: drawn as a dashed outline. */
  inside?: boolean;
  /** Named only when selected (a part with many twins, like the drone's arms, would crowd the picture). */
  quiet?: boolean;
};

const ARM: Record<string, Shape> = {
  base: { x: 20, y: 150, w: 120, h: 20, label: [80, 190] },
  servo: { x: 58, y: 90, w: 44, h: 60, label: [80, 80] },
  arm: { x: 80, y: 82, w: 190, h: 12, label: [175, 72] },
  "end-weight": { x: 262, y: 70, w: 36, h: 36, label: [280, 128] },
};

function lever(distance_m: number): Record<string, Shape> {
  const wx = 50 + (distance_m / LEVER_LENGTH_M) * 240; // ruler runs from x 50 to 290
  return {
    hand: { x: 20, y: 95, w: 30, h: 40, label: [35, 150] },
    ruler: { x: 50, y: 110, w: 240, h: 8, label: [200, 140] },
    weight: { x: wx - 14, y: 82, w: 28, h: 28, label: [wx, 72] },
  };
}

/** Bag held out, side view: the shoulder at x 40, the reach scaled so the longest fills the picture. */
function bagHold(reach_m: number): Record<string, Shape> {
  const r = Math.min(BAG_REACH.max, Math.max(BAG_REACH.min, reach_m));
  const hx = 60 + (r / BAG_REACH.max) * 200; // the hand's x: 60 at no reach, 260 at the longest
  return {
    shoulder: { x: 30, y: 60, w: 30, h: 40, label: [45, 50] },
    arm: { x: 60, y: 72, w: hx - 60, h: 14, label: [(60 + hx) / 2, 104] },
    hand: { x: hx - 10, y: 70, w: 20, h: 18, label: [hx, 62] },
    bag: { x: hx - 22, y: 112, w: 44, h: 50, label: [hx, 178] },
  };
}

// Servo + arm, front view. The main drawing is to true scale (520 px per metre, joint at MAIN): the
// micro servo is only a few pixels across there, so its parts are labelled in an inset enlarged 4×.
const MAIN = { x: 150, y: 64, scale: 520 };
const INSET = { x: 36, y: 132, scale: 520 * 4, frame: { x: 8, y: 104, w: 304, h: 92 } };

function servoArm(p: ServoParams): Record<string, Shape> {
  const l = layoutServoArm(p);
  const box = (id: string, v: { x: number; y: number; scale: number }) => {
    const { size, position } = l[id]!;
    const w = Math.max(size[0] * v.scale, 1);
    const h = Math.max(size[1] * v.scale, 3);
    return { x: v.x + (position[0] - JOINT[0]) * v.scale - w / 2, y: v.y - (position[1] - JOINT[1]) * v.scale - h / 2, w, h };
  };
  const arm = box("arm-link", MAIN);
  const load = box("load", MAIN);
  const base = box("base", MAIN);
  const shapes: Record<string, Shape> = {
    base: { ...base, label: [base.x + base.w / 2, base.y + base.h + 14] },
    "arm-link": { ...arm, label: [arm.x + arm.w * 0.6, arm.y + arm.h + 14] },
    load: { ...load, label: [load.x + load.w / 2, load.y - 6] },
  };
  // The inset: one row per part, the label to the right with a leader line to the part.
  SERVO_PARTS.forEach((part, i) => {
    const b = box(part.id, INSET);
    const ly = INSET.frame.y + 22 + i * 15;
    shapes[part.id] = { ...b, label: [72, ly], anchor: "start", leader: [70, ly - 4, b.x + b.w / 2, b.y + b.h / 2], inside: part.id === "gear-train" || part.id === "motor-and-sensor" };
  });
  return shapes;
}

/** The servo at true scale in the main drawing (not a part: its parts are in the inset), and the inset's frame. */
function ServoDecor({ servo }: { servo: ServoParams }) {
  const l = layoutServoArm(servo);
  const at = (id: string) => {
    const { size, position } = l[id]!;
    return { x: MAIN.x + (position[0] - JOINT[0]) * MAIN.scale - (size[0] * MAIN.scale) / 2, y: MAIN.y - (position[1] - JOINT[1]) * MAIN.scale - (size[1] * MAIN.scale) / 2, w: size[0] * MAIN.scale, h: size[1] * MAIN.scale };
  };
  const c = at("upper-case");
  const h = at("horn");
  const f = INSET.frame;
  return (
    <g aria-hidden="true">
      <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={1} className={styles.fill_technical} strokeWidth={0.6} />
      <rect x={h.x} y={h.y} width={h.w} height={h.h} className={styles.fill_expressive} strokeWidth={0.6} />
      <rect x={f.x} y={f.y} width={f.w} height={f.h} rx={4} fill="none" strokeDasharray="3 3" strokeWidth={0.8} />
      <text x={f.x + f.w - 6} y={f.y + 12} textAnchor="end" className={styles.fallbackText}>
        Servo, enlarged 4×
      </text>
      <line x1={c.x + c.w / 2} y1={c.y + c.h} x2={f.x + 40} y2={f.y} strokeDasharray="2 2" strokeWidth={0.6} className={styles.fallbackLeader} />
    </g>
  );
}

/**
 * The drone, side view, NOT to scale (it would be a few pixels across next to a metres-tall mast): it rests
 * on its stand; the arms, motors and propellers pointing at and away from you are dashed behind the body.
 */
function droneSide(): Record<string, Shape> {
  const s: Record<string, Shape> = {
    body: { x: 149, y: 135, w: 42, h: 15, label: [170, 175] },
    "arm-1": { x: 191, y: 139, w: 42, h: 6, label: [212, 160], quiet: true },
    "arm-3": { x: 107, y: 139, w: 42, h: 6, label: [128, 160], quiet: true },
    "motor-1": { x: 227, y: 130, w: 11, h: 9, label: [250, 128], anchor: "start" },
    "motor-3": { x: 102, y: 130, w: 11, h: 9, label: [107, 160], quiet: true },
    "rotor-1": { x: 203, y: 124, w: 60, h: 3, label: [233, 116] },
    "rotor-3": { x: 78, y: 124, w: 60, h: 3, label: [108, 116], quiet: true },
    "sensor-altitude": { x: 180, y: 150, w: 9, h: 6, label: [200, 190], leader: [196, 184, 186, 157] },
    battery: { x: 155, y: 126, w: 30, h: 9, label: [170, 104], leader: [170, 107, 170, 126] },
    "payload-camera": { x: 186, y: 140, w: 12, h: 12, label: [240, 150], anchor: "start" },
  };
  for (const n of [2, 4]) {
    s[`arm-${n}`] = { x: 167, y: 139, w: 6, h: 6, label: [170, 160], inside: true, quiet: true };
    s[`motor-${n}`] = { x: 165, y: 130, w: 11, h: 9, label: [170, 128], inside: true, quiet: true };
    s[`rotor-${n}`] = { x: 167, y: 124, w: 6, h: 3, label: [170, 120], inside: true, quiet: true };
  }
  return s;
}

/** The cruise-control analogy, side view (not to scale): the car on the flat road before the hill. */
function cruiseSide(): Record<string, Shape> {
  return {
    road: { x: 20, y: 150, w: 130, h: 6, label: [85, 172] },
    hill: { x: 150, y: 110, w: 150, h: 6, label: [225, 100] },
    car: { x: 60, y: 126, w: 50, h: 14, label: [85, 116] },
    cab: { x: 68, y: 116, w: 26, h: 10, label: [81, 108], quiet: true },
    "wheel-1": { x: 98, y: 140, w: 8, h: 8, label: [102, 160], quiet: true },
    "wheel-2": { x: 64, y: 140, w: 8, h: 8, label: [68, 160], quiet: true },
    "wheel-3": { x: 100, y: 140, w: 6, h: 6, label: [103, 160], inside: true, quiet: true },
    "wheel-4": { x: 66, y: 140, w: 6, h: 6, label: [69, 160], inside: true, quiet: true },
  };
}

/** The stand behind the drone: plate, guide post, and the mast with the set-height collar (not to scale). */
function DroneStandDecor() {
  return (
    <g aria-hidden="true">
      <rect x={30} y={156} width={270} height={6} className={styles.fill_technical} fillOpacity={0.35} />
      <line x1={170} y1={14} x2={170} y2={156} className={styles.fallbackLeader} strokeWidth={2} />
      <rect x={30} y={14} width={8} height={142} className={styles.fallbackMast} />
      <rect x={26} y={40} width={16} height={5} rx={2} className={styles.fallbackCollar} />
      <text x={46} y={44} className={styles.fallbackText}>
        Set height (not to scale)
      </text>
    </g>
  );
}

/** Drawing order for the servo + arm: what is behind first, the horn and arm on top. */
const SERVO_ORDER = ["base", "board-and-cover", "upper-case", "gear-train", "motor-and-sensor", "horn", "arm-link", "load"];

/** `loading`: shown while the 3D code downloads, then replaced by the 3D view in the same place. */
export function SceneFallback({ loading = false }: { loading?: boolean }) {
  const selectedId = useScene((s) => s.selectedId);
  const activeScene = useScene((s) => s.activeScene);
  const distance = useScene((s) => s.leverDistance_m);
  const servo = useScene((s) => s.servo);
  const bagReach = useScene((s) => s.bagReach_m);
  const drone = useScene((s) => s.drone);
  const model = MODELS[activeScene];
  const shapes =
    activeScene === "lever-analogy" ? lever(distance) : activeScene === "servo-arm" ? servoArm(servo) : activeScene === "bag-hold" ? bagHold(bagReach) : activeScene === "drone-altitude" ? droneSide() : activeScene === "cruise-control-hill" ? cruiseSide() : ARM;
  const hidden = model.hidden?.({ ...useScene.getState(), drone }) ?? new Set<string>();
  const names = model.parts.map((p) => p.name.toLowerCase()).join(", ");
  const parts = (activeScene === "servo-arm" ? SERVO_ORDER.map((id) => model.parts.find((p) => p.id === id)!) : model.parts).filter((p) => !hidden.has(p.id));
  return (
    <div className={styles.fallback} data-fallback={loading ? "loading" : "no-webgl"}>
      <p className={styles.fallbackNote}>
        {loading
          ? "Loading the 3D view… here is a still picture of the parts meanwhile."
          : "3D view isn't available on this device, so here is a still picture of the parts."}
      </p>
      <svg viewBox="0 0 320 200" className={styles.fallbackSvg} role="img" aria-label={`Still side view of the ${model.title.toLowerCase()}: ${names}.`}>
        {activeScene === "servo-arm" && <ServoDecor servo={servo} />}
        {activeScene === "drone-altitude" && <DroneStandDecor />}
        {parts.map(({ id, name, fill }) => {
          const s = shapes[id]!;
          const selected = selectedId === id;
          return (
            <g key={id} data-part-id={id}>
              <rect
                x={s.x}
                y={s.y}
                width={s.w}
                height={s.h}
                rx={Math.min(3, s.w / 4)}
                className={s.inside ? undefined : styles[`fill_${fill}`]}
                fill={s.inside ? "none" : undefined}
                strokeDasharray={s.inside ? "2 1.5" : undefined}
                strokeWidth={selected ? 3 : 1}
              />
              {s.leader && <line x1={s.leader[0]} y1={s.leader[1]} x2={s.leader[2]} y2={s.leader[3]} className={styles.fallbackLeader} strokeWidth={selected ? 1.5 : 0.75} />}
              {(!s.quiet || selected) && (
                <text x={s.label[0]} y={s.label[1]} textAnchor={s.anchor ?? "middle"} className={styles.fallbackText} fontWeight={selected ? 700 : 400}>
                  {selected ? `Selected: ${name}` : name}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
