// The reduction ratio of a simple or compound spur gear train, derived from tooth counts only
// (authoring/servo-anatomy/gears.json is the single source; the ratio is never typed by hand).
// Gears on the same shaft turn together; each mesh multiplies the reduction by driven ÷ driver.
// Teeth counts only: no efficiency, friction or backlash (illustrative, as the file says).

export interface GearTrain {
  gears: ReadonlyArray<{ id: string; teeth: number; shaft: string }>;
  meshes: ReadonlyArray<{ driver: string; driven: string }>;
}

/** Input turns per output turn (> 1 is a reduction), and the gears from input to output. */
export function gearTrainRatio(train: GearTrain): { ratio: number; path: string[] } {
  const byId = new Map(train.gears.map((g) => [g.id, g]));
  if (byId.size !== train.gears.length) throw new RangeError("gear ids must be unique");
  for (const g of train.gears) if (!Number.isInteger(g.teeth) || g.teeth < 6) throw new RangeError(`${g.id}: teeth must be a whole number of at least 6`);
  if (train.meshes.length === 0) throw new RangeError("a gear train needs at least one mesh");
  let ratio = 1;
  const path: string[] = [];
  let shaft: string | null = null;
  for (const [i, m] of train.meshes.entries()) {
    const a = byId.get(m.driver);
    const b = byId.get(m.driven);
    if (!a || !b) throw new RangeError(`meshes[${i}] names a gear that does not exist`);
    if (a.shaft === b.shaft) throw new RangeError(`meshes[${i}]: ${a.id} and ${b.id} share a shaft and cannot mesh`);
    // Each mesh after the first starts on the shaft the previous one ended on (a compound gear).
    if (shaft !== null && a.shaft !== shaft) throw new RangeError(`meshes[${i}]: ${a.id} is not on the shaft "${shaft}" that the previous mesh drove`);
    ratio *= b.teeth / a.teeth;
    path.push(a.id, b.id);
    shaft = b.shaft;
  }
  return { ratio, path };
}

/**
 * Each shaft's speed relative to the input shaft (the first mesh's driver = 1), from tooth counts:
 * across a mesh the driven shaft turns at −(driver teeth ÷ driven teeth) of the driver's speed, so the
 * direction alternates mesh by mesh and the output turns 1 ÷ ratio as fast. Ideal gears: kinematics
 * only, no load, friction or efficiency (for an illustrative animation, never a simulation).
 */
export function shaftSpeeds(train: GearTrain): Record<string, number> {
  gearTrainRatio(train); // the same checks: a valid compound chain
  const byId = new Map(train.gears.map((g) => [g.id, g]));
  const first = byId.get(train.meshes[0]!.driver)!;
  const speed: Record<string, number> = { [first.shaft]: 1 };
  for (const m of train.meshes) {
    const a = byId.get(m.driver)!;
    const b = byId.get(m.driven)!;
    speed[b.shaft] = -speed[a.shaft]! * (a.teeth / b.teeth);
  }
  return speed;
}
