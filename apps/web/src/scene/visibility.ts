import { isDraft } from "./manifests";
import type { SceneId } from "./models";

/**
 * Draft scenes are shown only when NEXT_PUBLIC_AILI_INCLUDE_DRAFTS=1 (dev, in .env.local; never
 * committed). Production builds without it show no draft scene. Direct access so Next inlines it.
 */
export const INCLUDE_DRAFTS = process.env.NEXT_PUBLIC_AILI_INCLUDE_DRAFTS === "1";

export const sceneShown = (id: SceneId) => INCLUDE_DRAFTS || !isDraft(id);
