"use client";

// The 3D view. Loaded lazily (next/dynamic, no SSR) so the rest of the Learn stage is usable
// first. Renders on demand only (no continuous frames), to spare low-end phones.

import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useLoader, useThree, type ThreeEvent } from "@react-three/fiber";
import { Component, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { BackSide, BufferGeometry, EdgesGeometry, Euler, Float32BufferAttribute, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, PerspectiveCamera, Vector3, type Camera, type Material, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { placeLabels, type LabelBox } from "@/scene/labelPlacement";
import { cornersOf, type PartLayout } from "@/scene/layout";
import { MODELS } from "@/scene/models";
import { DEFAULT_VIEW, type FillRole } from "@/scene/placeholderModel";
import { useLesson } from "@/lesson/store";
import { usePerf } from "@/scene/perfReadout";
import { partOffsetGltf, settled } from "@/scene/assetPose";
import { servoPoseOf, useScene } from "@/scene/sceneStore";
import { HORN_TURN_RAD, JOINT, SERVO_GLB_URL, SERVO_ORIGIN, SERVO_PARTS, SERVO_POSE_MANIFEST, SERVO_ROTATION, SERVO_ROTATION_ORDER, arrowSweep, layoutServoParts, servoReadout, type EqStep } from "@/scene/servoArm";
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
  // Anatomy view: only the servo's parts, as they will be once settled.
  if (s.cameraView === "anatomy" && s.activeScene === "servo-arm") return cornersOf(layoutServoParts(settled(s.servoView)));
  return MODELS[s.activeScene].framing(s, explode).flatMap((l) => cornersOf(l));
}

/** Servo + arm: the arm, load and arrows are dimmed while the servo is open or exploded (their numbers never change). */
const useServoAway = () => useScene((s) => s.activeScene === "servo-arm" && s.servoView !== "assembled");
const DIM_OPACITY = 0.22;
// (Dimmed materials are re-created, keyed on the dim state: three only applies a change of `transparent` to a new material.)

export default function SceneCanvas(props: SceneCanvasProps) {
  const activeScene = useScene((s) => s.activeScene);
  // Parts drawn from a GLB asset (the servo + arm's micro servo) load lazily; the rest are primitives.
  const kinds = MODELS[activeScene].layout(useScene.getState(), 0);
  const parts = MODELS[activeScene].parts;
  const assetParts = parts.filter((p) => kinds[p.id]!.kind === "asset");
  // Which scene's asset has loaded (the triangle count is reported again once it has).
  const [assetFor, setAssetFor] = useState<string | null>(null);
  const assetState = assetParts.length === 0 ? "none" : assetFor === activeScene ? "loaded" : "loading";
  // For tests: none, loading, loaded (or failed, written by the boundary).
  useEffect(() => writeData(props.host, "asset", assetState), [assetState, props.host]);
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
      {parts
        .filter((p) => kinds[p.id]!.kind !== "asset")
        .map((p) => (
          <PartMesh key={`${activeScene}:${p.id}`} id={p.id} fill={p.fill} colors={props.colors} />
        ))}
      {assetParts.length > 0 && (
        // While the GLB loads, or if it fails, the servo is the plain box it used to be: never a blank stage.
        <AssetBoundary key={activeScene} fallback={<ServoPlaceholder colors={props.colors} />} onError={() => writeData(props.host, "asset", "failed")}>
          <Suspense fallback={<ServoPlaceholder colors={props.colors} />}>
            <ServoAsset colors={props.colors} onLoaded={() => setAssetFor(activeScene)} />
          </Suspense>
        </AssetBoundary>
      )}
      {activeScene === "servo-arm" && <TorqueArrow colors={props.colors} />}
      {activeScene === "servo-arm" && props.spatialMs <= 0 && <OffsetLines colors={props.colors} />}
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
      <ReadyProbe key={`${activeScene}:${assetState}`} onReady={props.onReady} />
      {activeScene === "servo-arm" && <ServoProbe host={props.host} reducedMotion={props.spatialMs <= 0} />}
    </Canvas>
  );
}

