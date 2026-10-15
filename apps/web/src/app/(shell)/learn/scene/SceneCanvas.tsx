"use client";

// The 3D view. Loaded lazily (next/dynamic, no SSR) so the rest of the Learn stage is usable
// first. Renders on demand only (no continuous frames), to spare low-end phones.

import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { BackSide, PerspectiveCamera, Vector3, type Camera, type Mesh } from "three";
import { placeLabels, type LabelBox } from "@/scene/labelPlacement";
import { cornersOf, type PartLayout } from "@/scene/layout";
import { MODELS } from "@/scene/models";
import { DEFAULT_VIEW, type FillRole } from "@/scene/placeholderModel";
import { useLesson } from "@/lesson/store";
import { usePerf } from "@/scene/perfReadout";
import { useScene } from "@/scene/sceneStore";
import { JOINT, arrowSweep, servoReadout, type EqStep } from "@/scene/servoArm";
import type { SceneColors } from "./useSceneTheme";

export interface SceneCanvasProps {
  /** The stage area between the top and bottom controls: the model is framed in it, labels stay inside it. */
  safeArea: RefObject<HTMLDivElement | null>;
  /** Label elements by part ID (rendered as DOM outside the canvas). */
  labels: RefObject<Map<string, HTMLElement>>;
  colors: SceneColors;
  /** Spatial duration in ms (0 under reduced motion). */
  spatialMs: number;
  onReady: (info: { triangles: number }) => void;
  onFail: () => void;
  host: RefObject<HTMLDivElement | null>;
}

interface ControlsLike {
  target: Vector3;
  update: () => void;
}

/** Every corner the camera must keep in view for the active scene (read outside React renders). */
function framingCorners(explode: number) {
  const s = useScene.getState();
  return MODELS[s.activeScene].framing(s, explode).flatMap((l) => cornersOf(l));
}

export default function SceneCanvas(props: SceneCanvasProps) {
  const activeScene = useScene((s) => s.activeScene);
  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 1.5]}
      gl={{ antialias: true, powerPreference: "low-power" }}
      camera={{ position: DEFAULT_VIEW.position, fov: 40, near: 0.01, far: 5 }}
      role="img"
      aria-label="3D view of the placeholder model. Use the parts list to select parts."
      // A tap or click on empty space clears the selection. React Three Fiber only reports a miss
      // for a click that barely moved, so orbit drags never clear it.
      onPointerMissed={(e) => {
        if (e.type === "click") useScene.getState().select(null);
      }}
      onCreated={({ gl }) => {
        // For the testing-only readout (?demo=1): the GPU name, if the browser exposes it.
        const ctx = gl.getContext();
        const info = ctx.getExtension("WEBGL_debug_renderer_info");
        usePerf.getState().setRenderer(info ? String(ctx.getParameter(info.UNMASKED_RENDERER_WEBGL)) : null);
        gl.domElement.addEventListener("webglcontextlost", (e) => {
          e.preventDefault();
          props.onFail();
        });
      }}
    >
      <color attach="background" args={[props.colors.background]} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[0.6, 1, 0.8]} intensity={1.5} />
      <directionalLight position={[-0.6, 0.4, -0.5]} intensity={0.4} />
      {MODELS[activeScene].parts.map((p) => (
        <PartMesh key={`${activeScene}:${p.id}`} id={p.id} fill={p.fill} colors={props.colors} />
      ))}
      {activeScene === "servo-arm" && <TorqueArrow colors={props.colors} />}
      {activeScene === "servo-arm" && <EquationMarks colors={props.colors} />}
      <OrbitControls
        makeDefault
        target={DEFAULT_VIEW.target}
        enableDamping={false}
        minDistance={0.15}
        maxDistance={1.2}
        onChange={(e) => {
          const cam = (e?.target as unknown as { object?: { position: Vector3 } } | undefined)?.object;
          if (cam) writeCamera(props.host, cam);
        }}
      />
      <Framing safeArea={props.safeArea} />
      <LabelTracker safeArea={props.safeArea} labels={props.labels} host={props.host} />
      <ExplodeDriver spatialMs={props.spatialMs} host={props.host} />
      <CameraRig spatialMs={props.spatialMs} host={props.host} />
      {/* Re-mounted per scene, so each scene's triangle count is reported (and budget-tested). */}
      <ReadyProbe key={activeScene} onReady={props.onReady} />
    </Canvas>
  );
}

