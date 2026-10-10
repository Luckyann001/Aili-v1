// Loaded lazily when a lesson starts: validates the scenes and the beat script with the engine
// before anything plays (unknown IDs, out-of-bounds values, numbers in narration, pacing).
// Drafts are excluded unless NEXT_PUBLIC_AILI_INCLUDE_DRAFTS=1 (dev only, in .env.local).
import { validateBeats, validateRegistry, visibleScenes } from "@aili/engine";
import concepts from "../../../../content/robotics/concepts.json";
import script from "../../../../content/robotics/beats/beginner-lever.json";
import arm from "../../../../content/robotics/scenes/base-joint-arm.json";
import lever from "../../../../content/robotics/scenes/lever-analogy.json";
import type { BeatDef } from "./runner";

export const LESSON_PLACEHOLDERS = ["effort_far_vs_near"] as const;

export function loadBeginnerLever(): { beats: BeatDef[]; title: string } | { errors: string[] } {
  const registry = validateRegistry(
    [
      { file: "base-joint-arm.json", data: arm },
      { file: "lever-analogy.json", data: lever },
    ],
    concepts,
  );
  if (registry.errors.length) return { errors: registry.errors };
  // Direct access so Next inlines the value at build time.
  const includeDrafts = process.env.NEXT_PUBLIC_AILI_INCLUDE_DRAFTS === "1";
  const scenes = visibleScenes(registry.scenes, { includeDrafts });
  const result = validateBeats(script, { scenes, placeholders: LESSON_PLACEHOLDERS });
  if (!result.script) return { errors: result.errors };
  return { beats: result.script.beats as BeatDef[], title: result.script.title };
}