const OUTLINE_M = 0.003;
const ASSET_OUTLINE_M = 0.0008;

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
  const dim = useServoAway() && (id === "arm-link" || id === "load");

  useEffect(() => invalidate(), [selected, colors, params, leverDistance_m, servo, dim, invalidate]);

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
      {...partEvents(id, select)}
    >
      {geometry(0)}
      <meshStandardMaterial key={dim ? "dim" : "solid"} color={colors.fills[fill]} roughness={0.7} metalness={0.05} transparent={dim} opacity={dim ? DIM_OPACITY : 1} depthWrite={!dim} />
      {/* Dimmed (the servo open or exploded), a selected arm or load keeps only its label, not the dark shell. */}
      {selected && !dim && (
        // Selection outline: an inverted shell OUTLINE_M larger on every side, drawn from inside.
        <mesh raycast={() => null}>
          {geometry(OUTLINE_M)}
          <meshBasicMaterial color={colors.outline} side={BackSide} toneMapped={false} />
        </mesh>
      )}
    </mesh>
  );
}

/** Click and hover handlers shared by every selectable part. */
function partEvents(id: string, select: (id: string) => void) {
  return {
    onClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      select(id);
    },
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      setCursor(e.nativeEvent.target, "pointer");
    },
    onPointerOut: (e: ThreeEvent<PointerEvent>) => setCursor(e.nativeEvent.target, ""),
  };
}

/** Keeps the last valid state when an asset fails to load: its fallback (the placeholder) stays. */
class AssetBoundary extends Component<{ fallback: ReactNode; onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const servoEuler = new Euler(...SERVO_ROTATION, SERVO_ROTATION_ORDER);

/** The box the servo was before the asset: its assembled extent, plain, not selectable. */
function ServoPlaceholder({ colors }: { colors: SceneColors }) {
  const servo = useScene((s) => s.servo);
  const box = useMemo(() => {
    const l = MODELS["servo-arm"].layout({ ...useScene.getState(), servo }, 0);
    const lo = [0, 1, 2].map((i) => Math.min(...SERVO_PARTS.map((p) => l[p.id]!.position[i]! - l[p.id]!.size[i]! / 2)));
    const hi = [0, 1, 2].map((i) => Math.max(...SERVO_PARTS.map((p) => l[p.id]!.position[i]! + l[p.id]!.size[i]! / 2)));
    return { size: hi.map((h, i) => h - lo[i]!) as [number, number, number], position: hi.map((h, i) => (h + lo[i]!) / 2) as [number, number, number] };
  }, [servo]);
  return (
    <mesh position={box.position} name="servo-placeholder" raycast={() => null}>
      <boxGeometry args={box.size} />
      <meshStandardMaterial color={colors.fills.technical} roughness={0.7} metalness={0.05} />
    </mesh>
  );
}

/**
 * The generic micro servo (asset.servo-generic-anatomy): one GLB, loaded on first use, each node a
 * selectable part with the GLB's own materials. Posed by SERVO_ORIGIN / SERVO_ROTATION; the horn is
 * turned about the shaft so the arm lies along it.
 */
function ServoAsset({ colors, onLoaded }: { colors: SceneColors; onLoaded: () => void }) {
  const gltf = useLoader(GLTFLoader, SERVO_GLB_URL);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    onLoaded();
    invalidate();
  }, [onLoaded, invalidate]);
  const from = useScene((s) => s.servoFrom);
  const to = useScene((s) => s.servoView);
  const k = useScene((s) => s.servoMotion);
  const pose = useMemo(() => servoPoseOf({ servoFrom: from, servoView: to, servoMotion: k }), [from, to, k]);
  useEffect(() => invalidate(), [pose.from, pose.to, pose.k, invalidate]);
  // A part inside the case, picked while the servo is assembled: the case turns see-through (no auto-explode).
  const ghostCase = useScene((s) => s.servoView === "assembled" && s.servoMotion === 1 && !!s.selectedId && INSIDE_PARTS.has(s.selectedId));
  return (
    <group position={SERVO_ORIGIN} rotation={servoEuler} name="servo-asset">
      {SERVO_PARTS.map((p) => (
        <group key={p.id} rotation={[0, p.id === "horn" ? HORN_TURN_RAD : 0, 0]}>
          {/* The pose moves each part along its manifest direction (glTF axes, inside the servo's pose). */}
          <group position={partOffsetGltf(SERVO_POSE_MANIFEST, p.id, pose)}>
            <AssetNode id={p.id} node={gltf.scene.getObjectByName(p.node)!} bounds={p.bounds} colors={colors} ghost={ghostCase && CASE_PARTS.has(p.id)} />
          </group>
        </group>
      ))}
    </group>
  );
}