const OUTLINE_M = 0.003;

/** Animated state shared by the parts, labels and camera: 0 = assembled, 1 = fully exploded. */
const anim = { explode: 0 };

function PartMesh({ id, fill, colors }: { id: string; fill: FillRole; colors: SceneColors }) {
  const selected = useScene((s) => s.selectedId === id);
  const select = useScene((s) => s.select);
  const activeScene = useScene((s) => s.activeScene);
  const params = useScene((s) => s.params);
  const leverDistance_m = useScene((s) => s.leverDistance_m);
  const servo = useScene((s) => s.servo);
  const invalidate = useThree((s) => s.invalidate);
  const ref = useRef<Mesh>(null);

  useEffect(() => invalidate(), [selected, colors, params, leverDistance_m, servo, invalidate]);

  // Size depends on the scene settings; position also on the explode amount (set per frame).
  const layoutAt = (k: number) => MODELS[activeScene].layout({ params, leverDistance_m, servo }, k)[id]!;
  const { kind, size } = layoutAt(0);
  useFrame(() => {
    ref.current?.position.set(...layoutAt(anim.explode).position);
  });

  const geometry = (inflate: number) =>
    kind === "box" ? (
      <boxGeometry args={size.map((d) => d + 2 * inflate) as [number, number, number]} />
    ) : (
      <cylinderGeometry args={[size[0] + inflate, size[0] + inflate, size[1] + 2 * inflate, 24]} />
    );
  return (
    <mesh
      ref={ref}
      position={layoutAt(anim.explode).position}
      name={id}
      onClick={(e) => {
        e.stopPropagation();
        select(id);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setCursor(e.nativeEvent.target, "pointer");
      }}
      onPointerOut={(e) => setCursor(e.nativeEvent.target, "")}
    >
      {geometry(0)}
      <meshStandardMaterial color={colors.fills[fill]} roughness={0.7} metalness={0.05} />
      {selected && (
        // Selection outline: an inverted shell OUTLINE_M larger on every side, drawn from inside.
        <mesh raycast={() => null}>
          {geometry(OUTLINE_M)}
          <meshBasicMaterial color={colors.outline} side={BackSide} toneMapped={false} />
        </mesh>
      )}
    </mesh>
  );
}

/**
 * Servo + arm: a curved arrow round the joint, the direction gravity turns the arm. Its sweep follows
 * the solver's needed torque on a fixed visual scale (not a measurement). It splits in two: the
 * load's share (thick, in the load's colour) then the arm's own share (thin, in the arm's colour);
 * the margin panel names both, so the split never depends on colour alone. Not selectable.
 */
