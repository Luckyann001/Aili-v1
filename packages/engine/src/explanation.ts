import { UNIT_SUFFIX, type DirectorResponse, type Unit } from "@aili/schemas";
import type { Registry } from "./capabilities";

// What a completed turn sends for the text explanation panel (docs/m3-live-browser-plan.md slice 3;
// layout doc §1): the assumptions and limitations, the evidence by title, and every calculated value
// with a plain label and its unit. No ID of any kind (calculation, solver, reading) goes to the
// learner: values are labelled from the solver's field names, evidence from the source's title.

/** A labelled value with its unit ("" for a ratio). */
export interface ExplainedValue {
  label: string;
  value: string;
  unit: string;
}

export interface TurnExplanation {
  assumptions: string[];
  limitations: string[];
  /** Evidence titles: the source's title, then where in it. */
  evidence: string[];
  /** One entry per calculation: the solver's title and fidelity, what went in and what came out. */
  calculations: Array<{ title: string; fidelity: string; inputs: ExplainedValue[]; outputs: ExplainedValue[] }>;
}

/** "payload_torque_nm" → "Payload torque"; "arm_kg_per_m" → "Arm mass per metre"; "share_of_rating" → "Share of rating". */
export function fieldLabel(name: string, unit: Unit): string {
  const suffix = UNIT_SUFFIX[unit];
  const base = (suffix && name.endsWith(suffix) ? name.slice(0, -suffix.length) : name).replace(/_/g, " ").trim();
  const words = unit === "kg/m" ? `${base} mass per metre` : base;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const unitText = (u: Unit) => (u === "ratio" ? "" : u);

/** A value the manifest does not declare takes its unit from its name's suffix (the naming rule), else none. */
const unitOf = (name: string, declared: Unit | undefined): Unit =>
  declared ?? ((Object.entries(UNIT_SUFFIX) as Array<[Unit, string | null]>).filter(([, sfx]) => sfx && name.endsWith(sfx)).sort((a, b) => b[1]!.length - a[1]!.length)[0]?.[0] ?? "ratio");

export function explainTurn(
  r: Pick<DirectorResponse, "assumptions" | "limitations" | "evidence" | "calc_requests">,
  registry: Pick<Registry, "solvers" | "readings" | "sources">,
  results: ReadonlyArray<{ calc_id: string; outputs: Record<string, number> }>,
  fill: (text: string) => string,
  format: (x: number) => string,
): TurnExplanation {
  const sources = new Map(registry.sources.map((s) => [s.id, s]));
  const evidence = r.evidence.flatMap((id) => {
    const reading = registry.readings.find((x) => x.id === id);
    const source = reading && sources.get(reading.source);
    return source ? [`${source.title}, ${reading.location}`] : [];
  });
  const calculations = r.calc_requests.flatMap((c) => {
    const solver = registry.solvers.find((s) => s.id === c.solver);
    const outputs = results.find((x) => x.calc_id === c.id)?.outputs;
    if (!solver || !outputs) return [];
    return [
      {
        title: solver.title,
        fidelity: solver.fidelity,
        inputs: Object.entries(c.inputs).map(([k, v]) => {
          const unit = unitOf(k, solver.inputs[k]?.unit);
          return { label: fieldLabel(k, unit), value: format(v), unit: unitText(unit) };
        }),
        outputs: Object.entries(outputs).map(([k, v]) => {
          const unit = unitOf(k, solver.outputs[k]?.unit);
          return { label: fieldLabel(k, unit), value: format(v), unit: unitText(unit) };
        }),
      },
    ];
  });
  return { assumptions: r.assumptions.map(fill), limitations: r.limitations.map(fill), evidence, calculations };
}
