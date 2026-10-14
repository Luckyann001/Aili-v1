import type { recordedLiveParts as Real } from "./recordedLive";

// Stand-in for every build without AILI_E2E_RECORDED_LIVE=1 (next.config.ts aliases
// "aili-recorded-live" here), so no production build contains the e2e recording.
export const recordedLiveParts: typeof Real | null = null;