function TorqueArrow({ colors }: { colors: SceneColors }) {
  const servo = useScene((s) => s.servo);
  const equation = useScene((s) => s.equation);
  const grow = useScene((s) => s.eqGrow);
  const invalidate = useThree((s) => s.invalidate);
  const r = servoReadout(servo, null);
  useEffect(() => invalidate(), [r.torque_nm, colors, equation, grow, invalidate]);
  // While the equation is being built, the arrow appears with its steps: the load's share at
  // eq-torque, the arm's own share at eq-arm-share (each growing in as its step starts).
  const building = equation.length > 0;
  const k = (step: EqStep) => (!building ? 1 : !equation.includes(step) ? 0 : equation.at(-1) === step ? grow : 1);
  const fullSweep = arrowSweep(r.torque_nm);
  const loadSweep = (r.torque_nm > 0 ? fullSweep * (r.load_torque_nm / r.torque_nm) : 0) * k("eq-torque");
  const armSweep = (fullSweep - (r.torque_nm > 0 ? fullSweep * (r.load_torque_nm / r.torque_nm) : 0)) * k("eq-arm-share");
  const total = loadSweep + armSweep;
  if (total < 0.01) return null;
  const R = 0.032;
  const start = Math.PI / 2; // from the top, clockwise as seen from the front
  const end = start - total;
  return (
    <group position={[JOINT[0], JOINT[1], JOINT[2] + 0.008]} name="torque-arrow">
      {loadSweep > 0.01 && (
        <mesh rotation={[0, 0, start - loadSweep]} raycast={() => null}>
          <torusGeometry args={[R, 0.003, 6, 32, loadSweep]} />
          <meshBasicMaterial color={colors.fills.expressive} toneMapped={false} />
        </mesh>
      )}
      {armSweep > 0.01 && (
        <mesh rotation={[0, 0, end]} raycast={() => null}>
          <torusGeometry args={[R, 0.0016, 6, 24, armSweep]} />
          <meshBasicMaterial color={colors.fills.discovery} toneMapped={false} />
        </mesh>
      )}
      {/* The head points along the turn at the arrow's end. */}
      <mesh position={[R * Math.cos(end), R * Math.sin(end), 0]} rotation={[0, 0, end + Math.PI]} raycast={() => null}>
        <coneGeometry args={[0.006, 0.012, 12]} />
        <meshBasicMaterial color={colors.outline} toneMapped={false} />
      </mesh>
    </group>
  );
}

/**
 * The equation's marks on the servo + arm (M4 slice B): the load's weight as a downward arrow, the
 * distance from the joint as a line along the arm with end ticks, and the arm's own weight as a
 * thinner arrow at its middle. Each appears with its step and grows in (at once under reduced
 * motion). Drawing sizes only: the numbers are in the labels, from the solver. Not selectable.
 */
