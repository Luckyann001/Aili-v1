"use client";

// The 3D view. Loaded lazily (next/dynamic, no SSR) so the rest of the Learn stage is usable
// first. Renders on demand only (no continuous frames), to spare low-end phones.

import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { BackSide, PerspectiveCamera, Vector3, type Camera, type Mesh } from "three";
import { layoutParts, modelBounds, modelCorners } from "@/scene/layout";
import { DEFAULT_VIEW, PLACEHOLDER_MODEL, type FillRole } from "@/scene/placeholderModel";
import { useScene } from "@/scene/sceneStore";
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

export default function SceneCanvas(props: SceneCanvasProps) {
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
      {PLACEHOLDER_MODEL.parts.map((p) => (
        <PartMesh key={p.id} id={p.id} fill={p.fill} colors={props.colors} />
      ))}
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
      <ReadyProbe onReady={props.onReady} />
    </Canvas>
  );
}

const OUTLINE_M = 0.003;

/** Animated state shared by the parts, labels and camera: 0 = assembled, 1 = fully exploded. */
const anim = { explode: 0 };

function PartMesh({ id, fill, colors }: { id: string; fill: FillRole; colors: SceneColors }) {
  const selected = useScene((s) => s.selectedId === id);
  const select = useScene((s) => s.select);
  const params = useScene((s) => s.params);
  const invalidate = useThree((s) => s.invalidate);
  const ref = useRef<Mesh>(null);

  useEffect(() => invalidate(), [selected, colors, params, invalidate]);

  // Size depends on the inspector settings; position also on the explode amount (set per frame).
  const { kind, size } = layoutParts(params)[id]!;
  useFrame(() => {
    ref.current?.position.set(...layoutParts(params, anim.explode)[id]!.position);
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
      position={layoutParts(params, anim.explode)[id]!.position}
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
  const params = useScene.getState().params;
  const target = new Vector3(...modelBounds(params, explode).center);
  const tanHalf = Math.tan((frame.fov * Math.PI) / 360);
  const tanV = tanHalf * (frame.areaH / frame.canvasH);
  const tanH = tanHalf * (frame.areaW / frame.canvasH);
  right.crossVectors(worldUp, dir).normalize(); // camera's right, seen from `dir`
  up.crossVectors(dir, right).normalize();
  let distance = 0;
  for (const c of modelCorners(params, explode)) {
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
  const placed = useRef(false);
  const lastInspector = useRef(inspectorShown);

  useLayoutEffect(() => {
    const el = safeArea.current;
    if (!el || !(camera instanceof PerspectiveCamera)) return;
    const inspector = () => el.querySelector<HTMLElement>("[data-inspector]");
    const apply = () => {
      const insp = inspector();
      const side = window.matchMedia("(min-width: 900px)").matches; // matches learn.module.css
      const takeW = insp && side ? insp.offsetWidth + 16 : 0;
      const takeH = insp && !side ? insp.offsetHeight + 16 : 0;
      const freeW = el.clientWidth - takeW;
      const freeH = el.clientHeight - takeH;
      const shiftX = el.offsetLeft + freeW / 2 - size.width / 2;
      const shiftY = el.offsetTop + freeH / 2 - size.height / 2;
      camera.setViewOffset(size.width, size.height, -shiftX, -shiftY, size.width, size.height);
      Object.assign(frame, { fov: camera.fov, canvasH: size.height, areaW: freeW, areaH: freeH });
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
      const insp = inspector();
      if (insp) ro.observe(insp);
      apply();
      // The free area changed size: refit the camera to it, keeping the viewing direction.
      if (placed.current && lastInspector.current !== inspectorShown) refitCamera.current?.();
      lastInspector.current = inspectorShown;
    });
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      camera.clearViewOffset();
    };
  }, [camera, size, safeArea, invalidate, controls, inspectorShown]);
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
  const params = useScene((s) => s.params);

  // Shown or renamed labels change size, and settings move parts: render a frame to re-place them.
  useEffect(() => invalidate(), [labelsOn, selectedId, params, invalidate]);

  useFrame(() => {
    const area = safeArea.current;
    if (!area) return;
    const w = area.clientWidth;
    const h = area.clientHeight;
    const layout = layoutParts(params, anim.explode);
    writeData(host, "modelBox", projectedBox(layout, camera, size));
    for (const part of PLACEHOLDER_MODEL.parts) {
      const el = labels.current.get(part.id);
      if (!el) continue;
      v.set(...layout[part.id]!.labelAnchor).project(camera);
      const sx = ((v.x + 1) / 2) * size.width;
      const sy = ((1 - v.y) / 2) * size.height;
      // For tests: where the part's anchor is on the canvas, before clamping.
      el.dataset.x = sx.toFixed(1);
      el.dataset.y = sy.toFixed(1);
      if (v.z > 1) {
        el.style.visibility = "hidden";
        continue;
      }
      el.style.visibility = "";
      const lw = el.offsetWidth;
      const lh = el.offsetHeight;
      const x = Math.min(Math.max(sx - area.offsetLeft - lw / 2, PAD), Math.max(PAD, w - lw - PAD));
      const y = Math.min(Math.max(sy - area.offsetTop - lh - 10, PAD), Math.max(PAD, h - lh - PAD));
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
  });
  return null;
}

/** On-screen box (canvas pixels) around every part's corners: "x0,y0,x1,y1". For tests. */
function projectedBox(layout: ReturnType<typeof layoutParts>, camera: Camera, size: { width: number; height: number }) {
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
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null;
  const invalidate = useThree((s) => s.invalidate);
  const tween = useRef<{ t0: number; ms: number } | null>(null);
  const seen = useRef({ resetToken, exploded });

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
    seen.current = { resetToken, exploded };
    if (prev.resetToken !== resetToken || prev.exploded !== exploded) moveTo(prev.resetToken !== resetToken);
    return () => {
      refitCamera.current = null;
    };
  }, [resetToken, exploded, spatialMs, camera, controls, host, invalidate]);

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
