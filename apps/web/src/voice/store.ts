import { create } from "zustand";
import { initialVoiceState, voiceReducer, type VoiceEvent, type VoiceState } from "./machine";
import type { RecognitionMode } from "./recognition";

/** A short system message under the stage (not Aili speaking), e.g. an error or "not available". */
export interface VoiceHint {
  text: string;
  kind: "info" | "error";
}

export interface VoiceStore extends VoiceState {
  /** Recognition mode the code detected for the current listening session (null until detected). */
  mode: RecognitionMode | null;
  hint: VoiceHint | null;
  dispatch: (event: VoiceEvent) => void;
  setMode: (mode: RecognitionMode | null) => void;
  setHint: (hint: VoiceHint | null) => void;
}

export const useVoice = create<VoiceStore>()((set) => ({
  ...initialVoiceState,
  mode: null,
  hint: null,
  // The reducer returns the same object for dropped (stale) events, so nothing re-renders.
  dispatch: (event) => set((s) => voiceReducer(s, event) as VoiceStore),
  setMode: (mode) => set({ mode }),
  setHint: (hint) => set({ hint }),
}));
