"use client";

import { useState, useSyncExternalStore } from "react";
import { frameStats, readoutText, usePerf } from "@/scene/perfReadout";
import { isRecognitionSupported } from "@/voice/recognition";
import { useConsent } from "@/voice/consent";
import { DEMO_TOOLS } from "@/turn/flags";
import { useVoice } from "@/voice/store";
import type { VoiceStatus } from "@/voice/machine";
import { FAKE_CASES, type FakeCase } from "@aili/schemas";
import styles from "./learn.module.css";

const STATES: VoiceStatus[] = ["idle", "listening", "thinking", "speaking", "error"];

/**
 * Testing tools: only with ?demo=1 in the address AND a build with NEXT_PUBLIC_AILI_DEMO_TOOLS=1.
 * In a real production build ?demo=1 does nothing. Not linked anywhere.
 */
export function useDemoMode(): boolean {
  const asked = useSyncExternalStore(
    () => () => {},
    () => new URLSearchParams(window.location.search).get("demo") === "1",
    () => false,
  );
  return DEMO_TOOLS && asked;
}

export function DemoControls({ onPlay, onFakeTurn }: { onPlay: () => void; onFakeTurn?: (c: FakeCase) => void }) {
  const dispatch = useVoice((s) => s.dispatch);
  const mode = useVoice((s) => s.mode);
  const consent = useConsent();
  const supported = useSyncExternalStore(() => () => {}, isRecognitionSupported, () => false);

  return (
    <details className={styles.demo}>
      <summary>Demo controls (testing only)</summary>
      <p className={styles.demoNote}>Not part of the product. Sets the voice state directly so each look can be checked.</p>
      <div className={styles.demoButtons}>
        {STATES.map((s) => (
          <button key={s} type="button" className={styles.demoButton} onClick={() => dispatch({ type: "demoSet", status: s })}>
            Show {s}
          </button>
        ))}
        <button type="button" className={styles.demoButton} onClick={onPlay}>
          Play prepared reply
        </button>
      </div>
      {onFakeTurn && (
        <div className={styles.demoButtons} role="group" aria-label="Fake director turns (testing only)">
          {FAKE_CASES.map((c) => (
            <button key={c} type="button" className={styles.demoButton} onClick={() => onFakeTurn(c)}>
              Fake turn: {c}
            </button>
          ))}
        </div>
      )}
      <PerfReadoutPanel />
      <dl className={styles.demoFacts}>
        <dt>Speech recognition in this browser</dt>
        <dd>{supported ? "supported" : "not supported"}</dd>
        <dt>Detected mode (after pressing the mic)</dt>
        <dd>{mode ?? "not detected yet"}</dd>
        <dt>Saved choice on this device</dt>
        <dd>{consent ? `${consent.choice}, ${consent.mode}` : "none"}</dd>
      </dl>
    </details>
  );
}

const pageLoadMs = () => {
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  if (!nav) return null;
  return nav.loadEventEnd > 0 ? nav.loadEventEnd : nav.domContentLoadedEventEnd > 0 ? nav.domContentLoadedEventEnd : null;
};

/** Testing only: timings measured on this device. Nothing is sent anywhere. */
function PerfReadoutPanel() {
  const sceneReadyMs = usePerf((s) => s.sceneReadyMs);
  const renderer = usePerf((s) => s.renderer);
  const frames = usePerf((s) => s.orbitFrames);
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const loadMs = useSyncExternalStore(() => () => {}, pageLoadMs, () => null);
  const stats = frameStats(frames);
  const text = readoutText({ loadMs, sceneReadyMs, renderer, frames, userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent });
  const ms = (v: number | null) => (v === null ? "not measured" : `${Math.round(v)} ms`);

  return (
    <section className={styles.demoReadout} aria-label="Performance readout (testing only)">
      <p className={styles.demoNote}>Performance readout (testing only). Measured on this device; nothing is sent anywhere.</p>
      <dl className={styles.demoFacts}>
        <dt>Page load</dt>
        <dd data-testid="perf-load">{ms(loadMs)}</dd>
        <dt>3D scene ready</dt>
        <dd data-testid="perf-scene">{ms(sceneReadyMs)}</dd>
        <dt>Orbit frame time</dt>
        <dd data-testid="perf-frames">
          {stats ? `median ${stats.median.toFixed(1)} ms, worst ${stats.worst.toFixed(1)} ms (${stats.count} frames)` : "drag the 3D view to measure"}
        </dd>
        <dt>WebGL renderer</dt>
        <dd data-testid="perf-renderer">{renderer ?? "not exposed by this browser"}</dd>
      </dl>
      <button
        type="button"
        className={styles.demoButton}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied("copied");
          } catch {
            setCopied("failed");
          }
        }}
      >
        Copy results
      </button>
      <span role="status" className={styles.demoNote}>
        {copied === "copied" ? " Copied." : copied === "failed" ? " Couldn't copy here: select the text below and copy it." : ""}
      </span>
      {copied === "failed" && <textarea readOnly className={styles.demoText} value={text} rows={6} aria-label="Results to copy" />}
    </section>
  );
}
