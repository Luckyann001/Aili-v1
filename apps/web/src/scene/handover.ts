import { settingsAfterSelect, type StageScene, type StageSettings } from "@aili/engine/stage";
import { MANIFESTS } from "./manifests";
import type { SceneId } from "./models";
import { useScene, type SceneState } from "./sceneStore";
import type { ServoParams } from "./servoArm";

// A turn changes the scene on stage (slice B, 17 Oct 2026). The page uses the SAME shared stage
// function as the server (settingsAfterSelect, from @aili/engine), with the scenes' manifests: the new
// scene starts from its defaults plus any human-written handover from the scene on stage (the bag's
// reach becomes the servo's arm length and load distance), so the two can never disagree.

const SCENES = Object.values(MANIFESTS) as unknown as StageScene[];

/** The settings of a scene on stage, as the shared function names them. */
export function settingsOf(id: SceneId, s: Pick<SceneState, "servo" | "leverDistance_m" | "bagReach_m"> & Partial<Pick<SceneState, "drone">>): StageSettings {
  if (id === "servo-arm") return { ...s.servo };
  if (id === "drone-altitude") return { ...(s.drone?.settings ?? {}) };
  if (id === "lever-analogy") return { weight_distance_m: s.leverDistance_m };
  if (id === "bag-hold") return { reach_m: s.bagReach_m };
  return {};
}

/**
 * Put `to` on stage: its settings from the shared function; a part picked on the old scene becomes its
 * counterpart if the handover maps it (bag → load). Equation steps clear and labels switch with setScene.
 */
export function changeScene(to: SceneId) {
  const s = useScene.getState();
  const from = s.activeScene;
  if (from === to) return;
  const next = settingsAfterSelect(SCENES, { scene: from, settings: settingsOf(from, s) }, to) ?? {};
  const mapped = (MANIFESTS[from] as { handover?: Array<{ to: string; parts?: Array<{ from: string; to: string }> }> }).handover
    ?.find((h) => h.to === to)
    ?.parts?.find((p) => p.from === s.selectedId)?.to;
  s.setScene(to);
  if (to === "servo-arm") useScene.setState({ servo: next as ServoParams });
  if (to === "lever-analogy" && next.weight_distance_m !== undefined) s.setLeverDistance(next.weight_distance_m);
  if (to === "bag-hold" && next.reach_m !== undefined) s.setBagReach(next.reach_m);
  if (mapped) s.highlight(mapped);
}