function EquationMarks({ colors }: { colors: SceneColors }) {
  const servo = useScene((s) => s.servo);
  const equation = useScene((s) => s.equation);
  const grow = useScene((s) => s.eqGrow);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => invalidate(), [servo, equation, grow, colors, invalidate]);
  const k = (step: EqStep) => (!equation.includes(step) ? 0 : equation.at(-1) === step ? grow : 1);
  const [, jy, jz] = JOINT;
  const d = Math.min(servo.arm_length_m, servo.load_distance_m);
  const z = jz + 0.012;
  const arrow = (x: number, top: number, len: number, r: number, color: string, name: string) =>
    len > 0.001 && (
      <group name={name}>
        <mesh position={[x, top - len / 2, z]} raycast={() => null}>
          <cylinderGeometry args={[r, r, len, 8]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
        <mesh position={[x, top - len - 0.004, z]} rotation={[Math.PI, 0, 0]} raycast={() => null}>
          <coneGeometry args={[r * 2.6, 0.008, 10]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
      </group>
    );
  const kd = k("eq-distance");
  return (
    <group name="equation-marks">
      {arrow(d, jy - 0.006, 0.03 * k("eq-force"), 0.0018, colors.outline, "eq-force")}
      {kd > 0 && (
        <group name="eq-distance">
          <mesh position={[(d * kd) / 2, jy - 0.016, z]} raycast={() => null}>
            <boxGeometry args={[d * kd, 0.0012, 0.0012]} />
            <meshBasicMaterial color={colors.outline} toneMapped={false} />
          </mesh>
          {[0, d * kd].map((x) => (
            <mesh key={x} position={[x, jy - 0.016, z]} raycast={() => null}>
              <boxGeometry args={[0.0012, 0.008, 0.0012]} />
              <meshBasicMaterial color={colors.outline} toneMapped={false} />
            </mesh>
          ))}
        </group>
      )}
      {arrow(servo.arm_length_m / 2, jy - 0.006, 0.02 * k("eq-arm-share"), 0.0012, colors.fills.discovery, "eq-arm-share")}
    </group>
  );
}

function setCursor(target: EventTarget | null, cursor: string) {
  if (target instanceof HTMLElement) target.style.cursor = cursor;
}

// Camera framing: fit the model's current bounds (they change with the arm length and the
// explode) inside the safe area, width and height separately (the model is wide and flat).
const MARGIN = 1.06;
const defaultDir = new Vector3(...DEFAULT_VIEW.position).sub(new Vector3(...DEFAULT_VIEW.target)).normalize();
/** Last known screen shape, kept by Framing. */
const frame = { fov: 40, canvasH: 1, areaW: 1, areaH: 1 };

const worldUp = new Vector3(0, 1, 0);
const right = new Vector3();
const up = new Vector3();
const offset = new Vector3();

/**
 * Where the camera and orbit target should go to frame the model from direction `dir`: the
 * smallest distance at which every part corner, seen through this camera, falls inside the free
 * area (exact for a pinhole camera aimed at the model's centre), plus a small margin.
 */
function fitGoal(dir: Vector3, explode: number) {
  const corners = framingCorners(explode);
  const lo = [0, 1, 2].map((i) => Math.min(...corners.map((c) => c[i]!)));
  const hi = [0, 1, 2].map((i) => Math.max(...corners.map((c) => c[i]!)));
  const target = new Vector3((lo[0]! + hi[0]!) / 2, (lo[1]! + hi[1]!) / 2, (lo[2]! + hi[2]!) / 2);
  const tanHalf = Math.tan((frame.fov * Math.PI) / 360);
  const tanV = tanHalf * (frame.areaH / frame.canvasH);
  const tanH = tanHalf * (frame.areaW / frame.canvasH);
  right.crossVectors(worldUp, dir).normalize(); // camera's right, seen from `dir`
  up.crossVectors(dir, right).normalize();
  let distance = 0;
  for (const c of corners) {
    offset.set(...c).sub(target);
    const towardCamera = offset.dot(dir);
    distance = Math.max(distance, towardCamera + Math.abs(offset.dot(right)) / tanH, towardCamera + Math.abs(offset.dot(up)) / tanV);
  }
  return { target, position: target.clone().addScaledVector(dir, distance * MARGIN) };
}

/**
 * Centres the model in the free part of the safe area (not the whole stage, and not under the
 * inspector) by shifting the projection, and records the free area for camera fitting. The first
 * pass also places the camera. The inspector sits to the right from 900 px, at the bottom below.
 */
function Framing({ safeArea }: { safeArea: RefObject<HTMLDivElement | null> }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null;
  const inspectorShown = useScene((s) => s.inspectorOpen && s.selectedId !== null);
  const gaugeShown = useLesson((s) => s.gauge);
  const marginShown = useScene((s) => s.activeScene === "servo-arm" && !s.inspectorOpen);
  const reserveKey = `${inspectorShown}|${gaugeShown}|${marginShown}`;
  const placed = useRef(false);
  const lastReserve = useRef(reserveKey);

  useLayoutEffect(() => {
    const el = safeArea.current;
    if (!el || !(camera instanceof PerspectiveCamera)) return;
    // Panels inside the safe area that the model must stay clear of: the inspector (right from
    // 900 px, bottom below; data-reserve="auto"), the servo + arm's torque panel (the same) and the
    // effort gauge (bottom; data-reserve="bottom").
    const reserved = () => Array.from(el.querySelectorAll<HTMLElement>("[data-reserve]"));
    const apply = () => {
      const { takeW, takeH } = reservedSpace(el);
      const freeW = el.clientWidth - takeW;
      const freeH = el.clientHeight - takeH;
      const shiftX = el.offsetLeft + freeW / 2 - size.width / 2;
      const shiftY = el.offsetTop + freeH / 2 - size.height / 2;
      camera.setViewOffset(size.width, size.height, -shiftX, -shiftY, size.width, size.height);
      Object.assign(frame, { fov: camera.fov, canvasH: size.height, areaW: freeW, areaH: freeH });
      // If the free area shrank (a caption appeared, the screen is zoomed) and the model no longer
      // fits in it, refit from the current direction. A model that still fits is left alone.
      if (placed.current && !modelFits(camera, size, { x: el.offsetLeft, y: el.offsetTop, w: freeW, h: freeH })) refitCamera.current?.();
      if (!placed.current) {
        placed.current = true;
        const g = fitGoal(defaultDir, anim.explode);
        camera.position.copy(g.position);
        camera.lookAt(g.target);
        controls?.target.copy(g.target);
        controls?.update();
      }
      invalidate();
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    // The inspector is rendered by the page, outside this 3D tree: re-measure on the next frame.
    const raf = requestAnimationFrame(() => {
      for (const r of reserved()) ro.observe(r);
      apply();
      // The free area changed size: refit the camera to it, keeping the viewing direction.
      if (placed.current && lastReserve.current !== reserveKey) refitCamera.current?.();
      lastReserve.current = reserveKey;
    });
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      camera.clearViewOffset();
    };
  }, [camera, size, safeArea, invalidate, controls, reserveKey]);
  return null;
}

const v = new Vector3();
const PAD = 6;

/**
 * Places each DOM label over its part, then clamps it inside the safe area, so labels can never
 * cover the voice orb, captions or controls. Runs only when a frame renders.
 */
function LabelTracker({
  safeArea,
  labels,
  host,
}: {
  safeArea: RefObject<HTMLDivElement | null>;
  labels: RefObject<Map<string, HTMLElement>>;
  host: RefObject<HTMLDivElement | null>;
}) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const labelsOn = useScene((s) => s.labelsOn);
  const selectedId = useScene((s) => s.selectedId);
  const activeScene = useScene((s) => s.activeScene);
  const params = useScene((s) => s.params);
  const leverDistance_m = useScene((s) => s.leverDistance_m);
  const servo = useScene((s) => s.servo);

  // Shown or renamed labels change size, and settings move parts: render a frame to re-place them.
  const equation = useScene((s) => s.equation);
  useEffect(() => invalidate(), [labelsOn, selectedId, params, leverDistance_m, servo, activeScene, equation, invalidate]);

  useFrame(() => {
    const area = safeArea.current;
    if (!area) return;
    // Labels stay inside the same free area the framing uses: clear of the inspector, the torque
    // panel and the effort gauge (found by the equation's overlap check at the slider extremes).
    const { takeW, takeH } = reservedSpace(area);
    const w = area.clientWidth - takeW;
    const h = area.clientHeight - takeH;
    const layout = MODELS[activeScene].layout({ params, leverDistance_m, servo }, anim.explode);
    writeData(host, "modelBox", projectedBox(layout, camera, size));
    // 1. Where each shown label wants to go (clamped inside the safe area).
    const wanted: LabelBox[] = [];
    for (const part of MODELS[activeScene].parts) {
      const el = labels.current.get(part.id);
      if (!el) continue;
      v.set(...layout[part.id]!.labelAnchor).project(camera);
      const sx = ((v.x + 1) / 2) * size.width;
      const sy = ((1 - v.y) / 2) * size.height;
      // For tests: where the part's anchor is on the canvas, before clamping.
      el.dataset.x = sx.toFixed(1);
      el.dataset.y = sy.toFixed(1);
      const lw = el.offsetWidth;
      const lh = el.offsetHeight;
      if (v.z > 1 || lw === 0) {
        el.style.visibility = "hidden";
        continue;
      }
      wanted.push({
        id: part.id,
        x: Math.min(Math.max(sx - area.offsetLeft - lw / 2, PAD), Math.max(PAD, w - lw - PAD)),
        y: Math.min(Math.max(sy - area.offsetTop - lh - 10, PAD), Math.max(PAD, h - lh - PAD)),
        w: lw,
        h: lh,
        priority: part.id === selectedId ? 10 : 0,
      });
    }
    // Labels that are not parts (the equation's steps), placed the same way; the latest step wins space.
    const extra = MODELS[activeScene].extraAnchors?.({ params, leverDistance_m, servo }) ?? {};
    const latest = useScene.getState().equation.at(-1);
    for (const [id, anchor] of Object.entries(extra)) {
      const el = labels.current.get(id);
      if (!el) continue;
      v.set(...anchor).project(camera);
      const sx = ((v.x + 1) / 2) * size.width;
      const sy = ((1 - v.y) / 2) * size.height;
      const lw = el.offsetWidth;
      const lh = el.offsetHeight;
      if (v.z > 1 || lw === 0) {
        el.style.visibility = "hidden";
        continue;
      }
      wanted.push({
        id,
        x: Math.min(Math.max(sx - area.offsetLeft - lw / 2, PAD), Math.max(PAD, w - lw - PAD)),
        y: Math.min(Math.max(sy - area.offsetTop - lh / 2, PAD), Math.max(PAD, h - lh - PAD)),
        w: lw,
        h: lh,
        priority: id === latest ? 9 : 1,
      });
    }
    // 2. Resolve collisions: the selected label stays put; others move aside or hide.
    for (const p of placeLabels(wanted, { w, h }, PAD)) {
      const el = labels.current.get(p.id)!;
      el.style.visibility = p.hidden ? "hidden" : "";
      el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
    }
  });
  return null;
}

