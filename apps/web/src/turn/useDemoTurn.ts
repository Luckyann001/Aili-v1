"use client";

import { useCallback, useEffect, useRef } from "react";
import { create } from "zustand";
import { createSseParser, type TurnEvent } from "@aili/engine";
import type { FakeCase } from "@aili/schemas";
import { MODELS, type SceneId } from "@/scene/models";
import type { AssetView } from "@/scene/assetPose";
import { useScene, type Actor } from "@/scene/sceneStore";
import { useVoice } from "@/voice/store";
import type { CaptionPart } from "@/voice/machine";
import { ANIMATIONS } from "@/scene/animations";
import { isServoParam, type EqStep, type ServoParams } from "@/scene/servoArm";
import { actionsByLine, DROPPED_MESSAGE, initialTurnClient, turnClientReducer, type TurnClientAction, type TurnClientState } from "./client";
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
  servo: ServoParams;
  /** The equation steps on stage (servo + arm). */
  equation: EqStep[];
  /** The micro servo's settled view (never a half state: a change in flight is kept as its end state). */
  servoView: AssetView;
  servoBy: Actor | null;
  /** Whether fixture content (from an earlier, completed turn) was already on stage. */
  fixture: boolean;
  /** Whether that earlier turn was a live one. */
  live: boolean;
  /** Whether a turn had already put a scene on stage (live mode's dimmed opening state). */
  scenePicked: boolean;
  /** The scene manifest that turn put up (the founder demo labels read it). */
  sceneId: string | null;
}

/** Test-fixture scenes are copies of real scenes; the stage draws the original's model. */
const FIXTURE_SCENE_MODEL: Record<string, SceneId> = { "fx-lever": "lever-analogy", "fx-servo-arm": "servo-arm" };

/** Live turns whose answer failed the checks twice: what the learner sees (their text is kept). */
export const REJECTED_LIVE_MESSAGE = "I couldn't put a good answer together for that. Your message is back in the box: try rephrasing it, or send it again. Nothing on the stage changed.";

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
  return { activeScene: s.activeScene, selectedId: s.selectedId, leverDistance_m: s.leverDistance_m, servo: s.servo, equation: s.equation, servoView: s.servoView, servoBy: s.servoBy, fixture: useStageContent.getState().fixture, live: useStageContent.getState().live, scenePicked: useStageContent.getState().scenePicked, sceneId: useStageContent.getState().sceneId };
};

function restoreStage(snap: StageSnapshot) {
  const s = useScene.getState();
  s.setScene(snap.activeScene);
  s.setLeverDistance(snap.leverDistance_m);
  useScene.setState({ servo: snap.servo });
  s.setEquation(snap.equation);
  if (useScene.getState().servoView !== snap.servoView) useScene.getState().setServoView(snap.servoView, snap.servoBy, { snap: true });
  s.highlight(snap.selectedId);
  useStageContent.getState().setFixture(snap.fixture, snap.live);
  useStageContent.getState().setScenePicked(snap.scenePicked);
  useStageContent.getState().setSceneId(snap.sceneId);
}

/** Applies one stage action as its line starts; an animation runs while the voice is still at `rev`. */
function applyAction(a: Extract<TurnEvent, { type: "action" }>["action"], live: boolean, rev: number) {
  const s = useScene.getState();
  switch (a.type) {
    case "select_scene": {
      const model = FIXTURE_SCENE_MODEL[a.scene] ?? (a.scene in MODELS ? (a.scene as SceneId) : null);
      if (model) {
        s.setScene(model);
        useStageContent.getState().setScenePicked(true);
        useStageContent.getState().setSceneId(a.scene);
      }
      break;
    }
    case "highlight_part":
      s.highlight(a.part);
      break;
    case "set_parameter":
      // The validator checked the setting exists on the scene on stage and its bounds; the
      // learner's rating is never in this list (Aili may not set it).
      if (a.param === "weight_distance_m") s.setLeverDistance(a.value);
      else if (s.activeScene === "servo-arm" && isServoParam(a.param)) s.setServoParam(a.param, a.value);
      else console.warn(`[turn] the page has no setting "${a.param}" on this scene`);
      break;
    case "play_animation": {
      const play = ANIMATIONS[a.animation];
      // Never a silent no-op: an animation the page cannot play is said in the console.
      if (play) void play(() => useVoice.getState().rev === rev);
      else console.warn(`[turn] the page has no animation "${a.animation}"`);
      break;
    }
    // show_choices is for prepared lessons; the validator rejects it from the director.
  }
  useStageContent.getState().setFixture(true, live);
}

interface Voice {
  beginTurn: () => number;
  playTurn: (
    rev: number,
    lines: ReadonlyArray<{ text: string; parts?: CaptionPart[] }>,
    chips?: string[],
    source?: "fixture" | "live",
    hooks?: { onLine?: (seq: number) => void; onDone?: () => void },
  ) => void;
  settle: (rev: number) => void;
}

