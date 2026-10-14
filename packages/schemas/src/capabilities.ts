import { z } from "zod";
import { ConceptId, Fidelity, ReviewStatus, reviewRules } from "./base";
import { KebabId, Level, Provenance, Review } from "./scene";

// Capability registry beyond scenes (architecture §4 and §11): solvers, simulations, analogies,
// and evidence (a source plus a reading item). JSON in git, every field declared, unknown fields
// rejected. The AI never publishes: "reviewed"/"published" needs a named human reviewer and date.
// Test fixtures (decision 5 in docs/m2-plan.md) may be "published" for demos and tests only,
// never carry a review record, and are refused by the production loader.

const capId = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}\\.[a-z0-9]+(-[a-z0-9]+)*$`), `IDs look like ${prefix}.some-name`);
export const SolverId = capId("solver");
export const SimulationId = capId("sim");
export const AnalogyId = capId("analogy");
export const SourceId = capId("src");
export const ReadingId = capId("read");

const Semver = z.string().regex(/^\d+\.\d+\.\d+$/, "version is semver, e.g. 0.1.0");
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Units allowed at a solver's edges, and the suffix each field name must carry (arm_length_m).
 * Dimensionless fields ("ratio") are named share_of_* or *_ratio.
 */
export const UNIT_SUFFIX = {
  m: "_m",
  kg: "_kg",
  "kg/m": "_kg_per_m",
  deg: "_deg",
  "N·m": "_nm",
  N: "_n",
  "kgf·cm": "_kgf_cm",
  ratio: null,
} as const;
export const Unit = z.enum(Object.keys(UNIT_SUFFIX) as [keyof typeof UNIT_SUFFIX, ...Array<keyof typeof UNIT_SUFFIX>]);
export type Unit = z.infer<typeof Unit>;

const FieldName = z.string().regex(/^[a-z][a-z0-9_]*$/, "field names are lowercase snake_case with the unit at the end");

/** Problem text if a field name does not carry its unit, else null. */
export function unitNameProblem(name: string, unit: Unit): string | null {
  const suffix = UNIT_SUFFIX[unit];
  if (suffix === null) return /^share_of_|_ratio$/.test(name) ? null : `${name}: a dimensionless field is named share_of_… or …_ratio`;
  return name.endsWith(suffix) ? null : `${name}: unit "${unit}" needs a name ending in ${suffix}`;
}

/**
 * A numeric input with its unit and bounds. `max: null` means no upper bound is declared (used for
 * values the learner supplies from a datasheet, which we must not cap with an invented number).
 * `optional: true` inputs may be left out (for example a torque rating nobody has supplied).
 */
export const BoundedInput = z
  .object({ unit: Unit, min: z.number(), max: z.number().nullable(), optional: z.literal(true).optional() })
  .strict()
  .refine((b) => b.max === null || b.min < b.max, { message: "min must be below max" });
export type BoundedInput = z.infer<typeof BoundedInput>;

/** Fields every capability carries (CLAUDE.md: teaches, fidelity, version, review_status, provenance). */
const common = {
  version: Semver,
  teaches: z.array(ConceptId).min(1),
  review_status: ReviewStatus,
  review: Review.optional(),
  test_fixture: z.literal(true).optional(),
  /** Touching this item needs the learner's explicit acknowledgement, whatever the director declares. */
  safety_critical: z.boolean().default(false),
};

function unitRules(id: string, fields: Array<[string, Unit]>, ctx: z.RefinementCtx) {
  for (const [name, unit] of fields) {
    const p = unitNameProblem(name, unit);
    if (p) ctx.addIssue({ code: "custom", message: `${id}: ${p}` });
  }
}

/** Where a solver's numbers were checked. "hand_derivation" is labelled as not textbook. */
export const WorkedExample = z
  .object({
    kind: z.enum(["textbook", "hand_derivation"]),
    source: SourceId.optional(),
    location: z.string().min(1),
  })
  .strict()
  .superRefine((w, ctx) => {
    if (w.kind === "textbook" && !w.source) ctx.addIssue({ code: "custom", message: "a textbook example names its source (src.…)" });
  });

export const SolverManifest = z
  .object({
    id: SolverId,
    type: z.literal("solver"),
    title: z.string().min(1),
    ...common,
    fidelity: Fidelity,
    provenance: Provenance,
    inputs: z.record(FieldName, BoundedInput),
    outputs: z.record(FieldName, z.object({ unit: Unit }).strict()),
    assumptions: z.array(z.string().min(1)).min(1),
    excludes: z.array(z.string().min(1)).min(1),
    worked_examples: z.array(WorkedExample).default([]),
  })
  .strict()
  .superRefine((s, ctx) => {
    reviewRules(s, ctx);
    unitRules(s.id, [...Object.entries(s.inputs).map(([k, v]) => [k, v.unit] as [string, Unit]), ...Object.entries(s.outputs).map(([k, v]) => [k, v.unit] as [string, Unit])], ctx);
    if (Object.keys(s.outputs).length === 0) ctx.addIssue({ code: "custom", message: `${s.id}: a solver has at least one output` });
    if (s.review_status !== "draft" && !s.test_fixture && !s.worked_examples.some((w) => w.kind === "textbook")) {
      ctx.addIssue({ code: "custom", message: `${s.id}: a reviewed solver needs at least one textbook worked example` });
    }
  });
export type SolverManifest = z.infer<typeof SolverManifest>;

export const SimulationManifest = z
  .object({
    id: SimulationId,
    type: z.literal("simulation"),
    title: z.string().min(1),
    ...common,
    levels: z.array(Level).min(1),
    fidelity: Fidelity,
    provenance: Provenance,
    solver: z.object({ id: SolverId, version: Semver }).strict(),
    inputs: z.record(FieldName, BoundedInput),
    outputs: z.array(FieldName).min(1),
    assumptions: z.array(z.string().min(1)).min(1),
    excludes: z.array(z.string().min(1)).min(1),
    failure_states: z.array(z.object({ id: KebabId, description: z.string().min(1) }).strict()).default([]),
  })
  .strict()
  .superRefine((s, ctx) => {
    reviewRules(s, ctx);
    unitRules(s.id, Object.entries(s.inputs).map(([k, v]) => [k, v.unit] as [string, Unit]), ctx);
  });
export type SimulationManifest = z.infer<typeof SimulationManifest>;

export const AnalogyManifest = z
  .object({
    id: AnalogyId,
    type: z.literal("analogy"),
    title: z.string().min(1),
    ...common,
    levels: z.array(Level).min(1),
    fidelity: Fidelity,
    provenance: Provenance,
    /** The scene that shows it, if any (scene IDs are kebab-case). */
    scene: KebabId.optional(),
    mapping: z.array(z.object({ source: z.string().min(1), target: z.string().min(1) }).strict()).min(1),
    breaks_down: z.string().min(1),
    followed_by: z.union([SimulationId, AnalogyId]).optional(),
  })
  .strict()
  .superRefine((a, ctx) => reviewRules(a, ctx));
export type AnalogyManifest = z.infer<typeof AnalogyManifest>;

/** A source (architecture §11). Link out only; never ingest copyrighted text. */
export const SourceManifest = z
  .object({
    id: SourceId,
    type: z.literal("source"),
    kind: z.enum(["book", "course", "video", "paper", "datasheet", "documentation"]),
    title: z.string().min(1),
    authors: z.array(z.string().min(1)).min(1),
    edition: z.string().min(1).nullable(),
    url: z.url().nullable(),
    isbn: z.string().min(1).nullable().default(null),
    access: z.enum(["free", "paid"]),
    rights: z.string().min(1),
    language: z.string().min(2).default("en"),
    /** Who checked that the source exists and the link works. Null until a person has. */
    verified: z.object({ by: z.string().min(2), on: IsoDate }).strict().nullable(),
    test_fixture: z.literal(true).optional(),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.test_fixture && s.verified) ctx.addIssue({ code: "custom", message: `${s.id}: a test fixture never carries a verification record` });
  });
export type SourceManifest = z.infer<typeof SourceManifest>;

/** A reading item: a specific part of a source plus a human-written guide (used to grade teach-back). */
export const ReadingManifest = z
  .object({
    id: ReadingId,
    type: z.literal("reading"),
    ...common,
    source: SourceId,
    location: z.string().min(1),
    level: Level,
    purpose: z.enum(["intro", "deepen", "reference", "lab"]),
    est_minutes: z.number().int().positive(),
    alternatives: z.array(ReadingId).default([]),
    guide: z
      .object({
        key_claims: z.array(z.string().min(1)).min(1),
        misconceptions: z.array(z.string().min(1)),
        teach_back_prompts: z.array(z.string().min(1)).min(1),
        application_question: z.string().min(1),
      })
      .strict(),
  })
  .strict()
  .superRefine((r, ctx) => reviewRules(r, ctx));
export type ReadingManifest = z.infer<typeof ReadingManifest>;

export const Capability = z.discriminatedUnion("type", [SolverManifest, SimulationManifest, AnalogyManifest, SourceManifest, ReadingManifest]);
export type Capability = z.infer<typeof Capability>;
