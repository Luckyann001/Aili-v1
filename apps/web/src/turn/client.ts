import { admit, nextRevision, type GateState, type TextPart, type TurnEvent, type TurnExplanation } from "@aili/engine";

// Client side of a fake-director turn (M2 slice 6). Pure: the hook in 6b feeds it stream events and
// applies what it returns (speech, captions, stage actions, a restore). Every event passes the
// gate: an older revision, a repeated or earlier sequence number, or another turn's ID is dropped.
// On an error, an interrupt or a dropped connection the stage goes back to how it was before the
// turn (`restoreTo`), and one plain line says what happened.

export const STOPPED_MESSAGE = "Stopped.";
export const DROPPED_MESSAGE = "The connection dropped. Nothing on the stage changed.";

export type TurnStatus = "idle" | "streaming" | "done" | "error" | "stopped" | "dropped";

export interface TurnClientState<Snapshot> {
  gate: GateState;
  status: TurnStatus;
  turnId: string | null;
  /** The stage before this turn, kept until the turn is done; applied back on any failure. */
  snapshot: Snapshot | null;
  /** Set when the stage must go back to `snapshot` (the hook applies it, then the next action clears it). */
  restoreTo: Snapshot | null;
  narration: Array<{ id: string; text: string; parts: TextPart[] }>;
  actions: Array<Extract<TurnEvent, { type: "action" }>["action"]>;
  calcs: Array<{ calc_id: string; outputs: Record<string, number> }>;
  prompt: { text: string; parts: TextPart[]; chips: string[] } | null;
  /** The text panel's content, sent with turn.done. */
  explanation: TurnExplanation | null;
  /** The analogy the turn used, if any, and whether it is words only (no picture exists). */
  analogy?: { id: string; title: string; words_only: boolean } | null;
  /** The turn gave numbers about the scene on stage (from the stage's settings). */
  stageNumbers?: boolean;
  /** One plain line: the error, "Stopped." or the dropped connection. */
  message: string | null;
}

export type TurnClientAction<Snapshot> =
  | { type: "begin"; rev: number; snapshot: Snapshot }
  | { type: "event"; event: TurnEvent }
  | { type: "interrupt" }
  | { type: "streamEnded" };

export function initialTurnClient<S>(): TurnClientState<S> {
  return { gate: { rev: 0, lastSeq: -1 }, status: "idle", turnId: null, snapshot: null, restoreTo: null, narration: [], actions: [], calcs: [], prompt: null, explanation: null, message: null };
}

const cleared = (): Pick<TurnClientState<unknown>, "narration" | "actions" | "calcs" | "prompt" | "explanation"> => ({ narration: [], actions: [], calcs: [], prompt: null, explanation: null });

export function turnClientReducer<S>(s: TurnClientState<S>, a: TurnClientAction<S>): TurnClientState<S> {
  switch (a.type) {
    case "begin":
      return { ...s, ...cleared(), gate: { rev: a.rev, lastSeq: -1 }, status: "streaming", turnId: `turn_${a.rev}`, snapshot: a.snapshot, restoreTo: null, message: null };

    case "event": {
      const e = a.event;
      if (s.status !== "streaming" || e.turn_id !== s.turnId) return s;
      const { ok, gate } = admit(s.gate, { rev: e.rev, seq: e.seq, action: e });
      if (!ok) return s;
      const t = { ...s, gate };
      switch (e.type) {
        case "turn.started":
          return t;
        case "narration":
          return { ...t, narration: [...t.narration, { id: e.id, text: e.text, parts: e.parts }] };
        case "action":
          return { ...t, actions: [...t.actions, e.action] };
        case "calc.result":
          return { ...t, calcs: [...t.calcs, { calc_id: e.calc_id, outputs: e.outputs }] };
        case "prompt":
          return { ...t, prompt: { text: e.text, parts: e.parts, chips: e.chips } };
        case "turn.done":
          return { ...t, status: "done", snapshot: null, explanation: e.explanation, analogy: e.analogy ?? null, stageNumbers: e.stage_numbers === true };
        case "turn.error":
          return { ...t, ...cleared(), status: "error", restoreTo: t.snapshot, snapshot: null, message: e.message };
      }
      return s;
    }

    case "interrupt":
      if (s.status !== "streaming") return s;
      return { ...s, ...cleared(), gate: nextRevision(s.gate), status: "stopped", restoreTo: s.snapshot, snapshot: null, message: STOPPED_MESSAGE };

    case "streamEnded":
      if (s.status !== "streaming") return s; // ended after done, error or stop: nothing to do
      return { ...s, ...cleared(), gate: nextRevision(s.gate), status: "dropped", restoreTo: s.snapshot, snapshot: null, message: DROPPED_MESSAGE };
  }
}

/**
 * A turn's actions, grouped by the line that shows them (M4 slice 1: visuals follow the explanation).
 * Line k is narration segment k; an action whose segment is not among them (an engine-chosen scene
 * on an answer with no narration) goes with the first line. Order within a line is kept.
 */
export function actionsByLine<A extends { at?: string }>(narrationIds: readonly string[], lineCount: number, actions: readonly A[]): A[][] {
  const out: A[][] = Array.from({ length: Math.max(lineCount, 1) }, () => []);
  for (const a of actions) {
    const k = a.at === undefined ? -1 : narrationIds.indexOf(a.at);
    out[k >= 0 && k < out.length ? k : 0]!.push(a);
  }
  return out;
}
