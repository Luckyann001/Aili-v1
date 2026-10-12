import {
  Capability,
  ConceptSeed,
  REVIEW_LABEL,
  SceneManifest,
  type AnalogyManifest,
  type ConceptId,
  type ReadingManifest,
  type SimulationManifest,
  type SolverManifest,
  type SourceManifest,
} from "@aili/schemas";

// The capability registry as one validated bundle (docs/m2-plan.md §1; the database sync is
// deferred). Input is parsed JSON per file; output is the registry or readable errors, never a
// partly valid registry. Test fixtures load only when allowed (the dev flag); production refuses them.

export interface Registry {
  concepts: ConceptSeed[];
  scenes: SceneManifest[];
  solvers: SolverManifest[];
  simulations: SimulationManifest[];
  analogies: AnalogyManifest[];
  sources: SourceManifest[];
  readings: ReadingManifest[];
}

export interface RegistryInput {
  concepts: unknown;
  scenes: Array<{ file: string; data: unknown }>;
  capabilities: Array<{ file: string; data: unknown }>;
}

export interface LoadOptions {
  /** True only with the dev flag. Production must pass false. */
  allowTestFixtures: boolean;
}

const EMPTY: Registry = { concepts: [], scenes: [], solvers: [], simulations: [], analogies: [], sources: [], readings: [] };

export function loadRegistry(input: RegistryInput, opts: LoadOptions): { registry: Registry; errors: string[] } {
  const errors: string[] = [];
  const reg: Registry = { ...EMPTY, concepts: [], scenes: [], solvers: [], simulations: [], analogies: [], sources: [], readings: [] };
  const where = new Map<string, string>(); // item ID → file, for duplicate and reference messages
  const fixtures = new Set<string>();

  const concepts = ConceptSeed.array().safeParse(input.concepts);
  if (concepts.success) reg.concepts = concepts.data;
  else errors.push(`concepts: ${concepts.error.issues.map((i) => i.message).join("; ")}`);
  const conceptIds = new Set(reg.concepts.map((c) => c.id));

  const add = (file: string, item: { id: string; test_fixture?: true }) => {
    if (where.has(item.id)) {
      errors.push(`${file}: duplicate ID "${item.id}" (also in ${where.get(item.id)})`);
      return false;
    }
    if (item.test_fixture) {
      if (!opts.allowTestFixtures) {
        errors.push(`${file}: "${item.id}" is a test fixture and is refused outside development`);
        return false;
      }
      fixtures.add(item.id);
    }
    where.set(item.id, file);
    return true;
  };

  for (const { file, data } of input.scenes) {
    const p = SceneManifest.safeParse(data);
    if (!p.success) {
      for (const i of p.error.issues) errors.push(`${file}: ${i.path.join(".") || "(scene)"}: ${i.message}`);
    } else if (add(file, p.data)) reg.scenes.push(p.data);
  }
  for (const { file, data } of input.capabilities) {
    const p = Capability.safeParse(data);
    if (!p.success) {
      for (const i of p.error.issues) errors.push(`${file}: ${i.path.join(".") || "(item)"}: ${i.message}`);
      continue;
    }
    const c = p.data;
    if (!add(file, c)) continue;
    if (c.type === "solver") reg.solvers.push(c);
    else if (c.type === "simulation") reg.simulations.push(c);
    else if (c.type === "analogy") reg.analogies.push(c);
    else if (c.type === "source") reg.sources.push(c);
    else reg.readings.push(c);
  }

  // Cross-references. Real content may never lean on a test fixture.
  const ref = (fromId: string, fromFixture: boolean, toId: string, what: string) => {
    const file = where.get(fromId)!;
    if (!where.has(toId)) errors.push(`${file}: ${fromId} refers to unknown ${what} "${toId}"`);
    else if (fixtures.has(toId) && !fromFixture) errors.push(`${file}: ${fromId} refers to test fixture "${toId}"`);
  };
  const teaching = [...reg.scenes, ...reg.solvers, ...reg.simulations, ...reg.analogies, ...reg.readings];
  for (const item of teaching)
    for (const c of item.teaches) if (!conceptIds.has(c)) errors.push(`${where.get(item.id)}: ${item.id} teaches unknown concept "${c}"`);

  const solverById = new Map(reg.solvers.map((s) => [s.id, s]));
  for (const sim of reg.simulations) {
    const file = where.get(sim.id)!;
    ref(sim.id, !!sim.test_fixture, sim.solver.id, "solver");
    const solver = solverById.get(sim.solver.id);
    if (!solver) continue;
    if (solver.version !== sim.solver.version) errors.push(`${file}: ${sim.id} pins ${solver.id} ${sim.solver.version}, but the registry has ${solver.version}`);
    for (const [name, b] of Object.entries(sim.inputs)) {
      const s = solver.inputs[name];
      if (!s) errors.push(`${file}: ${sim.id} input "${name}" is not an input of ${solver.id}`);
      else if (s.unit !== b.unit) errors.push(`${file}: ${sim.id} input "${name}" is in ${b.unit}, the solver takes ${s.unit}`);
      else if (b.min < s.min || (s.max !== null && (b.max === null || b.max > s.max)))
        errors.push(`${file}: ${sim.id} input "${name}" ${b.min}–${b.max ?? "no limit"} goes outside the solver's ${s.min}–${s.max ?? "no limit"}`);
      else if (b.optional && !s.optional) errors.push(`${file}: ${sim.id} input "${name}" is optional, but the solver requires it`);
    }
    for (const [name, s] of Object.entries(solver.inputs))
      if (!s.optional && !(name in sim.inputs)) errors.push(`${file}: ${sim.id} leaves out the solver input "${name}"`);
    for (const o of sim.outputs) if (!(o in solver.outputs)) errors.push(`${file}: ${sim.id} output "${o}" is not an output of ${solver.id}`);
    if (sim.review_status !== "draft" && solver.review_status === "draft")
      errors.push(`${file}: ${sim.id} is ${sim.review_status} but its solver ${solver.id} is still a draft`);
  }
  for (const a of reg.analogies) {
    if (a.scene) ref(a.id, !!a.test_fixture, a.scene, "scene");
    if (a.followed_by) ref(a.id, !!a.test_fixture, a.followed_by, "item");
  }
  const sourceById = new Map(reg.sources.map((s) => [s.id, s]));
  for (const r of reg.readings) {
    ref(r.id, !!r.test_fixture, r.source, "source");
    for (const alt of r.alternatives) ref(r.id, !!r.test_fixture, alt, "reading");
    const src = sourceById.get(r.source);
    if (src && r.review_status !== "draft" && !r.test_fixture && !src.verified)
      errors.push(`${where.get(r.id)}: ${r.id} is ${r.review_status} but its source ${src.id} has not been verified by a person`);
  }
  for (const s of reg.solvers)
    for (const w of s.worked_examples) if (w.source) ref(s.id, !!s.test_fixture, w.source, "source");

  return { registry: errors.length ? EMPTY : reg, errors };
}

