// Explode, open and assemble for any GLB asset, read from its manifest (no per-asset code): each
// part's explode direction (glTF axes) and distance, and which parts move away to "open" it. A pose
// is a transition from one settled view to another, `k` of the way there (1 = settled).

export type AssetView = "assembled" | "open" | "exploded";
export const ASSET_VIEWS: readonly AssetView[] = ["assembled", "open", "exploded"];

type Vec3 = [number, number, number];

/** The fields of an asset manifest the pose needs. */
export interface PoseManifest {
  parts: ReadonlyArray<{ id: string; explode: { direction_gltf: readonly number[]; distance_m: number } }>;
  open_parts?: readonly string[];
}

export interface AssetPose {
  from: AssetView;
  to: AssetView;
  /** 0 to 1, eased by the caller; 1 is settled at `to`. */
  k: number;
}

export const SETTLED: AssetPose = { from: "assembled", to: "assembled", k: 1 };
export const settled = (view: AssetView): AssetPose => ({ from: view, to: view, k: 1 });

/** How far a part is moved out in a settled view: 1 = its full explode distance. */
export function viewWeight(m: PoseManifest, partId: string, view: AssetView): number {
  if (view === "exploded") return 1;
  if (view === "open") return m.open_parts?.includes(partId) ? 1 : 0;
  return 0;
}

/** The part's offset from its assembled place, glTF axes, metres, at this pose. */
export function partOffsetGltf(m: PoseManifest, partId: string, pose: AssetPose): Vec3 {
  const part = m.parts.find((p) => p.id === partId);
  if (!part) return [0, 0, 0];
  const k = Math.min(1, Math.max(0, pose.k));
  const w = viewWeight(m, partId, pose.from) * (1 - k) + viewWeight(m, partId, pose.to) * k;
  const d = part.explode.direction_gltf;
  const len = Math.hypot(d[0] ?? 0, d[1] ?? 0, d[2] ?? 0) || 1;
  const s = (part.explode.distance_m * w) / len;
  return [(d[0] ?? 0) * s + 0, (d[1] ?? 0) * s + 0, (d[2] ?? 0) * s + 0]; // + 0: never -0
}

/** True when the pose moves this part at all (its offset lines and labels show). */
export const partMoved = (m: PoseManifest, partId: string, pose: AssetPose) => partOffsetGltf(m, partId, pose).some((v) => Math.abs(v) > 1e-9);
