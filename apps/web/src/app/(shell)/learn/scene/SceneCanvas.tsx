"use client";

// The 3D view. Loaded lazily (next/dynamic, no SSR) so the rest of the Learn stage is usable
// first. Renders on demand only (no continuous frames), to spare low-end phones.

import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { BackSide, PerspectiveCamera, Vector3 } from "three";
import { DEFAULT_VIEW, PLACEHOLDER_MODEL, type Part } from "@/scene/placeholderModel";
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
        <PartMesh key={p.id} part={p} colors={props.colors} />
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
      <LabelTracker safeArea={props.safeArea} labels={props.labels} />
      <CameraReset spatialMs={props.spatialMs} host={props.host} />
      <ReadyProbe onReady={props.onReady} />
    </Canvas>
  );
}

const OUTLINE_M = 0.003;

function PartMesh({ part, colors }: { part: Part; colors: SceneColors }) {
  const selected = useScene((s) => s.selectedId === part.id);
  const select = useScene((s) => s.select);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => invalidate(), [selected, colors, invalidate]);

  const { kind, size } = part.shape;
  const geometry = (inflate: number) =>
    kind === "box" ? (
      <boxGeometry args={(size as [number, number, number]).map((d) => d + 2 * inflate) as [number, number, number]} />
    ) : (
      <cylinderGeometry args={[size[0] + inflate, size[0] + inflate, size[1] + 2 * inflate, 24]} />
    );
  return (
    <mesh
      position={part.position}
      name={part.id}
      onClick={(e) => {
        e.stopPropagation();
        select(part.id);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setCursor(e.nativeEvent.target, "pointer");
      }}
      onPointerOut={(e) => setCursor(e.nativeEvent.target, "")}
    >
      {geometry(0)}
      <meshStandardMaterial color={colors.fills[part.fill]} roughness={0.7} metalness={0.05} />
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

// Model extent for framing (metres), seen from the default view: the model is wide and flat,
// so width and height are fitted separately rather than with one bounding sphere.
const HALF_WIDTH_M = 0.13;
const HALF_HEIGHT_M = 0.075;
const MARGIN = 1.12;
const target = new Vector3(...DEFAULT_VIEW.target);
const viewDir = new Vector3(...DEFAULT_VIEW.position).sub(target).normalize();

/** Default camera position that fits the whole model inside the safe area at this screen shape. */
const fitted = { position: new Vector3(...DEFAULT_VIEW.position) };
function fitCamera(fovDeg: number, canvasH: number, areaW: number, areaH: number) {
  const tanHalf = Math.tan((fovDeg * Math.PI) / 360);
  const tanV = tanHalf * (areaH / canvasH);
  const tanH = tanHalf * (areaW / canvasH);
  const distance = Math.max(HALF_WIDTH_M / tanH, HALF_HEIGHT_M / tanV) * MARGIN;
  fitted.position.copy(target).addScaledVector(viewDir, distance);
}

/**
 * Centres the model in the safe area (not the whole stage) by shifting the projection, and fits
 * the default camera distance to the safe area. The first fit also places the camera.
 */
function Framing({ safeArea }: { safeArea: RefObject<HTMLDivElement | null> }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const placed = useRef(false);

  useLayoutEffect(() => {
    const el = safeArea.current;
    if (!el || !(camera instanceof PerspectiveCamera)) return;
    const apply = () => {
      const centre = el.offsetTop + el.offsetHeight / 2;
      const shift = centre - size.height / 2;
      camera.setViewOffset(size.width, size.height, 0, -shift, size.width, size.height);
      fitCamera(camera.fov, size.height, el.clientWidth, el.clientHeight);
      if (!placed.current) {
        placed.current = true;
        camera.position.copy(fitted.position);
        camera.lookAt(target);
      }
      invalidate();
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      camera.clearViewOffset();
    };
  }, [camera, size, safeArea, invalidate]);
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
}: {
  safeArea: RefObject<HTMLDivElement | null>;
  labels: RefObject<Map<string, HTMLElement>>;
}) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const labelsOn = useScene((s) => s.labelsOn);
  const selectedId = useScene((s) => s.selectedId);

  // Shown or renamed labels change size: render a frame so they are placed again.
  useEffect(() => invalidate(), [labelsOn, selectedId, invalidate]);

  useFrame(() => {
    const area = safeArea.current;
    if (!area) return;
    const w = area.clientWidth;
    const h = area.clientHeight;
    for (const part of PLACEHOLDER_MODEL.parts) {
      const el = labels.current.get(part.id);
      if (!el) continue;
      v.set(...part.labelAnchor).project(camera);
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

/** Mirrors the camera position (metres) onto the host element, for tests and debugging. */
function writeCamera(host: RefObject<HTMLDivElement | null>, camera: { position: Vector3 }) {
  if (host.current) host.current.dataset.camera = camera.position.toArray().map((n) => n.toFixed(3)).join(",");
}

const start = { pos: new Vector3(), target: new Vector3() };
const goal = { pos: fitted.position, target };

/** "Reset view": tweens back over the spatial duration, or cuts when it is 0 (reduced motion). */
function CameraReset({ spatialMs, host }: { spatialMs: number; host: RefObject<HTMLDivElement | null> }) {
  const resetToken = useScene((s) => s.resetToken);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null;
  const invalidate = useThree((s) => s.invalidate);
  const tween = useRef<{ t0: number; ms: number } | null>(null);
  const first = useRef(true);

  useEffect(() => writeCamera(host, camera), [camera, host]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!controls) return;
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
  }, [resetToken, spatialMs, camera, controls, host, invalidate]);

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
