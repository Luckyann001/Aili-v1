import { staticTorqueSingleLink } from "@aili/solvers";

// The stage's settings (M4, 15 Oct 2026): ONE function, used by the page and the engine, turns a
// scene's manifest defaults plus the settings changes applied into the settings on stage, so a
// calculation about the scene on stage uses exactly what the learner sees (Lucky's decision
// 2026-10-15, after a live turn said 0.588 N·m while the stage showed about 0.235 N·m).
// The server cannot know sliders the learner moved (the page sends only text); the page says so.

export interface StageParam {
  id: string;
  min: number;
  max: number;
  step: number;
  default?: number;
  learner_supplied?: true;
}
export interface StageScene {
  id: string;
  params: readonly StageParam[];
  solver?: { id: string; constants: Record<string, number> };
  /** Human-written handovers to other scenes (slice B): settings that carry across on select_scene. */
  handover?: ReadonlyArray<{ to: string; settings: ReadonlyArray<{ from: string; to: string }> }>;
  /** What each animation leaves on stage (declared in the manifest): a setting at its min or max. */
  animations?: ReadonlyArray<{ id: string; sets?: ReadonlyArray<{ param: string; to: "min" | "max" }> }>;
}
export type StageSettings = Record<string, number>;

/** The scene's settings before any change: each default (a learner-supplied value has none). */
export function stageDefaults(scene: Pick<StageScene, "params">): StageSettings {
  return Object.fromEntries(scene.params.filter((p) => !p.learner_supplied && p.default !== undefined).map((p) => [p.id, p.default!]));
}

/** A value kept inside its bounds and on its step (no floating-point dust). */
export function clampToParam(p: Pick<StageParam, "min" | "max" | "step">, value: number): number {
  const stepped = Math.round((Math.min(p.max, Math.max(p.min, value)) - p.min) / p.step) * p.step + p.min;
  return Number(Math.min(p.max, stepped).toFixed(4));
}

/**
 * One setting changed, the others kept consistent. Unknown or learner-supplied settings and
 * non-finite values change nothing. A load sits on its arm: load_distance_m never exceeds
 * arm_length_m (shortening the arm brings the load in with it).
 */
export function applyStageSetting(scene: Pick<StageScene, "params">, settings: StageSettings, id: string, value: number): StageSettings {
  const p = scene.params.find((x) => x.id === id);
  if (!p || p.learner_supplied || !Number.isFinite(value)) return settings;
  const next = { ...settings, [id]: clampToParam(p, value) };
  if (next.load_distance_m !== undefined && next.arm_length_m !== undefined && next.load_distance_m > next.arm_length_m) next.load_distance_m = next.arm_length_m;
  return next;
}

/**
 * The settings of scene `to` when a turn selects it while `from` is on stage: the target's defaults,
 * then the handover the scene on stage declares for `to` (each value through applyStageSetting, so it
 * is clamped into the target's bounds and a load stays on its arm, in the manifest's order). The model
 * only selects the scene; nothing it sends is read here.
 */
export function settingsAfterSelect(scenes: ReadonlyArray<StageScene>, from: { scene?: string; settings?: StageSettings }, to: string): StageSettings | undefined {
  const target = scenes.find((s) => s.id === to);
  if (!target) return undefined;
  let next = stageDefaults(target);
  const h = scenes.find((s) => s.id === from.scene)?.handover?.find((x) => x.to === to);
  if (h && from.settings)
    for (const m of h.settings) {
      const v = from.settings[m.from];
      if (v !== undefined) next = applyStageSetting(target, next, m.to, v);
    }
  return next;
}

/** The settings after an animation that declares what it leaves on stage (e.g. the reach at its maximum). */
export function settingsAfterAnimation(scene: StageScene, settings: StageSettings, animation: string): StageSettings {
  let next = settings;
  for (const e of scene.animations?.find((a) => a.id === animation)?.sets ?? []) {
    const p = scene.params.find((x) => x.id === e.param);
    if (p) next = applyStageSetting(scene, next, p.id, e.to === "max" ? p.max : p.min);
  }
  return next;
}

/**
 * The stage after a turn's actions: a new scene starts from its defaults plus any handover from the
 * scene on stage; set_parameter changes a setting; an animation applies what it declares.
 */
export function stageAfterActions(
  scenes: ReadonlyArray<StageScene>,
  start: { scene?: string; settings?: StageSettings },
  actions: ReadonlyArray<{ type: string; scene?: string; param?: string; value?: number; animation?: string }>,
): { scene?: string; settings?: StageSettings } {
  let scene = start.scene;
  let settings = start.settings ?? (scene ? defaultsOf(scenes, scene) : undefined);
  for (const a of actions) {
    if (a.type === "select_scene" && a.scene && a.scene !== scene) {
      settings = settingsAfterSelect(scenes, { scene, settings }, a.scene);
      scene = a.scene;
    }
    if (a.type === "play_animation" && scene && a.animation) {
      const m = scenes.find((s) => s.id === scene);
      if (m) settings = settingsAfterAnimation(m, settings ?? stageDefaults(m), a.animation);
    }
    if (a.type === "set_parameter" && scene && a.param !== undefined && a.value !== undefined) {
      const m = scenes.find((s) => s.id === scene);
      if (m) settings = applyStageSetting(m, settings ?? stageDefaults(m), a.param, a.value);
    }
  }
  return { ...(scene ? { scene } : {}), ...(settings ? { settings } : {}) };
}

const defaultsOf = (scenes: ReadonlyArray<StageScene>, id: string) => {
  const m = scenes.find((s) => s.id === id);
  return m ? stageDefaults(m) : undefined;
};

/** The servo + arm family of scenes: an arm with a load at a distance (the settings the calculation needs). */
const ARM_WITH_LOAD = ["arm_length_m", "arm_mass_kg", "load_mass_kg", "load_distance_m"] as const;
export const isArmWithLoad = (s: StageSettings | undefined): s is Record<(typeof ARM_WITH_LOAD)[number], number> => !!s && ARM_WITH_LOAD.every((k) => typeof s[k] === "number");

/**
 * The single-link calculation for an arm-with-load stage, as the professor's calculation names its
 * outputs: the load is reported as the payload (it is the payload, at its own distance rather than
 * the tip), so a turn's {{c1.payload_torque_nm}} says what the stage's labels say. Also the
 * calculation inputs to show, in the solver's units plus the load's distance.
 */
export function stageCalculation(settings: Record<(typeof ARM_WITH_LOAD)[number], number>, constants: Record<string, number> = {}): { inputs: Record<string, number>; outputs: Record<string, number> } {
  const L = settings.arm_length_m;
  const d = Math.min(L, settings.load_distance_m);
  const angle_deg = constants.angle_deg ?? 0;
  const r = staticTorqueSingleLink({ arm_length_m: L, payload_kg: 0, arm_kg_per_m: settings.arm_mass_kg / L, angle_deg, extra_masses: [{ mass_kg: settings.load_mass_kg, distance_m: d }] });
  return {
    inputs: { arm_length_m: L, payload_kg: settings.load_mass_kg, load_distance_m: d, arm_kg_per_m: settings.arm_mass_kg / L, angle_deg },
    outputs: {
      torque_nm: r.torque_nm,
      torque_kgf_cm: r.torque_kgf_cm,
      payload_torque_nm: r.extra_torque_nm,
      arm_torque_nm: r.arm_torque_nm,
      payload_force_n: r.extra_force_n,
      arm_weight_n: r.arm_weight_n,
      extra_torque_nm: 0,
      extra_force_n: 0,
    },
  };
}