/** What the director may use for one turn: published items for these concepts at this level. */
export interface Shortlist {
  scenes: SceneManifest[];
  simulations: SimulationManifest[];
  solvers: SolverManifest[];
  analogies: AnalogyManifest[];
  readings: ReadingManifest[];
  sources: SourceManifest[];
  /** Every ID above, for the validator's "is it in this turn's shortlist" check. */
  ids: Set<string>;
  /**
   * The concept IDs a response may name in "concepts" this turn: the requested concepts that exist in
   * the registry, plus every concept a shortlisted item teaches. Empty when the shortlist is empty.
   */
  concepts: string[];
}

export function shortlist(reg: Registry, q: { concepts: readonly ConceptId[]; level: "L1" | "L2" | "L3" }): Shortlist {
  const published = <T extends { review_status: string }>(x: T) => x.review_status === "published";
  const about = (x: { teaches: readonly string[] }) => x.teaches.some((c) => q.concepts.includes(c));

  const scenes = reg.scenes.filter((s) => published(s) && about(s) && s.level === q.level);
  const simulations = reg.simulations.filter((s) => published(s) && about(s) && s.levels.includes(q.level));
  const analogies = reg.analogies.filter((a) => published(a) && about(a) && a.levels.includes(q.level));
  const readings = reg.readings.filter((r) => published(r) && about(r) && r.level === q.level);
  // Solvers have no level: those the shortlisted simulations run, plus any that teach these concepts.
  const wanted = new Set(simulations.map((s) => s.solver.id));
  const solvers = reg.solvers.filter((s) => published(s) && (wanted.has(s.id) || about(s)));
  // A simulation whose solver is not published cannot run, so it is left out too.
  const runnable = simulations.filter((s) => solvers.some((v) => v.id === s.solver.id));
  const srcIds = new Set(readings.map((r) => r.source));
  const sources = reg.sources.filter((s) => srcIds.has(s.id));

  const ids = new Set([...scenes, ...runnable, ...solvers, ...analogies, ...readings, ...sources].map((x) => x.id));
  const known = new Set(reg.concepts.map((c) => c.id));
  const concepts =
    ids.size === 0
      ? []
      : [...new Set([...q.concepts.filter((c) => known.has(c)), ...[...scenes, ...runnable, ...solvers, ...analogies, ...readings].flatMap((x) => x.teaches)])].sort();
  return { scenes, simulations: runnable, solvers, analogies, readings, sources, ids, concepts };
}

/** The label an item carries in the UI. Test fixtures always say so, whatever their status. */
export function itemLabel(item: { review_status: string; test_fixture?: true }): string {
  if (item.test_fixture) return "Test fixture";
  return REVIEW_LABEL[item.review_status as keyof typeof REVIEW_LABEL];
}
