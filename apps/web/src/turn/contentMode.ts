import { contentLabel, type LabelledItem } from "@aili/schemas/labels";

// The founder demo mode (slice A, 16 Oct 2026): `npm run dev:demo` runs the live dev server with
// AILI_CONTENT_MODE=founder-demo in its own environment. next.config.ts inlines the resolved mode
// as AILI_CONTENT_MODE_BUILD, "founder-demo" only where the fixture registry is allowed (the dev
// live server and test builds); a production build is always "standard". The professor's side does
// not change: the shortlist stays published-only. Only the page's labels and visibility change.

export const FOUNDER_DEMO = process.env.AILI_CONTENT_MODE_BUILD === "founder-demo";

type Manifest = LabelledItem & { id: string; review?: { role?: "founder" | "expert"; by?: string; on?: string } };
export interface DemoContent {
  scenes: Record<string, Manifest & { asset?: string }>;
  assets: Record<string, Manifest>;
}

export interface DemoLabels {
  /** True only when every manifest on stage (the scene, and its asset if it has one) has a founder review. */
  reviewed: boolean;
  /** The stage badge, after "Prepared". */
  stage: string;
  /** The live badge: live versus prepared stays visible. */
  live: string;
}

export const FOUNDER_LABEL = "Prepared · reviewed by the founder, not an expert reviewer";
export const NOT_REVIEWED_LABEL = "Prepared · not reviewed";
export const LIVE_REVIEWED = "Live AI · Founder-reviewed demo content";
export const LIVE_NOT_REVIEWED = "Live AI · Demo content, not reviewed";
export const DEMO_NOTE_REVIEWED = "Narration is live AI; the lesson content is prepared and founder-reviewed, not expert-reviewed";
export const DEMO_NOTE_NOT_REVIEWED = "Narration is live AI; the lesson content is prepared and not reviewed yet";

/**
 * The labels for what a turn put on stage, from its own manifests through contentLabel: the founder
 * label only when the scene AND its asset (if any) each carry a founder review record; otherwise "not
 * reviewed". Never a claim the records do not make.
 */
export function demoLabels(scene: Manifest & { asset?: string }, asset: Manifest | null): DemoLabels {
  const on = [scene, ...(scene.asset ? [asset] : [])];
  const reviewed = on.every((m) => !!m && contentLabel(m).label === FOUNDER_LABEL);
  return reviewed ? { reviewed, stage: FOUNDER_LABEL, live: LIVE_REVIEWED } : { reviewed, stage: NOT_REVIEWED_LABEL, live: LIVE_NOT_REVIEWED };
}

/** The labels for a scene ID a turn put up, or null when it is not demo content (or not this mode). */
export function demoLabelsFor(content: DemoContent | null, sceneId: string | null): DemoLabels | null {
  if (!FOUNDER_DEMO || !content || !sceneId) return null;
  const scene = content.scenes[sceneId];
  if (!scene) return null;
  return demoLabels(scene, scene.asset ? (content.assets[scene.asset] ?? null) : null);
}