/**
 * Room taken by panels inside the safe area: from 900 px a data-reserve="auto" panel takes the right
 * side, otherwise any reserved panel takes the bottom. Shared by the framing and the labels.
 */
function reservedSpace(area: HTMLElement): { takeW: number; takeH: number } {
  const side = window.matchMedia("(min-width: 900px)").matches; // matches learn.module.css
  let takeW = 0;
  let takeH = 0;
  for (const r of Array.from(area.querySelectorAll<HTMLElement>("[data-reserve]"))) {
    if (r.dataset.reserve === "auto" && side) takeW = Math.max(takeW, r.offsetWidth + 16);
    else takeH = Math.max(takeH, r.offsetHeight + 16);
  }
  return { takeW, takeH };
}

/** True when every framing corner of the model, on screen, lies inside the free area (canvas px). */
function modelFits(camera: Camera, size: { width: number; height: number }, area: { x: number; y: number; w: number; h: number }) {
  camera.updateMatrixWorld();
  for (const c of framingCorners(anim.explode)) {
    v.set(...c).project(camera);
    const x = ((v.x + 1) / 2) * size.width;
    const y = ((1 - v.y) / 2) * size.height;
    if (x < area.x - 1 || x > area.x + area.w + 1 || y < area.y - 1 || y > area.y + area.h + 1) return false;
  }
  return true;
}