const toCaptionParts = (parts: ReadonlyArray<{ text: string } | { value: string }>): CaptionPart[] => parts.map((p) => ("value" in p ? { value: p.value } : { text: p.text }));

/**
 * Runs a turn against /api/turn: the fake director's scripted case, or (with `live`, when the
 * server's live mode is on) the live professor, whose lines are badged "Live AI".
 */
export function useDemoTurn(voice: Voice, live = false, keepText?: (text: string) => void) {
  const current = useRef<{ rev: number; abort: AbortController } | null>(null);
  /** A completed turn whose lines are still playing: the last narration segment shown so far. */
  const playing = useRef<{ rev: number; segments: string[]; shown: number } | null>(null);
  /** How far an interrupted turn got, sent inside the NEXT turn's request (never as its own message). */
  const pendingShown = useRef<{ state_rev: number; shown_through: string | null } | null>(null);

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
  // A completed turn still playing its lines stops too (M4 slice 1): its queued actions never run,
  // and the server is told which segment the learner reached, so its stage matches the page.
  useEffect(
    () =>
      useVoice.subscribe((s, prev) => {
        if (s.rev === prev.rev) return;
        if (current.current && current.current.rev !== s.rev && useTurnClient.getState().state.status === "streaming") stop();
        const p = playing.current;
        if (p && p.rev !== s.rev) {
          playing.current = null;
          useStageContent.getState().setWordsOnlyAnalogy(null);
          useTurnLog.getState().markShown(p.rev, p.shown);
          // Kept for the next turn's request, which the server reads before this session's stage, so
          // the stage can never include actions the learner did not see.
          pendingShown.current = { state_rev: p.rev, shown_through: p.shown > 0 ? (p.segments[Math.min(p.shown, p.segments.length) - 1] ?? null) : null };
        }
      }),
    [stop],
  );
  useEffect(() => () => stop(), [stop]);

  const start = useCallback(
    async (fakeCase: FakeCase, text: string) => {
      stop(); // a new turn replaces one still in flight (its changes are undone first)
      const rev = voice.beginTurn();
      useStageContent.getState().setWordsOnlyAnalogy(null); // a new turn: the last turn's note goes
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
        // Live: both attempts failed the checks. A friendly line, and the learner's words go back in
        // the box to rephrase or resend (Lucky's decision 2026-10-13); the stage is restored below.
        if (live && e.type === "turn.error" && (e.reason === "validation" || e.reason === "pedagogy") && useTurnClient.getState().state.turnId === e.turn_id) {
          useTurnClient.getState().dispatch({ type: "event", event: e });
          keepText?.(text);
          return fail(REJECTED_LIVE_MESSAGE);
        }
        const before = useTurnClient.getState().state;
        const after = useTurnClient.getState().dispatch({ type: "event", event: e });
        if (after === before) return; // dropped by the gate
        // Actions are NOT applied as they arrive (M4 slice 1): each waits for its narration segment.
        if (after.status === "done") {
          current.current = null;
          // The question is spoken and captioned last, so it stays on screen with its chips.
          const lines = after.narration.map((n) => ({ text: n.text, parts: toCaptionParts(n.parts) }));
          const question = after.prompt?.text ? { text: after.prompt.text, parts: toCaptionParts(after.prompt.parts) } : null;
          if (after.explanation) useTurnLog.getState().add({ rev, source: live ? "live" : "fixture", lines: [...lines], question, explanation: after.explanation });
          if (question) lines.push(question);
          const segments = after.narration.map((n) => n.id);
          const byLine = actionsByLine(segments, lines.length, after.actions);
          playing.current = { rev, segments, shown: 0 };
          voice.playTurn(rev, lines, after.prompt?.chips, live ? "live" : "fixture", {
            // As line `seq` starts: its actions, then its caption and speech.
            onLine: (seq) => {
              if (playing.current?.rev === rev) playing.current.shown = Math.min(seq + 1, segments.length);
              if (seq === 0) {
                useStageContent.getState().setFixture(true, live);
                // An analogy with no picture is said to be words only, as its lines start.
                useStageContent.getState().setWordsOnlyAnalogy(after.analogy?.words_only ? after.analogy.title : null);
                // Numbers about the scene from the stage's settings: the "last turn's settings" note goes.
                if (after.stageNumbers) useStageContent.getState().stageNumbersTurn();
              }
              for (const a of byLine[seq] ?? []) applyAction(a, live, rev);
            },
            onDone: () => {
              if (playing.current?.rev === rev) playing.current = null;
            },
          });
        }
        if (after.status === "error") fail(after.message ?? "Something went wrong. Nothing on the stage changed.");
      };

      const note = pendingShown.current;
      pendingShown.current = null;
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
            ...(note ? { previous_shown: note } : {}),
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
    [stop, voice, live, keepText],
  );

  return { start, stop };
}
