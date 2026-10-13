"use client";

import { useCallback, useEffect, useRef } from "react";
import { create } from "zustand";
import { createSseParser, type TurnEvent } from "@aili/engine";
import type { FakeCase } from "@aili/schemas";
import { MODELS, type SceneId } from "@/scene/models";
import { useScene } from "@/scene/sceneStore";
import { useVoice } from "@/voice/store";
import type { CaptionPart } from "@/voice/machine";
import { DROPPED_MESSAGE, initialTurnClient, turnClientReducer, type TurnClientAction, type TurnClientState } from "./client";
import { useStageContent } from "./stageContent";
import { useTurnLog } from "./turnLog";

// A fake-director turn in the Learn stage (M2 slice 6b, ?demo=1 with both testing flags).
// POST /api/turn streams events; the pure reducer (client.ts) gates them. Actions are applied to
// the stage as they arrive; narration is spoken once the turn is complete, so a turn that fails
// or drops is never half-spoken. Any error, interrupt or dropped connection puts the stage back as
// it was before the turn. No provider, key or network beyond this same-origin route.

/** The stage as it was before a turn, put back on any failure. */
export interface StageSnapshot {
  activeScene: SceneId;
  selectedId: string | null;
  leverDistance_m: number;
  /** Whether fixture content (from an earlier, completed turn) was already on stage. */
  fixture: boolean;
  /** Whether that earlier turn was a live one. */
  live: boolean;
  /** Whether a turn had already put a scene on stage (live mode's dimmed opening state). */
  scenePicked: boolean;
}

/** Test-fixture scenes are copies of real scenes; the stage draws the original's model. */
const FIXTURE_SCENE_MODEL: Record<string, SceneId> = { "fx-lever": "lever-analogy" };

/** This page's client session ID: turn IDs repeat across pages, so the server keys turns by both. */
const SESSION_ID = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `s-${Math.random().toString(36).slice(2, 12)}-${Date.now().toString(36)}`;

export const useTurnClient = create<{ state: TurnClientState<StageSnapshot>; dispatch: (a: TurnClientAction<StageSnapshot>) => TurnClientState<StageSnapshot> }>()((set, get) => ({
  state: initialTurnClient<StageSnapshot>(),
  dispatch: (a) => {
    const next = turnClientReducer(get().state, a);
    if (next !== get().state) set({ state: next });
    return next;
  },
}));

const snapshotStage = (): StageSnapshot => {
  const s = useScene.getState();
  return { activeScene: s.activeScene, selectedId: s.selectedId, leverDistance_m: s.leverDistance_m, fixture: useStageContent.getState().fixture, live: useStageContent.getState().live, scenePicked: useStageContent.getState().scenePicked };
};

function restoreStage(snap: StageSnapshot) {
  const s = useScene.getState();
  s.setScene(snap.activeScene);
  s.setLeverDistance(snap.leverDistance_m);
  s.highlight(snap.selectedId);
  useStageContent.getState().setFixture(snap.fixture, snap.live);
  useStageContent.getState().setScenePicked(snap.scenePicked);
}

function applyAction(a: Extract<TurnEvent, { type: "action" }>["action"], live: boolean) {
  const s = useScene.getState();
  switch (a.type) {
    case "select_scene": {
      const model = FIXTURE_SCENE_MODEL[a.scene] ?? (a.scene in MODELS ? (a.scene as SceneId) : null);
      if (model) {
        s.setScene(model);
        useStageContent.getState().setScenePicked(true);
      }
      break;
    }
    case "highlight_part":
      s.highlight(a.part);
      break;
    case "set_parameter":
      if (a.param === "weight_distance_m") s.setLeverDistance(a.value);
      break;
    // play_animation and show_choices are not used by the fake director.
  }
  useStageContent.getState().setFixture(true, live);
}

interface Voice {
  beginTurn: () => number;
  playTurn: (rev: number, lines: ReadonlyArray<{ text: string; parts?: CaptionPart[] }>, chips?: string[], source?: "fixture" | "live") => void;
  settle: (rev: number) => void;
}

