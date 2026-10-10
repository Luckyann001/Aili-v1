"use client";

import dynamic from "next/dynamic";
import { Component, useEffect, useRef, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { useScene } from "@/scene/sceneStore";
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

  useEffect(() => {
    if (!webgl) setViewer("fallback");
  }, [webgl, setViewer]);

  if (viewer === "fallback" || !webgl || !theme) return null;
  return (
    <div ref={host} className={styles.canvasHost} data-viewer={viewer}>
      <SceneErrorBoundary onError={() => setViewer("fallback")}>
        <SceneCanvas
          safeArea={safeArea}
          labels={labels}
          colors={theme.colors}
          spatialMs={theme.spatialMs}
          host={host}
          onReady={({ triangles }) => {
            if (host.current) host.current.dataset.triangles = String(triangles);
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
