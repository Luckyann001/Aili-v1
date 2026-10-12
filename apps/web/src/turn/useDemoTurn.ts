"use client";

import { useCallback, useEffect, useRef } from "react";
import { create } from "zustand";
import { createSseParser, type SessionState, type TurnEvent } from "@aili/engine";
import type { FakeCase } from "@aili/schemas";
import { MODELS, type SceneId } from "@/scene/models";
import { useScene } from "@/scene/sceneStore";
import { useVoice } from "@/voice/store";
import type { CaptionPart } from "@/voice/machine";
import { DROPPED_MESSAGE, initialTurnClient, turnClientReducer, type TurnClientAction, type TurnClientState } from "./client";
import { useStageContent } from "./stageContent";

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
}

/** Test-fixture scenes are copies of real scenes; the stage draws the original's model. */
const FIXTURE_SCENE_MODEL: Record<string, SceneId> = { "fx-lever": "lever-analogy" };

const START: SessionState = { history: { posture: "learning", learner_level: "some_knowledge", entries: [] } };

export const useTurnClient = create<{ state: TurnClientState<StageSnapshot>; dispatch: (a: TurnClientAction<StageSnapshot>) => TurnClientState<StageSnapshot> }>()((set, get) => ({
  state: initialTurnClient<StageSnapshot>(START),
  dispatch: (a) => {
    const next = turnClientReducer(get().state, a);
    if (next !== get().state) set({ state: next });
    return next;
  },
}));

const snapshotStage = (): StageSnapshot => {
  const s = useScene.getState();
  return { activeScene: s.activeScene, selectedId: s.selectedId, leverDistance_m: s.leverDistance_m };
};

function restoreStage(snap: StageSnapshot) {
  const s = useScene.getState();
  s.setScene(snap.activeScene);
  s.setLeverDistance(snap.leverDistance_m);
  s.highlight(snap.selectedId);
  useStageContent.getState().setFixture(false);
}

function applyAction(a: Extract<TurnEvent, { type: "action" }>["action"]) {
  const s = useScene.getState();
  switch (a.type) {
    case "select_scene": {
      const model = FIXTURE_SCENE_MODEL[a.scene] ?? (a.scene in MODELS ? (a.scene as SceneId) : null);
      if (model) s.setScene(model);
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
  useStageContent.getState().setFixture(true);
}

interface Voice {
  beginTurn: () => number;
  playTurn: (rev: number, lines: ReadonlyArray<{ text: string; parts?: CaptionPart[] }>, chips?: string[]) => void;
  settle: (rev: number) => void;
}

const toCaptionParts = (parts: ReadonlyArray<{ text: string } | { value: string }>): CaptionPart[] => parts.map((p) => ("value" in p ? { value: p.value } : { text: p.text }));

export function useDemoTurn(voice: Voice) {
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
      body: JSON.stringify({ request_id: `turn_${t.rev}`, state_rev: t.rev }),
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
      const answered = useVoice.getState().prompt !== null; // a reply to Aili's open question
      stop(); // a new turn replaces one still in flight (its changes are undone first)
      const rev = voice.beginTurn();
      const abort = new AbortController();
      current.current = { rev, abort };
      const turnClient = useTurnClient.getState();
      turnClient.dispatch({ type: "begin", rev, snapshot: snapshotStage() });
      const committed = turnClient.state.committed;
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
        if (e.type === "action") applyAction(e.action);
        if (after.status === "done") {
          current.current = null;
          if (after.narration.length) useStageContent.getState().setFixture(true);
          voice.playTurn(rev, after.narration.map((n) => ({ text: n.text, parts: toCaptionParts(n.parts) })), after.prompt?.chips);
        }
        if (after.status === "error") fail(after.message ?? "Something went wrong. Nothing on the stage changed.");
      };

      try {
        const res = await fetch("/api/turn", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            state_rev: rev,
            case: fakeCase,
            input: { text: text.slice(0, 500), reply: { answered_prompt: answered } },
            state: { history: committed.history, ...(committed.activeScene ? { active_scene: committed.activeScene } : {}) },
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
    [stop, voice],
  );

  return { start, stop };
}
