"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useRef, useState, useSyncExternalStore } from "react";
import type { Mesh } from "three";
import styles from "./preview.module.css";

// Proof that React 19 + React Three Fiber + drei render in this browser. Not a product scene.

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";
function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(reducedMotionQuery);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(reducedMotionQuery).matches,
    () => false,
  );
}

function Cube({ spin }: { spin: boolean }) {
  const ref = useRef<Mesh>(null);
  useFrame((_, delta) => {
    if (spin && ref.current) {
      ref.current.rotation.x += delta * 0.4;
      ref.current.rotation.y += delta * 0.6;
    }
  });
  // 0.2 m cube: scenes are in metres.
  return (
    <mesh ref={ref} rotation={[0.5, 0.6, 0]}>
      <boxGeometry args={[0.2, 0.2, 0.2]} />
      <meshStandardMaterial color="#8daeb9" />
    </mesh>
  );
}

export function R3FCheck() {
  const reduced = useReducedMotion();
  const [renderer, setRenderer] = useState<string | null>(null);

  return (
    <div className={styles.canvasWrap}>
      <Canvas
        camera={{ position: [0.35, 0.25, 0.45], fov: 45, near: 0.01, far: 10 }}
        onCreated={({ gl }) => setRenderer(`WebGL ${gl.capabilities.isWebGL2 ? "2" : "1"} renderer active`)}
        role="img"
        aria-label="Rotating cube rendered with React Three Fiber"
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[1, 2, 1.5]} intensity={1.6} />
        <Cube spin={!reduced} />
        <OrbitControls makeDefault enablePan={false} minDistance={0.3} maxDistance={1.5} />
      </Canvas>
      <p className={styles.canvasStatus} role="status">
        {renderer ?? "Starting renderer…"}
        {reduced ? " · reduced motion: cube is still" : ""}
      </p>
    </div>
  );
}