/** On-screen box (canvas pixels) around every part's corners: "x0,y0,x1,y1". For tests. */
function projectedBox(layout: Record<string, PartLayout>, camera: Camera, size: { width: number; height: number }) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of Object.values(layout)) {
    const h = p.kind === "cylinder" ? [p.size[0], p.size[1] / 2, p.size[0]] : p.size.map((d) => d / 2);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      v.set(p.position[0] + sx * h[0]!, p.position[1] + sy * h[1]!, p.position[2] + sz * h[2]!).project(camera);
      const x = ((v.x + 1) / 2) * size.width;
      const y = ((1 - v.y) / 2) * size.height;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
  }
  return [x0, y0, x1, y1].map((n) => n.toFixed(1)).join(",");
}

/** Mirrors the camera position (metres) onto the host element, for tests and debugging. */
function writeCamera(host: RefObject<HTMLDivElement | null>, camera: { position: Vector3 }) {
  if (host.current) host.current.dataset.camera = camera.position.toArray().map((n) => n.toFixed(3)).join(",");
}

function writeData(host: RefObject<HTMLDivElement | null>, key: string, value: string) {
  if (host.current) host.current.dataset[key] = value;
}

/** Moves parts apart (or back) over the spatial duration; cuts when it is 0 (reduced motion). */
function ExplodeDriver({ spatialMs, host }: { spatialMs: number; host: RefObject<HTMLDivElement | null> }) {
  const exploded = useScene((s) => s.exploded);
  const invalidate = useThree((s) => s.invalidate);
  const tween = useRef<{ from: number; to: number; t0: number; ms: number } | null>(null);

  useEffect(() => {
    const to = exploded ? 1 : 0;
    if (spatialMs <= 0) {
      tween.current = null;
      anim.explode = to;
      writeData(host, "explode", to.toFixed(3));
    } else {
      tween.current = { from: anim.explode, to, t0: performance.now(), ms: spatialMs };
    }
    invalidate();
  }, [exploded, spatialMs, host, invalidate]);

  useFrame(() => {
    const tw = tween.current;
    if (!tw) return;
    const k = Math.min(1, (performance.now() - tw.t0) / tw.ms);
    anim.explode = tw.from + (tw.to - tw.from) * (1 - Math.pow(1 - k, 3));
    writeData(host, "explode", anim.explode.toFixed(3));
    if (k < 1) invalidate();
    else tween.current = null;
  });
  return null;
}

