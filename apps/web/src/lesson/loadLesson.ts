// Loaded lazily when a lesson starts: validates the scenes and the beat script with the engine
// before anything plays (unknown IDs, out-of-bounds values, numbers in narration, pacing).
// Drafts are excluded unless NEXT_PUBLIC_AILI_INCLUDE_DRAFTS=1 (dev only, in .env.local).
import { validateBeats, validateRegistry, visibleScenes } from "@aili/engine";
import concepts from "../../../../content/robotics/concepts.json";
import leverScript from "../../../../content/robotics/beats/beginner-lever.json";
import droneScript from "../../../../content/robotics/beats/drone-pid.json";
import arm from "../../../../content/robotics/scenes/base-joint-arm.json";
import lever from "../../../../content/robotics/scenes/lever-analogy.json";
import drone from "../../../../content/robotics/scenes/drone-altitude.json";
import cruise from "../../../../content/robotics/scenes/cruise-control-hill.json";
import type { BeatDef } from "./runner";
import { LESSONS, type LessonId } from "./lessons";

export const LESSON_PLACEHOLDERS = LESSONS["beginner-lever"].placeholders;

const SOURCES: Record<LessonId, { script: unknown; scenes: Array<{ file: string; data: unknown }> }> = {
  "beginner-lever": {
    script: leverScript,
    scenes: [
      { file: "base-joint-arm.json", data: arm },
      { file: "lever-analogy.json", data: lever },
    ],
  },
  "drone-pid": {
    script: droneScript,
    scenes: [
      { file: "drone-altitude.json", data: drone },
      { file: "cruise-control-hill.json", data: cruise },
    ],
  },
};

export function loadLesson(id: LessonId): { beats: BeatDef[]; title: string } | { errors: string[] } {
  const src = SOURCES[id];
  const registry = validateRegistry(src.scenes, concepts);
  if (registry.errors.length) return { errors: registry.errors };
  // Direct access so Next inlines the value at build time.
  const includeDrafts = process.env.NEXT_PUBLIC_AILI_INCLUDE_DRAFTS === "1";
  const scenes = visibleScenes(registry.scenes, { includeDrafts });
  const result = validateBeats(src.script, { scenes, placeholders: LESSONS[id].placeholders });
  if (!result.script) return { errors: result.errors };
  return { beats: result.script.beats as BeatDef[], title: result.script.title };
}

/** The servo lesson (kept as the second lesson and backup demo). */
export const loadBeginnerLever = () => loadLesson("beginner-lever");
