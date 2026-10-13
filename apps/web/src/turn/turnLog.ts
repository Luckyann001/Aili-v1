import type { TurnExplanation } from "@aili/engine";
import { create } from "zustand";
import type { CaptionPart } from "@/voice/machine";

// Completed turns on this page, for the text explanation panel (docs/m3-live-browser-plan.md slice 3):
// what Aili said, the question it asked, and the turn's explanation. This page only, in memory; the
// session itself lives on the server. Kept short: the panel shows the current step by default.

export interface LoggedTurn {
  rev: number;
  source: "live" | "fixture";
  lines: Array<{ text: string; parts?: CaptionPart[] }>;
  question: { text: string; parts?: CaptionPart[] } | null;
  explanation: TurnExplanation;
}

const MAX_TURNS = 30;

export const useTurnLog = create<{ turns: LoggedTurn[]; add: (t: LoggedTurn) => void }>()((set) => ({
  turns: [],
  add: (t) => set((s) => ({ turns: [...s.turns, t].slice(-MAX_TURNS) })),
}));