const toCaptionParts = (parts: ReadonlyArray<{ text: string } | { value: string }>): CaptionPart[] => parts.map((p) => ("value" in p ? { value: p.value } : { text: p.text }));

/**
 * Runs a turn against /api/turn: the fake director's scripted case, or (with `live`, when the
 * server's live mode is on) the live professor, whose lines are badged "Live AI".
 */
export function useDemoTurn(voice: Voice, live = false) {
  const current = useRef<{ rev: number; abort: AbortController } | null>(null);

  /** Stop the turn in flight (interrupt): cancel the stream, tell the server, put the stage back. */
  const stop = useCallback(() => {
    const t = current.current;
    if (!t) return;
    current.current = null;
    t.abort.abort();
    void fetch("/api/turn/interrupt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: SESSION_ID, request_id: `turn_${t.rev}`, state_rev: t.rev }),
      keepalive: true,
    }).catch(() => {});
    const next = useTurnClient.getState().dispatch({ type: "interrupt" });
    if (next.restoreTo) restoreStage(next.restoreTo);
  }, []);

  // The voice controller's interrupt (Stop, Escape, the voice button) bumps the voice revision:
  // that is the signal to stop a turn still streaming. Speech and captions stop there already.
  useEffect(
    () =>
      useVoice.subscribe((s, prev) => {
        if (s.rev !== prev.rev && current.current && current.current.rev !== s.rev && useTurnClient.getState().state.status === "streaming") stop();
      }),
    [stop],
  );
  useEffect(() => () => stop(), [stop]);

  const start = useCallback(
    async (fakeCase: FakeCase, text: string) => {
      stop(); // a new turn replaces one still in flight (its changes are undone first)
      const rev = voice.beginTurn();
      const abort = new AbortController();
      current.current = { rev, abort };
      const turnClient = useTurnClient.getState();
      turnClient.dispatch({ type: "begin", rev, snapshot: snapshotStage() });
      const mine = () => current.current?.rev === rev;

      const fail = (message: string) => {
        if (!mine()) return;
        current.current = null;
        const s = useTurnClient.getState().state;
        if (s.restoreTo) restoreStage(s.restoreTo);
        voice.settle(rev);
        useVoice.getState().setHint({ text: message, kind: "error" });
      };

      const onEvent = (e: TurnEvent) => {
        if (!mine()) return;
        const before = useTurnClient.getState().state;
        const after = useTurnClient.getState().dispatch({ type: "event", event: e });
        if (after === before) return; // dropped by the gate
        if (e.type === "action") applyAction(e.action, live);
        if (after.status === "done") {
          current.current = null;
          if (after.narration.length) useStageContent.getState().setFixture(true, live);
          // The question is spoken and captioned last, so it stays on screen with its chips.
          const lines = after.narration.map((n) => ({ text: n.text, parts: toCaptionParts(n.parts) }));
          const question = after.prompt?.text ? { text: after.prompt.text, parts: toCaptionParts(after.prompt.parts) } : null;
          if (after.explanation) useTurnLog.getState().add({ rev, source: live ? "live" : "fixture", lines: [...lines], question, explanation: after.explanation });
          if (question) lines.push(question);
          voice.playTurn(rev, lines, after.prompt?.chips, live ? "live" : "fixture");
        }
        if (after.status === "error") fail(after.message ?? "Something went wrong. Nothing on the stage changed.");
      };

      try {
        const res = await fetch("/api/turn", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            session_id: SESSION_ID,
            state_rev: rev,
            case: fakeCase,
            // Only the text: the server keeps the history and decides how to read the reply.
            input: { text: text.slice(0, 500) },
          }),
          signal: abort.signal,
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        const parser = createSseParser(onEvent);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parser.push(decoder.decode(value, { stream: true }));
        }
      } catch {
        // Aborted by our own stop() (already handled), or the network failed: handled below.
      }
      if (!mine()) return;
      const ended = useTurnClient.getState().dispatch({ type: "streamEnded" });
      if (ended.status === "dropped") fail(DROPPED_MESSAGE);
    },
    [stop, voice, live],
  );

  return { start, stop };
}