/**
 * Reduced motion: the servo snaps to its new view, and a thin line from each moved part's assembled
 * place to where it is now stands in for the motion (the still alternative).
 */
function OffsetLines({ colors }: { colors: SceneColors }) {
  const view = useScene((s) => s.servoView);
  const invalidate = useThree((s) => s.invalidate);
  const geometry = useMemo(() => {
    const home = layoutServoParts(settled("assembled"));
    const now = layoutServoParts(settled(view));
    const pts: number[] = [];
    for (const id of Object.keys(now)) {
      const a = home[id]!.position;
      const b = now[id]!.position;
      if (Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) > 1e-6) pts.push(...a, ...b);
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pts, 3));
    return pts.length ? g : null;
  }, [view]);
  useEffect(() => invalidate(), [geometry, colors, invalidate]);
  if (!geometry) return null;
  return (
    <lineSegments geometry={geometry} name="servo-offset-lines" raycast={() => null}>
      <lineBasicMaterial color={colors.outline} transparent opacity={0.7} toneMapped={false} />
    </lineSegments>
  );
}

/** Parts hidden inside the assembled servo (from the model), and the parts that open it (from the manifest). */
const INSIDE_PARTS = new Set(MODELS["servo-arm"].parts.filter((p) => p.inside).map((p) => p.id));
const CASE_PARTS = new Set(SERVO_POSE_MANIFEST.open_parts ?? []);

/** The see-through case: faint faces plus its edges, so the part inside shows through it. */
function ghostOf(node: Object3D, colors: SceneColors) {
  const o = node.clone();
  const faces = new MeshBasicMaterial({ color: colors.outline, transparent: true, opacity: 0.08, depthWrite: false });
  const edges = new LineBasicMaterial({ color: colors.outline, transparent: true, opacity: 0.55 });
  const meshes: Mesh[] = [];
  o.traverse((c) => {
    if (c instanceof Mesh) meshes.push(c);
  });
  for (const m of meshes) {
    m.material = faces as Material;
    m.raycast = () => null;
    m.add(new LineSegments(new EdgesGeometry(m.geometry, 30), edges));
  }
  return o;
}

