import { z } from "zod";
import { ConceptId, Fidelity, ReviewStatus, reviewRules } from "./base";

// Scene registry (architecture §4, visuals §1–2). Scenes are JSON files in git; every field is
// declared and unknown fields are rejected. The AI never publishes: a scene that is "reviewed" or
// "published" must name the human reviewer and the date. Files written by the AI stay "draft".

export const KebabId = z.string().regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, "IDs are lowercase kebab-case, e.g. lever-analogy");
export const Level = z.enum(["L1", "L2", "L3"]);
/** Where the visual came from (visuals doc §1–2). */
export const Provenance = z.enum(["authored", "commissioned", "open_licensed", "ai_composed", "ai_generated"]);

export const ScenePart = z.object({ id: KebabId, name: z.string().min(1) }).strict();

/** A setting a scene allows, with unit and bounds. The unit is part of the ID (arm_length_m). */
export const SceneParam = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*_(m|kg|deg)$/, "setting IDs end with their unit: _m, _kg or _deg"),
    label: z.string().min(1),
    unit: z.enum(["m", "kg", "deg"]),
    min: z.number(),
    max: z.number(),
    step: z.number().positive(),
    default: z.number(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (!(p.min < p.max)) ctx.addIssue({ code: "custom", message: `${p.id}: min must be below max` });
    if (p.default < p.min || p.default > p.max) ctx.addIssue({ code: "custom", message: `${p.id}: default ${p.default} is outside ${p.min}–${p.max}` });
    if (!p.id.endsWith(`_${p.unit}`)) ctx.addIssue({ code: "custom", message: `${p.id}: unit "${p.unit}" does not match the ID` });
  });

export const SceneAnimation = z.object({ id: KebabId, description: z.string().min(1) }).strict();

export const Review = z.object({ by: z.string().min(2), on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict();

export const SceneManifest = z
  .object({
    id: KebabId,
    title: z.string().min(1),
    teaches: z.array(ConceptId).min(1),
    level: Level,
    fidelity: Fidelity,
    version: z.string().regex(/^\d+\.\d+\.\d+$/, "version is semver, e.g. 0.1.0"),
    review_status: ReviewStatus,
    provenance: Provenance,
    review: Review.optional(),
    /** Test-fixture scene: loaded only with the dev flag, refused in production (m2-plan decision 5). */
    test_fixture: z.literal(true).optional(),
    parts: z.array(ScenePart).min(1),
    params: z.array(SceneParam).default([]),
    animations: z.array(SceneAnimation).default([]),
    /** Fixed inputs for the scene's solver (SI, unit in the name). Never shown as results. */
    solver: z.object({ id: z.string().min(1), constants: z.record(z.string().regex(/_(m|kg|deg)$/), z.number()) }).strict().optional(),
  })
  .strict()
  .superRefine((s, ctx) => {
    reviewRules(s, ctx);
    for (const [what, ids] of [
      ["part", s.parts.map((p) => p.id)],
      ["setting", s.params.map((p) => p.id)],
      ["animation", s.animations.map((a) => a.id)],
    ] as const) {
      const dup = ids.find((id, i) => ids.indexOf(id) !== i);
      if (dup) ctx.addIssue({ code: "custom", message: `${s.id}: duplicate ${what} ID "${dup}"` });
    }
  });
export type SceneManifest = z.infer<typeof SceneManifest>;

/** Minimal concept node for now (the full concept graph is M4). */
export const ConceptSeed = z.object({ id: ConceptId, title: z.string().min(1), review_status: ReviewStatus }).strict();
export type ConceptSeed = z.infer<typeof ConceptSeed>;

export { REVIEW_LABEL } from "./labels";