const start = { pos: new Vector3(), target: new Vector3() };
const goal = { pos: new Vector3(), target: new Vector3() };
const dir = new Vector3();
/** Set by CameraRig: refit to the current free area from the current direction (tweened). */
const refitCamera: { current: (() => void) | null } = { current: null };

/**
 * Camera moves: "Reset view" returns to the default direction; exploding or assembling keeps the
 * current direction but re-frames the model so nothing leaves the view. Tweens over the spatial
 * duration, or cuts when it is 0 (reduced motion).
 */
function CameraRig({ spatialMs, host }: { spatialMs: number; host: RefObject<HTMLDivElement | null> }) {
  const resetToken = useScene((s) => s.resetToken);
  const exploded = useScene((s) => s.exploded);
  const activeScene = useScene((s) => s.activeScene);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null;
  const invalidate = useThree((s) => s.invalidate);
  const tween = useRef<{ t0: number; ms: number } | null>(null);
  const seen = useRef({ resetToken, exploded, activeScene });

  useEffect(() => writeCamera(host, camera), [camera, host]);

  useEffect(() => {
    const moveTo = (fromDefault: boolean) => {
      if (!controls) return;
      const d = fromDefault ? defaultDir : dir.copy(camera.position).sub(controls.target).normalize();
      const g = fitGoal(d, useScene.getState().exploded ? 1 : 0);
      goal.pos.copy(g.position);
      goal.target.copy(g.target);
      if (spatialMs <= 0) {
        camera.position.copy(goal.pos);
        controls.target.copy(goal.target);
        controls.update();
        writeCamera(host, camera);
        invalidate();
        return;
      }
      start.pos.copy(camera.position);
      start.target.copy(controls.target);
      tween.current = { t0: performance.now(), ms: spatialMs };
      invalidate();
    };
    refitCamera.current = () => moveTo(false);

    const prev = seen.current;
    seen.current = { resetToken, exploded, activeScene };
    // Reset or a new scene: frame from the default direction. Explode: keep the current direction.
    const fromDefault = prev.resetToken !== resetToken || prev.activeScene !== activeScene;
    if (fromDefault || prev.exploded !== exploded) moveTo(fromDefault);
    return () => {
      refitCamera.current = null;
    };
  }, [resetToken, exploded, activeScene, spatialMs, camera, controls, host, invalidate]);

  useFrame(() => {
    const tw = tween.current;
    if (!tw || !controls) return;
    const k = Math.min(1, (performance.now() - tw.t0) / tw.ms);
    const e = 1 - Math.pow(1 - k, 3); // ease-out
    camera.position.lerpVectors(start.pos, goal.pos, e);
    controls.target.lerpVectors(start.target, goal.target, e);
    controls.update();
    writeCamera(host, camera);
    if (k < 1) invalidate();
    else tween.current = null;
  });
  return null;
}

/** Reports the scene's triangle count once the first frame has rendered. */
function ReadyProbe({ onReady }: { onReady: (info: { triangles: number }) => void }) {
  const gl = useThree((s) => s.gl);
  const done = useRef(false);
  useFrame(() => {
    if (done.current) return;
    done.current = true;
    // info is read after this frame renders
    requestAnimationFrame(() => onReady({ triangles: gl.info.render.triangles }));
  });
  return null;
}
