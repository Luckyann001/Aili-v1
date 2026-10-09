import { beforeEach, describe, expect, it } from "vitest";
import { createStore, type StoreApi } from "zustand/vanilla";
import { createLearnUiSlice, type LearnUiState } from "./learnUi";

let store: StoreApi<LearnUiState>;
beforeEach(() => {
  store = createStore<LearnUiState>()((set) => createLearnUiSlice(set));
});

describe("learn UI state", () => {
  it("starts with the side panel closed and captions on", () => {
    expect(store.getState().side).toBeNull();
    expect(store.getState().captionsOn).toBe(true);
  });

  it("opens, switches and closes the side view", () => {
    store.getState().openSide("explanation");
    expect(store.getState().side).toBe("explanation");
    store.getState().openSide("library");
    expect(store.getState().side).toBe("library");
    store.getState().closeSide();
    expect(store.getState().side).toBeNull();
  });

  it("toggle closes the open view and switches from the other", () => {
    store.getState().toggleSide("library");
    expect(store.getState().side).toBe("library");
    store.getState().toggleSide("explanation");
    expect(store.getState().side).toBe("explanation");
    store.getState().toggleSide("explanation");
    expect(store.getState().side).toBeNull();
  });

  it("toggles captions", () => {
    store.getState().toggleCaptions();
    expect(store.getState().captionsOn).toBe(false);
  });
});
