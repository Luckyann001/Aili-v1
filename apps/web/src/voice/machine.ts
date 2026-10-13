// Pure voice state machine (stage layout doc §1: idle / listening / thinking / speaking / error).
//
// Stale-action rule: every queued action carries the revision (`rev`) it was created under.
// A new user input or an interrupt bumps `rev`, so anything queued earlier is dropped here even
// if a timer or speech callback still fires late. Within one revision, caption segments carry a
// sequence number and must arrive in order; repeats or out-of-order segments are dropped.

export type VoiceStatus = "idle" | "listening" | "thinking" | "speaking" | "error";

export interface Caption {
  text: string;
  rev: number;
  seq: number;
  /** Where the line came from; captions carry the matching badge. Absent means "prepared". */
  source?: "prepared" | "fixture" | "live";
  /** The line split so calculated values can be marked (fake-director turns). */
  parts?: CaptionPart[];
}

/** Plain text, or a value a solver calculated. */
export type CaptionPart = { text: string } | { value: string };

export interface VoiceState {
  status: VoiceStatus;
  rev: number;
  caption: Caption | null;
  error: string | null;
  /** Short note shown after a stop, e.g. "Stopped.". Cleared by the next action. */
  note: string | null;
  /** Quick replies offered because Aili just asked a question; cleared by the learner's next action. */
  prompt: { chips: string[] } | null;
}

export type VoiceEvent =
  | { type: "listen" }
  | { type: "listenEnd"; rev: number }
  | { type: "submit" }
  | { type: "speak"; rev: number; seq: number; text: string; source?: Caption["source"]; parts?: CaptionPart[] }
  | { type: "done"; rev: number; chips?: string[] }
  | { type: "error"; rev: number; message: string }
  | { type: "interrupt" }
  | { type: "reset" }
  | { type: "demoSet"; status: VoiceStatus; message?: string };

export const initialVoiceState: VoiceState = { status: "idle", rev: 0, caption: null, error: null, note: null, prompt: null };

const isStale = (state: VoiceState, rev: number) => rev !== state.rev;

export function voiceReducer(state: VoiceState, event: VoiceEvent): VoiceState {
  switch (event.type) {
    case "listen":
      // Starting to listen is new user input: anything still queued is now stale.
      return { ...state, status: "listening", rev: state.rev + 1, error: null, note: null, prompt: null };

    case "listenEnd":
      if (isStale(state, event.rev) || state.status !== "listening") return state;
      return { ...state, status: "idle" };

    case "submit":
      return { ...state, status: "thinking", rev: state.rev + 1, caption: null, error: null, note: null, prompt: null };

    case "speak": {
      if (isStale(state, event.rev)) return state;
      if (state.status !== "thinking" && state.status !== "speaking") return state;
      if (state.caption && state.caption.rev === event.rev && event.seq <= state.caption.seq) return state;
      return { ...state, status: "speaking", caption: { text: event.text, rev: event.rev, seq: event.seq, source: event.source, parts: event.parts } };
    }

    case "done":
      if (isStale(state, event.rev) || state.status !== "speaking") return state;
      return { ...state, status: "idle", prompt: event.chips?.length ? { chips: event.chips } : null };

    case "error":
      if (isStale(state, event.rev)) return state;
      return { ...state, status: "error", error: event.message };

    case "interrupt":
      if (state.status === "idle" && !state.caption) return { ...state, rev: state.rev + 1, prompt: null };
      return { ...state, status: "idle", rev: state.rev + 1, caption: null, error: null, note: "Stopped.", prompt: null };

    case "reset":
      return { ...state, status: "idle", error: null, note: null };

    case "demoSet":
      return {
        ...state,
        status: event.status,
        error: event.status === "error" ? (event.message ?? "Demo error") : null,
        caption: event.status === "speaking" ? { text: "Demo caption while speaking.", rev: state.rev, seq: 0 } : null,
        note: null,
        prompt: null,
      };
  }
}

/** True when Aili is busy and the voice button should act as Stop. */
export const isBusy = (s: VoiceStatus) => s === "listening" || s === "thinking" || s === "speaking";