/** One GLB node as a part: a clone (the loaded scene stays untouched), plus an outline shell when selected. */
function AssetNode({ id, node, bounds, colors, ghost }: { id: string; node: Object3D; bounds: { min: [number, number, number]; max: [number, number, number] }; colors: SceneColors; ghost: boolean }) {
  const selected = useScene((s) => s.selectedId === id);
  const select = useScene((s) => s.select);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => invalidate(), [selected, colors, ghost, invalidate]);
  const ghosted = useMemo(() => ghostOf(node, colors), [node, colors]);
  const object = useMemo(() => {
    const o = node.clone();
    o.name = id;
    return o;
  }, [node, id]);
  // Outline: the same shape drawn from inside, scaled about its centre to be ASSET_OUTLINE_M larger on
  // each side (thinner than the primitives' outline: the servo is only millimetres across).
  const outline = useMemo(() => {
    const o = node.clone();
    const material = new MeshBasicMaterial({ color: colors.outline, side: BackSide, toneMapped: false });
    o.traverse((c) => {
      if (c instanceof Mesh) {
        c.material = material;
        c.raycast = () => null;
      }
    });
    const center = bounds.min.map((v, i) => (v + bounds.max[i]!) / 2) as [number, number, number];
    const scale = bounds.min.map((v, i) => 1 + (2 * ASSET_OUTLINE_M) / Math.max(bounds.max[i]! - v, 1e-4)) as [number, number, number];
    return { o, center, scale };
  }, [node, colors.outline, bounds]);
  return (
    <>
      {ghost ? <primitive object={ghosted} /> : <primitive object={object} {...partEvents(id, select)} />}
      {selected && (
        <group position={outline.center} scale={outline.scale}>
          <group position={outline.center.map((v) => -v) as [number, number, number]}>
            <primitive object={outline.o} />
          </group>
        </group>
      )}
    </>
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
  const dim = useServoAway();
  const r = servoReadout(servo, null);
  useEffect(() => invalidate(), [r.torque_nm, colors, equation, grow, dim, invalidate]);
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
          <meshBasicMaterial key={dim ? "dim" : "solid"} color={colors.fills.expressive} toneMapped={false} transparent={dim} opacity={dim ? DIM_OPACITY : 1} depthWrite={!dim} />
        </mesh>
      )}
      {armSweep > 0.01 && (
        <mesh rotation={[0, 0, end]} raycast={() => null}>
          <torusGeometry args={[R, 0.0016, 6, 24, armSweep]} />
          <meshBasicMaterial key={dim ? "dim" : "solid"} color={colors.fills.discovery} toneMapped={false} transparent={dim} opacity={dim ? DIM_OPACITY : 1} depthWrite={!dim} />
        </mesh>
      )}
      {/* The head points along the turn at the arrow's end. */}
      <mesh position={[R * Math.cos(end), R * Math.sin(end), 0]} rotation={[0, 0, end + Math.PI]} raycast={() => null}>
        <coneGeometry args={[0.006, 0.012, 12]} />
        <meshBasicMaterial key={dim ? "dim" : "solid"} color={colors.outline} toneMapped={false} transparent={dim} opacity={dim ? DIM_OPACITY : 1} depthWrite={!dim} />
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
  const dim = useServoAway();
  useEffect(() => invalidate(), [servo, equation, grow, colors, dim, invalidate]);
  const k = (step: EqStep) => (!equation.includes(step) ? 0 : equation.at(-1) === step ? grow : 1);
  const [, jy, jz] = JOINT;
  const d = Math.min(servo.arm_length_m, servo.load_distance_m);
  const z = jz + 0.012;
  const arrow = (x: number, top: number, len: number, r: number, color: string, name: string) =>
    len > 0.001 && (
      <group name={name}>
        <mesh position={[x, top - len / 2, z]} raycast={() => null}>
          <cylinderGeometry args={[r, r, len, 8]} />
          <meshBasicMaterial key={dim ? "dim" : "solid"} color={color} toneMapped={false} transparent={dim} opacity={dim ? DIM_OPACITY : 1} depthWrite={!dim} />
        </mesh>
        <mesh position={[x, top - len - 0.004, z]} rotation={[Math.PI, 0, 0]} raycast={() => null}>
          <coneGeometry args={[r * 2.6, 0.008, 10]} />
          <meshBasicMaterial key={dim ? "dim" : "solid"} color={color} toneMapped={false} transparent={dim} opacity={dim ? DIM_OPACITY : 1} depthWrite={!dim} />
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
            <meshBasicMaterial key={dim ? "dim" : "solid"} color={colors.outline} toneMapped={false} transparent={dim} opacity={dim ? DIM_OPACITY : 1} depthWrite={!dim} />
          </mesh>
          {[0, d * kd].map((x) => (
            <mesh key={x} position={[x, jy - 0.016, z]} raycast={() => null}>
              <boxGeometry args={[0.0012, 0.008, 0.0012]} />
              <meshBasicMaterial key={dim ? "dim" : "solid"} color={colors.outline} toneMapped={false} transparent={dim} opacity={dim ? DIM_OPACITY : 1} depthWrite={!dim} />
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
/**
 * Anatomy view: from the front-left, a little above (the arm runs out to the right, so a view from
 * the right would look through it), framing the servo's parts at about 60% of the free area.
 */
const anatomyDir = new Vector3(-0.72, 0.4, 0.57).normalize();
const ANATOMY_FILL = 0.6;
const marginFor = () => (useScene.getState().cameraView === "anatomy" ? 1 / ANATOMY_FILL : MARGIN);
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
  return { target, position: target.clone().addScaledVector(dir, distance * marginFor()) };
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
      // Never less than a third of the area: a panel that covers most of it (the phone inspector)
      // otherwise left no room, and the fit divided by zero (NaN camera, nothing drawn after it closed).
      const freeW = Math.max(el.clientWidth - takeW, el.clientWidth / 3);
      const freeH = Math.max(el.clientHeight - takeH, el.clientHeight / 3);
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
  const servoFrom = useScene((s) => s.servoFrom);
  const servoView = useScene((s) => s.servoView);
  const servoMotion = useScene((s) => s.servoMotion);

  // Shown or renamed labels change size, and settings move parts: render a frame to re-place them.
  const equation = useScene((s) => s.equation);
  useEffect(() => invalidate(), [labelsOn, selectedId, params, leverDistance_m, servo, servoView, servoMotion, activeScene, equation, invalidate]);

  useFrame(() => {
    const area = safeArea.current;
    if (!area) return;
    // Labels stay inside the same free area the framing uses: clear of the inspector, the torque
    // panel and the effort gauge (found by the equation's overlap check at the slider extremes).
    const { takeW, takeH } = reservedSpace(area);
    const w = area.clientWidth - takeW;
    const h = area.clientHeight - takeH;
    const layout = MODELS[activeScene].layout({ params, leverDistance_m, servo, servoPose: servoPoseOf({ servoFrom, servoView, servoMotion }) }, anim.explode);
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
  const cameraToken = useScene((s) => s.cameraToken);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null;
  const invalidate = useThree((s) => s.invalidate);
  const tween = useRef<{ t0: number; ms: number } | null>(null);
  const seen = useRef({ resetToken, exploded, activeScene, cameraToken });

  useEffect(() => writeCamera(host, camera), [camera, host]);

  useEffect(() => {
    const moveTo = (fromDefault: boolean) => {
      if (!controls) return;
      const anatomy = useScene.getState().cameraView === "anatomy";
      const d = anatomy ? anatomyDir : fromDefault ? defaultDir : dir.copy(camera.position).sub(controls.target).normalize();
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
    seen.current = { resetToken, exploded, activeScene, cameraToken };
    // Reset, a new scene, or a camera view change (the servo opened, exploded or went back together):
    // frame from that view's direction. The placeholder's explode keeps the current direction.
    const fromDefault = prev.resetToken !== resetToken || prev.activeScene !== activeScene || prev.cameraToken !== cameraToken;
    if (fromDefault || prev.exploded !== exploded) moveTo(fromDefault);
    writeData(host, "cameraView", useScene.getState().cameraView);
    return () => {
      refitCamera.current = null;
    };
  }, [resetToken, exploded, activeScene, cameraToken, spatialMs, camera, controls, host, invalidate]);

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

/**
 * For tests: the servo's state on the host element. data-servo: assembled, open, exploded, or
 * "moving"; data-servo-case: "see-through" while a part inside is picked on the assembled servo;
 * data-offset-lines: how many still-alternative lines show (reduced motion).
 */
function ServoProbe({ host, reducedMotion }: { host: RefObject<HTMLDivElement | null>; reducedMotion: boolean }) {
  const view = useScene((s) => s.servoView);
  const moving = useScene((s) => s.servoMotion < 1);
  const ghost = useScene((s) => s.servoView === "assembled" && s.servoMotion === 1 && !!s.selectedId && INSIDE_PARTS.has(s.selectedId));
  useEffect(() => {
    writeData(host, "servo", moving ? "moving" : view);
    writeData(host, "servoCase", ghost ? "see-through" : "solid");
    const away = layoutServoParts(settled(view));
    const home = layoutServoParts(settled("assembled"));
    const lines = reducedMotion ? Object.keys(away).filter((id) => away[id]!.position.some((v, i) => Math.abs(v - home[id]!.position[i]!) > 1e-6)).length : 0;
    writeData(host, "offsetLines", String(lines));
  }, [host, view, moving, ghost, reducedMotion]);
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
