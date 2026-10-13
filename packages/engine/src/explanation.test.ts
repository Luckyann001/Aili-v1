import { describe, expect, it } from "vitest";
import { createFakeDirector, createFakeRouter, fieldLabel, TurnSession, type TurnEvent } from "./index";
import { fixtureRegistry } from "./__fixtures__/registry";

// The text panel's content for a turn (docs/m3-live-browser-plan.md slice 3): sent on turn.done,
// labelled for a learner, with no ID of any kind.

describe("turn.done carries the turn's explanation", () => {
  it("assumptions, limitations, evidence by title, every calculated value with a label and unit; no IDs", async () => {
    const s = new TurnSession({ registry: fixtureRegistry().registry, director: createFakeDirector("valid"), router: createFakeRouter(), state: { history: { posture: "learning", learner_level: "some_knowledge", entries: [] } }, concepts: ["mech.torque.static"], level: "L2" });
    const events: TurnEvent[] = [];
    await s.run({ text: "Why is it hard to hold?" }, (e) => events.push(e));
    const done = events.at(-1)!;
    if (done.type !== "turn.done") throw new Error(JSON.stringify(done));
    const x = done.explanation;
    expect(x.assumptions.length).toBeGreaterThan(0);
    expect(x.limitations.length).toBeGreaterThan(0);
    expect(x.evidence).toEqual(["Fixture book, Fixture section"]);
    expect(x.calculations).toHaveLength(1);
    const calc = x.calculations[0]!;
    expect(calc).toMatchObject({ title: "Static holding torque of a single arm link", fidelity: "verified" });
    expect(calc.inputs).toContainEqual({ label: "Arm length", value: "0.2", unit: "m" });
    expect(calc.outputs).toContainEqual({ label: "Torque", value: "0.637", unit: "N·m" }); // as in the narration
    expect(calc.outputs.find((o) => o.label === "Share of rating")?.unit ?? "").toBe("");
    const text = JSON.stringify(x);
    expect(text).not.toMatch(/\bc\d+\b|solver\.|read\.|src\.|\{\{/); // no calculation, solver, reading or source IDs
  });
});

describe("field labels", () => {
  it("drop the unit suffix and read as words", () => {
    expect(fieldLabel("payload_torque_nm", "N·m")).toBe("Payload torque");
    expect(fieldLabel("torque_kgf_cm", "kgf·cm")).toBe("Torque");
    expect(fieldLabel("arm_kg_per_m", "kg/m")).toBe("Arm mass per metre");
    expect(fieldLabel("angle_deg", "deg")).toBe("Angle");
    expect(fieldLabel("share_of_rating", "ratio")).toBe("Share of rating");
  });
});
