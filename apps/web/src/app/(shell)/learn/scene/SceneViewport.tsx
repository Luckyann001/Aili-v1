"use client";

import dynamic from "next/dynamic";
import { Component, useEffect, useRef, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { usePerf } from "@/scene/perfReadout";
import { useScene } from "@/scene/sceneStore";
import { useDemoMode } from "../DemoControls";
import { hasWebGL, useSceneTheme } from "./useSceneTheme";
import styles from "../learn.module.css";

// Separate chunk: three.js, React Three Fiber and drei download after the page is usable.
const SceneCanvas = dynamic(() => import("./SceneCanvas"), { ssr: false });

const noSubscribe = () => () => {};

/** Fills the whole stage behind the controls. Falls back to a still picture when WebGL can't run. */
export function SceneViewport({
  safeArea,
  labels,
}: {
  safeArea: RefObject<HTMLDivElement | null>;
  labels: RefObject<Map<string, HTMLElement>>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useScene((s) => s.viewer);
  const setViewer = useScene((s) => s.setViewer);
  const webgl = useSyncExternalStore(noSubscribe, hasWebGL, () => true);
  const theme = useSceneTheme();
  const demo = useDemoMode();
  const startRecording = () => {
    const frames: number[] = [];
    let last = performance.now();
    let on = true;
    const tick = (t: number) => {
      if (!on) return;
      frames.push(t - last);
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const stop = () => {
      on = false;
      usePerf.getState().setOrbitFrames(frames.slice(1));
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  useEffect(() => {
    if (!webgl) setViewer("fallback");
  }, [webgl, setViewer]);

  if (viewer === "fallback" || !webgl || !theme) return null;
  return (
    <div
      ref={host}
      className={styles.canvasHost}
      data-viewer={viewer}
      // Testing only (?demo=1): record frame-to-frame times while a finger or mouse orbits.
      onPointerDown={demo ? startRecording : undefined}
    >
      <SceneErrorBoundary onError={() => setViewer("fallback")}>
        <SceneCanvas
          safeArea={safeArea}
          labels={labels}
          colors={theme.colors}
          spatialMs={theme.spatialMs}
          host={host}
          onReady={({ triangles }) => {
            if (host.current) {
              host.current.dataset.triangles = String(triangles);
              host.current.dataset.trianglesScene = useScene.getState().activeScene;
            }
            usePerf.getState().setSceneReady(performance.now());
            setViewer("ready");
          }}
          onFail={() => setViewer("fallback")}
        />
      </SceneErrorBoundary>
    </div>
  );
}

class SceneErrorBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
