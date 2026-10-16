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

/** Each setting unit and the suffix its ID must end with (newton-metres: `_nm`). */
export const PARAM_UNIT_SUFFIX = { m: "_m", kg: "_kg", deg: "_deg", "N·m": "_nm" } as const;

/** A setting a scene allows, with unit and bounds. The unit is part of the ID (arm_length_m). */
export const SceneParam = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*_(m|kg|deg|nm)$/, "setting IDs end with their unit: _m, _kg, _deg or _nm"),
    label: z.string().min(1),
    unit: z.enum(["m", "kg", "deg", "N·m"]),
    min: z.number(),
    max: z.number(),
    step: z.number().positive(),
    default: z.number().optional(),
    /**
     * The learner enters this value from their own datasheet (a servo's rated torque): it has no
     * default, so no number is ever presented as a real product's spec, and Aili may not set it.
     */
    learner_supplied: z.literal(true).optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (!(p.min < p.max)) ctx.addIssue({ code: "custom", message: `${p.id}: min must be below max` });
    if (p.learner_supplied && p.default !== undefined) ctx.addIssue({ code: "custom", message: `${p.id}: a learner-supplied setting has no default` });
    if (!p.learner_supplied && p.default === undefined) ctx.addIssue({ code: "custom", message: `${p.id}: a default is required` });
    if (p.default !== undefined && (p.default < p.min || p.default > p.max)) ctx.addIssue({ code: "custom", message: `${p.id}: default ${p.default} is outside ${p.min}–${p.max}` });
    if (!p.id.endsWith(PARAM_UNIT_SUFFIX[p.unit])) ctx.addIssue({ code: "custom", message: `${p.id}: unit "${p.unit}" does not match the ID` });
  });

export const SceneAnimation = z
  .object({
    id: KebabId,
    description: z.string().min(1),
    /** Plays on the scene's 3D asset (explode, open, assemble): offered to the professor only when that asset is published. */
    uses_asset: z.literal(true).optional(),
  })
  .strict();

/**
 * Who reviewed an item, when, and in what role. "founder": the founder's review for the demo, a
 * documented exception to the expert-review rule (CLAUDE.md); shown as "reviewed by the founder, not an
 * expert reviewer". "expert": a domain expert. Absent role: an expert review, as before.
 */
export const ReviewRole = z.enum(["founder", "expert"]);
export const Review = z.object({ by: z.string().min(2), on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), role: ReviewRole.optional() }).strict();

/** A 3D asset's ID (asset manifests live in the capability registry). */
export const AssetId = z.string().regex(/^asset\.[a-z0-9]+(-[a-z0-9]+)*$/, "IDs look like asset.some-name");

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
    /** Touching this scene needs the learner's explicit acknowledgement (see ConceptSeed.safety_critical). */
    safety_critical: z.boolean().default(false),
    /** Test-fixture scene: loaded only with the dev flag, refused in production (m2-plan decision 5). */
    test_fixture: z.literal(true).optional(),
    parts: z.array(ScenePart).min(1),
    params: z.array(SceneParam).default([]),
    animations: z.array(SceneAnimation).default([]),
    /** The 3D asset this scene draws, if any (its manifest is in the capability registry). */
    asset: AssetId.optional(),
    /** Fixed inputs for the scene's solver (SI, unit in the name). Never shown as results. */
    solver: z.object({ id: z.string().min(1), constants: z.record(z.string().regex(/_(m|kg|deg|m_per_s2)$/), z.number()) }).strict().optional(),
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
export const ConceptSeed = z
  .object({
    id: ConceptId,
    title: z.string().min(1),
    review_status: ReviewStatus,
    /** Skipping or assigning work on this concept needs the learner's explicit acknowledgement. M4 decides which concepts get it. */
    safety_critical: z.boolean().default(false),
    /** Concepts to understand first (docs/m4-plan.md §1); each must exist in the graph. */
    prerequisites: z.array(ConceptId).default([]),
  })
  .strict();
export type ConceptSeed = z.infer<typeof ConceptSeed>;

export { REVIEW_LABEL } from "./labels";

/**
 * Teaching thresholds (config/teaching-thresholds.json): the servo + arm scene's torque margin
 * bands, margin = the learner's rated torque ÷ the solver's needed torque. Config, not code: a
 * design choice for Lucky, not engineering fact, and labelled as such until a roboticist reviews it.
 */
export const TeachingThresholds = z
  .object({
    _about: z.string().min(1),
    torque_margin: z
      .object({
        fail_below: z.number().positive(),
        pass_at_or_above: z.number().positive(),
        label: z.string().min(1),
        review_status: ReviewStatus,
      })
      .strict()
      .refine((t) => t.fail_below < t.pass_at_or_above, "fail_below must be below pass_at_or_above"),
  })
  .strict();
export type TeachingThresholds = z.infer<typeof TeachingThresholds>;
