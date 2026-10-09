import { create } from "zustand";

/** Layout state of the Learn stage only (which side view is open, captions on/off). */
export type SideView = "explanation" | "library";

export interface LearnUiState {
  side: SideView | null;
  captionsOn: boolean;
  openSide: (view: SideView) => void;
  closeSide: () => void;
  toggleSide: (view: SideView) => void;
  toggleCaptions: () => void;
}

export const createLearnUiSlice = (set: (fn: (s: LearnUiState) => Partial<LearnUiState>) => void): LearnUiState => ({
  side: null, // the text panel is usually closed (stage layout doc)
  captionsOn: true, // captions are always available and on by default
  openSide: (view) => set(() => ({ side: view })),
  closeSide: () => set(() => ({ side: null })),
  toggleSide: (view) => set((s) => ({ side: s.side === view ? null : view })),
  toggleCaptions: () => set((s) => ({ captionsOn: !s.captionsOn })),
});

export const useLearnUi = create<LearnUiState>()((set) => createLearnUiSlice(set));
