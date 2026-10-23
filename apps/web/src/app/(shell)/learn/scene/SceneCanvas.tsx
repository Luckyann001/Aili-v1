"use client";

// The 3D view. Loaded lazily (next/dynamic, no SSR) so the rest of the Learn stage is usable
// first. Renders on demand only (no continuous frames), to spare low-end phones.

import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useLoader, useThree, type ThreeEvent } from "@react-three/fiber";
import { Component, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { BackSide, BoxGeometry, BufferGeometry, ConeGeometry, CylinderGeometry, EdgesGeometry, Euler, Float32BufferAttribute, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, type Group, PerspectiveCamera, Vector3, type Camera, type Material, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { placeLabels, type LabelBox } from "@/scene/labelPlacement";
import { settingsOf } from "@/scene/handover";
import { cornersOf, layoutBag, type PartLayout } from "@/scene/layout";
import { MODELS } from "@/scene/models";
import { CYLINDER_SEGMENTS, PROP_DISC_R, STAND, collarHeight_m, layoutDrone, mastTicks } from "@/scene/drone";
import { sampleAt } from "@/scene/droneRun";
import { DEFAULT_VIEW, type FillRole } from "@/scene/placeholderModel";
import { useLesson } from "@/lesson/store";
import { usePerf } from "@/scene/perfReadout";
import { partOffsetGltf, settled } from "@/scene/assetPose";
import { GEAR_NODES, PINION_RAD_PER_S } from "@/scene/gears";
import { LEADER_LAYER } from "./SceneLabels";
import { caseSeeThrough, droneNow, HIDDEN_WHILE_APART, servoPoseOf, useScene } from "@/scene/sceneStore";
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

/**
 * Servo + arm: while the servo is open or exploded, the arm, load, base and the torque marks are hidden
 * (Lucky, 16 Oct 2026: dimmed, they showed as large ghost shapes); their settings and numbers never change.
 */
const useServoAway = () => useScene((s) => s.activeScene === "servo-arm" && s.servoView !== "assembled");

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
      {activeScene === "bag-hold" && <BagHandle colors={props.colors} />}
      {activeScene === "drone-altitude" && <DroneStand colors={props.colors} />}
      {activeScene === "drone-altitude" && <PropDiscs colors={props.colors} />}
      {activeScene === "drone-altitude" && <DroneArrows colors={props.colors} />}
      {activeScene === "drone-altitude" && <DroneLoopRing colors={props.colors} />}
      {activeScene === "drone-altitude" && <DroneDriver reducedMotion={props.spatialMs <= 0} />}
      <CameraLimits />
      {activeScene === "servo-arm" && props.spatialMs <= 0 && <OffsetLines colors={props.colors} />}
      {activeScene === "servo-arm" && <EquationMarks colors={props.colors} />}
      <OrbitControls
        makeDefault
        target={DEFAULT_VIEW.target}
        enableDamping={false}
        onStart={() => {
          frame.userMoved = true;
        }}
        minDistance={MODELS[activeScene].camera?.minDistance ?? 0.15}
        maxDistance={MODELS[activeScene].camera?.maxDistance ?? 1.2}
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
      <StageProbe host={props.host} />
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
  const bagReach_m = useScene((s) => s.bagReach_m);
  const servo = useScene((s) => s.servo);
  const drone = useScene((s) => s.drone);
  const invalidate = useThree((s) => s.invalidate);
  const ref = useRef<Mesh>(null);
  const state = { params, leverDistance_m, bagReach_m, servo, drone };
  const hidden = (useServoAway() && HIDDEN_WHILE_APART.has(id)) || !!MODELS[activeScene].hidden?.(state).has(id);
  // The drone's downward rangefinder glows while it is pointed at, and on the loop's "Measure" step (beat 1).
  const loopMeasure = useScene((s) => s.droneLoop === 1 || s.droneLoop === 4);
  const glow = (selected || loopMeasure) && activeScene === "drone-altitude" && id === "sensor-altitude";

  useEffect(() => invalidate(), [selected, colors, params, leverDistance_m, bagReach_m, servo, drone, hidden, loopMeasure, invalidate]);

  // Size depends on the scene settings; position also on the explode amount (set per frame). The drone's
  // height is read live each frame from the run being played, so its parts never re-render to move.
  const isDrone = activeScene === "drone-altitude";
  const live = () => (isDrone ? { ...state, drone: droneNow(useScene.getState()) } : state);
  const layoutAt = (k: number) => MODELS[activeScene].layout(live(), k)[id]!;
  const { kind, size } = layoutAt(0);
  const spins = isDrone && id.startsWith("rotor-");
  useFrame(() => {
    ref.current?.position.set(...layoutAt(anim.explode).position);
    if (spins && ref.current) ref.current.rotation.y = droneSpin.angle * (id === "rotor-1" || id === "rotor-3" ? 1 : -1);
  });

  const geometry = (inflate: number) =>
    kind === "box" ? (
      <boxGeometry args={size.map((d) => d + 2 * inflate) as [number, number, number]} />
    ) : (
      <cylinderGeometry args={[size[0] + inflate, size[0] + inflate, size[1] + 2 * inflate, CYLINDER_SEGMENTS]} />
    );
  if (hidden) return null; // the servo is apart: the arm, load and base step out of the way
  return (
    <mesh
      ref={ref}
      position={layoutAt(anim.explode).position}
      name={id}
      {...partEvents(id, select)}
    >
      {geometry(0)}
      <meshStandardMaterial color={colors.fills[fill]} roughness={0.7} metalness={0.05} emissive={glow ? colors.accent : "#000000"} emissiveIntensity={glow ? 0.9 : 0} />
      {/* The drone's figures carry Ink outlines (brand doc: fills with Ink outlines), so they read on the stage. */}
      {isDrone && <InkEdges kind={kind === "box" ? "box" : "cylinder"} dims={size} color={colors.outline} />}
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
 * Ink outlines (brand doc: figures in fills with Ink outlines) as plain 1 px WebGL lines: no triangles, so
 * the phone's budget is untouched. `dims` is [w, h, d] for a box and [radius, height, radius] otherwise;
 * only creases sharper than 20° are drawn (a cylinder's rims, not every side seam).
 */
function InkEdges({ kind, dims, segments = CYLINDER_SEGMENTS, color }: { kind: "box" | "cylinder" | "cone"; dims: readonly number[]; segments?: number; color: string }) {
  const [a = 0, b = 0, c = 0] = dims;
  const geometry = useMemo(() => {
    const g = kind === "box" ? new BoxGeometry(a, b, c) : kind === "cone" ? new ConeGeometry(a, b, segments) : new CylinderGeometry(a, a, b, segments);
    const e = new EdgesGeometry(g, 20);
    g.dispose();
    return e;
  }, [kind, a, b, c, segments]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <lineSegments geometry={geometry} raycast={() => null}>
      <lineBasicMaterial color={color} />
    </lineSegments>
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
  const ghostCase = useScene(caseSeeThrough);
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

/**
 * servo-gears-turn: each gear node turns about its own shaft (local +Y) at its shaft's speed from the
 * ratio chain (input fastest, output slowest, alternating direction), at a fixed visual pace. Under
 * reduced motion nothing turns (GearArrows shows the directions instead). Renders frames only while turning.
 */
function useGearTurning(objects: Object3D[] | null) {
  const turning = useScene((s) => s.gearsTurning);
  const reduced = spatialIsZero();
  const invalidate = useThree((s) => s.invalidate);
  const t = useRef(0);
  const base = useMemo(() => {
    const m = new Map<Object3D, number>();
    for (const o of objects ?? []) for (const g of GEAR_NODES) {
      const n = o.getObjectByName(g.node);
      if (n) m.set(n, n.rotation.y);
    }
    return m;
  }, [objects]);
  useEffect(() => {
    if (turning && !reduced) invalidate();
  }, [turning, reduced, invalidate]);
  useFrame((_, dt) => {
    if (!objects || !turning || reduced) return;
    t.current += Math.min(dt, 0.1);
    for (const o of objects)
      for (const g of GEAR_NODES) {
        const n = o.getObjectByName(g.node);
        if (n) n.rotation.y = (base.get(n) ?? 0) + g.speed * PINION_RAD_PER_S * t.current;
      }
    invalidate();
  });
}

/** Reduced motion read where the 3D view cannot see the prop (the media query, as the page's tokens use). */
const spatialIsZero = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Reduced motion: instead of turning, a curved arrow over each shaft shows which way it turns (from the
 * ratio chain's sign); the ratio text is shown on the page. Only while the gears are "turning".
 */
function GearArrows({ object, colors }: { object: Object3D; colors: SceneColors }) {
  const turning = useScene((s) => s.gearsTurning);
  const invalidate = useThree((s) => s.invalidate);
  const show = turning && spatialIsZero();
  useEffect(() => invalidate(), [show, invalidate]);
  const shafts = useMemo(() => {
    const out = new Map<string, { x: number; y: number; z: number; r: number; sign: number }>();
    for (const g of GEAR_NODES) {
      const n = object.getObjectByName(g.node);
      if (!n) continue;
      const r = Math.max(0.0018, 1.1 * (0.0002 * g.teeth) / 2); // just outside the shaft's largest gear
      const prev = out.get(g.shaft);
      const top = n.position.y + 0.0022;
      if (!prev || r > prev.r || top > prev.y) out.set(g.shaft, { x: n.position.x, y: Math.max(top, prev?.y ?? 0), z: n.position.z, r: Math.max(r, prev?.r ?? 0), sign: Math.sign(g.speed) });
    }
    return [...out.entries()];
  }, [object]);
  if (!show) return null;
  const sweep = 1.5 * Math.PI;
  return (
    <group position={object.position} name="gear-arrows">
      {shafts.map(([shaft, a]) => (
        // A ring about the shaft (+Y): the torus lies in its XY plane, turned flat; mirrored for the opposite sense.
        <group key={shaft} position={[a.x, a.y, a.z]} scale={[1, 1, a.sign >= 0 ? 1 : -1]} name={`gear-arrow-${shaft}`}>
          <group rotation={[-Math.PI / 2, 0, 0]}>
            <mesh raycast={() => null}>
              <torusGeometry args={[a.r, 0.0004, 6, 24, sweep]} />
              <meshBasicMaterial color={colors.outline} toneMapped={false} />
            </mesh>
            <mesh position={[a.r * Math.cos(sweep), a.r * Math.sin(sweep), 0]} rotation={[0, 0, sweep]} raycast={() => null}>
              <coneGeometry args={[0.001, 0.0024, 8]} />
              <meshBasicMaterial color={colors.outline} toneMapped={false} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  );
}

/** The parts that open the servo (from the manifest): the ones that turn see-through. */
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
  useGearTurning(id === "gear-train" ? [object, outline.o] : null);
  return (
    <>
      {ghost ? <primitive object={ghosted} /> : <primitive object={object} {...partEvents(id, select)} />}
      {id === "gear-train" && <GearArrows object={object} colors={colors} />}
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

/** The bag's handle: two thin straps from the hand down to the bag's top. Decoration, not a part. */
/** The camera's clipping range follows the scene: the drone's stand is metres tall, the servo a few centimetres. */
function CameraLimits() {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const activeScene = useScene((s) => s.activeScene);
  useEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) return;
    Object.assign(camera, { far: MODELS[activeScene].camera?.far ?? 5 });
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, activeScene, invalidate]);
  return null;
}

/**
 * The drone's test stand (not parts: nothing here is selectable): a plate, the guide post through the
 * drone's body (why it only moves up and down), the stop it rests on, and a measuring mast with a mark
 * every half metre and a lit collar at the set height. Drawing only; the set height is the scene setting.
 */
function DroneStand({ colors }: { colors: SceneColors }) {
  const drone = useScene((s) => s.drone);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => invalidate(), [drone, colors, invalidate]);
  const { plate, post, stop, mast, collar } = STAND;
  const standMat = <meshStandardMaterial color={colors.stand} roughness={0.85} metalness={0} />;
  const strongMat = <meshStandardMaterial color={colors.standStrong} roughness={0.6} metalness={0.1} />;
  return (
    <group name="drone-stand">
      <mesh position={plate.centre} raycast={() => null}>
        <boxGeometry args={plate.size} />
        {standMat}
        <InkEdges kind="box" dims={plate.size} color={colors.outline} />
      </mesh>
      <mesh position={[0, post.height_m / 2, 0]} raycast={() => null}>
        <cylinderGeometry args={[post.r, post.r, post.height_m, 12]} />
        {strongMat}
      </mesh>
      <mesh position={[0, stop.h / 2, 0]} raycast={() => null}>
        <cylinderGeometry args={[stop.r, stop.r, stop.h, CYLINDER_SEGMENTS]} />
        {strongMat}
      </mesh>
      <mesh position={[mast.x, mast.height_m / 2, mast.z]} raycast={() => null}>
        <boxGeometry args={[mast.width, mast.height_m, mast.width]} />
        {standMat}
        <InkEdges kind="box" dims={[mast.width, mast.height_m, mast.width]} color={colors.outline} />
      </mesh>
      {mastTicks().map((t) => (
        <mesh key={t.height_m} position={[mast.x + mast.width / 2 + (t.major ? 0.02 : 0.012), t.y_m, mast.z]} raycast={() => null}>
          <boxGeometry args={[t.major ? 0.04 : 0.024, 0.006, 0.006]} />
          {strongMat}
        </mesh>
      ))}
      <mesh name="set-height-collar" position={[mast.x, collarHeight_m(drone), mast.z]} rotation={[Math.PI / 2, 0, 0]} raycast={() => null}>
        <torusGeometry args={[collar.radius, collar.tube, 8, CYLINDER_SEGMENTS]} />
        <meshStandardMaterial color={colors.accent} emissive={colors.accent} emissiveIntensity={0.6} roughness={0.5} />
      </mesh>
      {/* The target line: dashes in Copper from the collar across to the guide post, at the set height. */}
      {Array.from({ length: TARGET_DASHES }, (_, i) => (
        <mesh key={i} name="target-line" position={[mast.x + mast.width / 2 + (i + 0.5) * TARGET_DASH_PITCH_M, collarHeight_m(drone), mast.z]} raycast={() => null}>
          <boxGeometry args={[TARGET_DASH_PITCH_M * 0.6, 0.008, 0.008]} />
          <meshBasicMaterial color={colors.accent} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

const TARGET_DASHES = 8;
const TARGET_DASH_PITCH_M = (-STAND.mast.x - STAND.mast.width / 2 - STAND.post.r) / TARGET_DASHES;

/** The propellers' angle (illustrative): it advances with thrust while a run plays, never from a number of its own. */
const droneSpin = { angle: 0 };
/** Top spin rate at full thrust, rad/s: an animation rate for the eye, not a motor speed. */
const SPIN_AT_MAX_RAD_S = 30;

/** While a run plays: a frame per playback step, and the propellers turning with the thrust (not under reduced motion). */
function DroneDriver({ reducedMotion }: { reducedMotion: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => useScene.subscribe((s, prev) => (s.droneT_s !== prev.droneT_s || s.droneRun !== prev.droneRun ? invalidate() : undefined)), [invalidate]);
  useFrame((_, dt) => {
    const s = useScene.getState();
    if (reducedMotion || !s.dronePlaying || !s.droneRun) return;
    const thrust = sampleAt(s.droneRun.result, s.droneT_s).thrust_n;
    droneSpin.angle = (droneSpin.angle + SPIN_AT_MAX_RAD_S * Math.sqrt(Math.max(0, thrust) / s.droneRun.result.max_thrust_n) * Math.min(dt, 0.1)) % (2 * Math.PI);
  });
  return null;
}

/** Beat 1's feedback loop: a dashed Copper ring around the drone while the loop plays (its steps are named on the stage). */
const LOOP_RING_R = 0.5;
const LOOP_DASHES = 18;
function DroneLoopRing({ colors }: { colors: SceneColors }) {
  const on = useScene((s) => s.droneLoop !== 0);
  const ref = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => invalidate(), [on, colors, invalidate]);
  useFrame(() => {
    if (!ref.current) return;
    const body = layoutDrone(droneNow(useScene.getState())).body!;
    ref.current.position.set(0, body.position[1], 0);
  });
  if (!on) return null;
  return (
    <group ref={ref} name="feedback-loop-ring">
      {Array.from({ length: LOOP_DASHES }, (_, i) => {
        const a = (i / LOOP_DASHES) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * LOOP_RING_R, 0, Math.sin(a) * LOOP_RING_R]} rotation={[0, -a, 0]} raycast={() => null}>
            <boxGeometry args={[0.012, 0.012, ((Math.PI * 2 * LOOP_RING_R) / LOOP_DASHES) * 0.55]} />
            <meshBasicMaterial color={colors.accent} toneMapped={false} />
          </mesh>
        );
      })}
    </group>
  );
}

/** Newtons to metres for the force arrows: the same scale for both, so they are equal at hover. */
const ARROW_M_PER_N = 0.025;
const ARROW_X_M = 0.42;

/**
 * Thrust (up) and weight (down) beside the drone, to scale, from the run being played (the solver's
 * thrust and weight); before any run, thrust is zero and only the weight shows. Lifted off the plate if
 * the weight arrow would go through it.
 */
function DroneArrows({ colors }: { colors: SceneColors }) {
  const up = useRef<Group>(null);
  const down = useRef<Group>(null);
  const place = () => {
    const s = useScene.getState();
    const now = droneNow(s);
    const body = layoutDrone(now).body!;
    const weight_n = s.droneRun?.result.weight_n ?? 0;
    const thrust_n = s.droneRun ? sampleAt(s.droneRun.result, s.droneT_s).thrust_n : 0;
    const wLen = weight_n * ARROW_M_PER_N;
    const y = Math.max(body.position[1], wLen + 0.02);
    up.current?.position.set(ARROW_X_M, y, 0);
    up.current?.scale.set(1, Math.max(thrust_n * ARROW_M_PER_N, 1e-4), 1);
    if (up.current) up.current.visible = thrust_n > 0.05;
    down.current?.position.set(ARROW_X_M, y, 0);
    down.current?.scale.set(1, Math.max(wLen, 1e-4), 1);
    if (down.current) down.current.visible = wLen > 0;
  };
  useFrame(place);
  // Unit arrows (length 1 along +y), scaled to their force; the head is a fixed share of the length.
  const arrow = (dir: 1 | -1, name: string, ref: RefObject<Group | null>) => (
    <group ref={ref} name={name} rotation={[dir === 1 ? 0 : Math.PI, 0, 0]}>
      <mesh position={[0, 0.42, 0]} raycast={() => null}>
        <cylinderGeometry args={[0.008, 0.008, 0.84, 8]} />
        <meshStandardMaterial color={colors.fills.technical} />
        <InkEdges kind="cylinder" dims={[0.008, 0.84, 0.008]} segments={8} color={colors.outline} />
      </mesh>
      <mesh position={[0, 0.92, 0]} raycast={() => null}>
        <coneGeometry args={[0.022, 0.16, 12]} />
        <meshStandardMaterial color={colors.fills.technical} />
        <InkEdges kind="cone" dims={[0.022, 0.16, 0.022]} segments={12} color={colors.outline} />
      </mesh>
    </group>
  );
  return (
    <group name="force-arrows">
      {arrow(1, "thrust-arrow", up)}
      {arrow(-1, "weight-arrow", down)}
    </group>
  );
}

/** The circle each propeller sweeps, faint and not selectable; it follows the drone (and the explode). */
function PropDiscs({ colors }: { colors: SceneColors }) {
  const drone = useScene((s) => s.drone);
  const refs = useRef<Array<Mesh | null>>([]);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => invalidate(), [drone, colors, invalidate]);
  const at = (k: number) => MODELS["drone-altitude"].layout({ ...useScene.getState(), drone: droneNow(useScene.getState()) }, k);
  useFrame(() => {
    const l = at(anim.explode);
    refs.current.forEach((m, i) => m?.position.set(...l[`rotor-${i + 1}`]!.position));
  });
  const l = at(anim.explode);
  return (
    <group name="prop-discs">
      {[1, 2, 3, 4].map((n, i) => (
        <mesh key={n} ref={(m) => void (refs.current[i] = m)} position={l[`rotor-${n}`]!.position} raycast={() => null}>
          <cylinderGeometry args={[PROP_DISC_R, PROP_DISC_R, 0.002, CYLINDER_SEGMENTS]} />
          <meshBasicMaterial color={colors.fills.technical} transparent opacity={0.28} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

function BagHandle({ colors }: { colors: SceneColors }) {
  const reach = useScene((s) => s.bagReach_m);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => invalidate(), [reach, colors, invalidate]);
  const l = layoutBag(reach);
  const hand = l.hand!.position;
  const top = l.bag!.position[1] + l.bag!.size[1] / 2;
  const y = (hand[1] + top) / 2;
  return (
    <group name="bag-handle">
      {[-0.018, 0.018].map((dx) => (
        <mesh key={dx} position={[hand[0] + dx, y, 0]} raycast={() => null}>
          <boxGeometry args={[0.003, Math.max(0.001, hand[1] - top), 0.003]} />
          <meshStandardMaterial color={colors.fills.expressive} roughness={0.7} metalness={0.05} />
        </mesh>
      ))}
    </group>
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
  if (total < 0.01 || dim) return null; // hidden while the servo is apart
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
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
        <mesh position={[x, top - len - 0.004, z]} rotation={[Math.PI, 0, 0]} raycast={() => null}>
          <coneGeometry args={[r * 2.6, 0.008, 10]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
      </group>
    );
  const kd = k("eq-distance");
  if (dim) return null; // hidden while the servo is apart
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
const sharedDir = new Vector3(...DEFAULT_VIEW.position).sub(new Vector3(...DEFAULT_VIEW.target)).normalize();
/** The default viewing direction of the scene on stage (the drone has its own). */
const defaultDirOf = () => {
  const d = MODELS[useScene.getState().activeScene].viewDir;
  return d ? new Vector3(...d).normalize() : sharedDir;
};
/**
 * Anatomy view: from the front-left, a little above (the arm runs out to the right, so a view from
 * the right would look through it), framing the servo's parts as they will be (explode offsets
 * included) at about 70% of the free area (Lucky, 16 Oct 2026: at 60%, with the old long spread, the
 * servo filled about a tenth of the stage), centred in it.
 */
const anatomyDir = new Vector3(-0.72, 0.4, 0.57).normalize();
// 0.8 of the limiting side as fitted; perspective and the centring leave about 0.7 on screen.
const ANATOMY_FILL = 0.8;
const marginFor = () => (useScene.getState().cameraView === "anatomy" ? 1 / ANATOMY_FILL : MARGIN);
/** Last known screen shape, kept by Framing. */
/**
 * `userMoved`: the learner orbited or zoomed. On a scene that reframes itself (refitOnGrow, the drone),
 * the camera then stays where they put it, through runs and resizes, so a close-up can be recorded;
 * Reset view or a new scene hands framing back to the app.
 */
const frame = { fov: 40, canvasH: 1, areaW: 1, areaH: 1, fittedArea: 0, userMoved: false };
const keepsUserView = () => frame.userMoved && !!MODELS[useScene.getState().activeScene].refitOnGrow;

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
  const d = distance * marginFor();
  // Anatomy: centre the parts' projected extent (not their box's centre) in the free area.
  if (useScene.getState().cameraView === "anatomy") {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const c of corners) {
      offset.set(...c).sub(target);
      const depth = d - offset.dot(dir);
      const x = offset.dot(right) / (depth * tanH);
      const y = offset.dot(up) / (depth * tanV);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    target.addScaledVector(right, ((x0 + x1) / 2) * d * tanH).addScaledVector(up, ((y0 + y1) / 2) * d * tanV);
  }
  return { target, position: target.clone().addScaledVector(dir, d) };
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
  // The drone's explanation space (its column, or the strip on narrow screens) arrives with the scene.
  const droneSpaceShown = useScene((s) => s.activeScene === "drone-altitude" && !s.inspectorOpen);
  const reserveKey = `${inspectorShown}|${gaugeShown}|${marginShown}|${droneSpaceShown}`;
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
      if (keepsUserView()) {
        // The learner's own view of the drone (a close-up): leave it.
      } else if (placed.current && !modelFits(camera, size, { x: el.offsetLeft, y: el.offsetTop, w: freeW, h: freeH })) {
        refitCamera.current?.();
      } else if (placed.current && MODELS[useScene.getState().activeScene].refitOnGrow && freeW * freeH > frame.fittedArea * 1.15) {
        // The drone: a panel or the live welcome went away and the stage has room again. Fill it, rather
        // than leave the drone framed for a smaller stage (found on Lucky's laptop, 22 Oct 2026).
        refitCamera.current?.();
      }
      if (!placed.current) {
        placed.current = true;
        frame.fittedArea = freeW * freeH;
        const g = fitGoal(defaultDirOf(), anim.explode);
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
      if (placed.current && lastReserve.current !== reserveKey && !keepsUserView()) refitCamera.current?.();
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
  const bagReach_m = useScene((s) => s.bagReach_m);
  const servo = useScene((s) => s.servo);
  const servoFrom = useScene((s) => s.servoFrom);
  const servoView = useScene((s) => s.servoView);
  const servoMotion = useScene((s) => s.servoMotion);
  const drone = useScene((s) => s.drone);

  // Shown or renamed labels change size, and settings move parts: render a frame to re-place them.
  // Also once the viewer is ready: the label layer mounts only then, after the first frame, and with
  // nothing else asking for a frame its labels stayed unplaced (found by the tap test under load).
  const equation = useScene((s) => s.equation);
  const viewer = useScene((s) => s.viewer);
  useEffect(() => invalidate(), [labelsOn, selectedId, params, leverDistance_m, bagReach_m, servo, servoView, servoMotion, drone, activeScene, equation, viewer, invalidate]);

  useFrame(() => {
    const area = safeArea.current;
    if (!area) return;
    // Labels stay inside the same free area the framing uses: clear of the inspector, the torque
    // panel and the effort gauge (found by the equation's overlap check at the slider extremes).
    const { takeW, takeH } = reservedSpace(area);
    const w = area.clientWidth - takeW;
    const h = area.clientHeight - takeH;
    const state = { params, leverDistance_m, bagReach_m, servo, drone: activeScene === "drone-altitude" ? droneNow(useScene.getState()) : drone, servoPose: servoPoseOf({ servoFrom, servoView, servoMotion }) };
    const layout = MODELS[activeScene].layout(state, anim.explode);
    const hiddenParts = MODELS[activeScene].hidden?.(state);
    writeData(host, "modelBox", projectedBox(layout, camera, size));
    // For tests: the free area (canvas px) and each servo part's box on screen (the size checks).
    writeData(host, "freeArea", [area.offsetLeft, area.offsetTop, w, h].map((n) => n.toFixed(1)).join(","));
    if (activeScene === "servo-arm") writeData(host, "servoBoxes", JSON.stringify(Object.fromEntries(SERVO_PARTS.map((p) => [p.id, screenBox(layout[p.id]!, camera, size)]))));
    // 1. Where each shown label wants to go (clamped inside the safe area).
    const wanted: LabelBox[] = [];
    // The servo's parts: label above the part's box on screen, never on it, with a leader line down to it.
    const partBox = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (const part of MODELS[activeScene].parts) {
      const el = labels.current.get(part.id);
      if (!el) continue;
      if (hiddenParts?.has(part.id)) {
        el.style.visibility = "hidden";
        continue;
      }
      const pl = layout[part.id]!;
      if (pl.kind === "asset" && el.offsetWidth > 0) {
        const [x0, y0, x1, y1] = screenBox(pl, camera, size);
        const box = { x: x0 - area.offsetLeft, y: y0 - area.offsetTop, w: x1 - x0, h: y1 - y0 };
        partBox.set(part.id, box);
        el.dataset.box = [x0, y0, x1, y1].map((n) => n.toFixed(1)).join(",");
        el.dataset.x = ((x0 + x1) / 2).toFixed(1);
        el.dataset.y = y0.toFixed(1);
        const lw = el.offsetWidth;
        const lh = el.offsetHeight;
        wanted.push({
          id: part.id,
          x: Math.min(Math.max(box.x + box.w / 2 - lw / 2, PAD), Math.max(PAD, w - lw - PAD)),
          y: Math.min(Math.max(box.y - lh - 12, PAD), Math.max(PAD, h - lh - PAD)),
          w: lw,
          h: lh,
          priority: part.id === selectedId ? 10 : 0,
          avoid: box,
        });
        continue;
      }
      v.set(...pl.labelAnchor).project(camera);
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
    const extra = MODELS[activeScene].extraAnchors?.(state) ?? {};
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
    const leaders: string[] = [];
    for (const p of placeLabels(wanted, { w, h }, PAD)) {
      const el = labels.current.get(p.id)!;
      el.style.visibility = p.hidden ? "hidden" : "";
      el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
      // A short leader from the label to the nearest point of its part's box.
      const box = partBox.get(p.id);
      if (box && !p.hidden) {
        const lx = p.x + el.offsetWidth / 2;
        const ly = p.y + (p.y + el.offsetHeight / 2 < box.y ? el.offsetHeight : 0);
        const tx = Math.min(Math.max(lx, box.x + 2), box.x + box.w - 2);
        const ty = Math.min(Math.max(ly, box.y + 2), box.y + box.h - 2);
        leaders.push(`<line x1="${lx.toFixed(1)}" y1="${ly.toFixed(1)}" x2="${tx.toFixed(1)}" y2="${ty.toFixed(1)}" />`);
      }
    }
    const layer = labels.current.get(LEADER_LAYER);
    if (layer) layer.innerHTML = leaders.length ? `<svg width="${w.toFixed(0)}" height="${h.toFixed(0)}" aria-hidden="true">${leaders.join("")}</svg>` : "";
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

/** One part's box on screen, canvas pixels: [x0, y0, x1, y1]. */
function screenBox(p: PartLayout, camera: Camera, size: { width: number; height: number }): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const h = p.kind === "cylinder" ? [p.size[0], p.size[1] / 2, p.size[0]] : p.size.map((d) => d / 2);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    v.set(p.position[0] + sx * h[0]!, p.position[1] + sy * h[1]!, p.position[2] + sz * h[2]!).project(camera);
    const x = ((v.x + 1) / 2) * size.width;
    const y = ((1 - v.y) / 2) * size.height;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
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
  // The drone reframes for a new set height or a new run's height range (keeping the viewing direction).
  const fitKey = useScene((s) => MODELS[s.activeScene].refitKey?.(s) ?? "");
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null;
  const invalidate = useThree((s) => s.invalidate);
  const tween = useRef<{ t0: number; ms: number } | null>(null);
  const seen = useRef({ resetToken, exploded, activeScene, cameraToken, fitKey });

  useEffect(() => writeCamera(host, camera), [camera, host]);

  useEffect(() => {
    const moveTo = (fromDefault: boolean) => {
      if (!controls) return;
      const anatomy = useScene.getState().cameraView === "anatomy";
      const d = anatomy ? anatomyDir : fromDefault ? defaultDirOf() : dir.copy(camera.position).sub(controls.target).normalize();
      const g = fitGoal(d, useScene.getState().exploded ? 1 : 0);
      // The free area this fit is for (a scene with refitOnGrow refits when it grows a lot).
      frame.fittedArea = frame.areaW * frame.areaH;
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
    seen.current = { resetToken, exploded, activeScene, cameraToken, fitKey };
    // Reset, a new scene, or a camera view change (the servo opened, exploded or went back together):
    // frame from that view's direction. The placeholder's explode keeps the current direction.
    const fromDefault = prev.resetToken !== resetToken || prev.activeScene !== activeScene || prev.cameraToken !== cameraToken;
    if (fromDefault) frame.userMoved = false;
    // A new run's range reframes the drone, unless the learner set their own view (kept for a close-up).
    const refit = prev.fitKey !== fitKey && !keepsUserView();
    if (fromDefault || prev.exploded !== exploded || refit) moveTo(fromDefault);
    writeData(host, "cameraView", useScene.getState().cameraView);
    return () => {
      refitCamera.current = null;
    };
  }, [resetToken, exploded, activeScene, cameraToken, fitKey, spatialMs, camera, controls, host, invalidate]);

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
 * data-offset-lines: how many still-alternative lines show (reduced motion); data-gears: turning or still.
 */
function ServoProbe({ host, reducedMotion }: { host: RefObject<HTMLDivElement | null>; reducedMotion: boolean }) {
  const view = useScene((s) => s.servoView);
  const moving = useScene((s) => s.servoMotion < 1);
  const ghost = useScene(caseSeeThrough);
  const gears = useScene((s) => s.gearsTurning);
  useEffect(() => writeData(host, "gears", gears ? "turning" : "still"), [host, gears]);
  // For tests: what is hidden while the servo is apart (nothing once it is assembled).
  useEffect(() => writeData(host, "hiddenParts", view === "assembled" ? "" : [...HIDDEN_WHILE_APART].join(",")), [host, view]);
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

/** For tests: the scene on stage and its settings, as the shared stage function names them (data-stage). */
function StageProbe({ host }: { host: RefObject<HTMLDivElement | null> }) {
  const scene = useScene((s) => s.activeScene);
  const servo = useScene((s) => s.servo);
  const lever = useScene((s) => s.leverDistance_m);
  const bag = useScene((s) => s.bagReach_m);
  const drone = useScene((s) => s.drone);
  useEffect(() => writeData(host, "stage", JSON.stringify({ scene, settings: settingsOf(scene, { servo, leverDistance_m: lever, bagReach_m: bag, drone }) })), [host, scene, servo, lever, bag, drone]);
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
