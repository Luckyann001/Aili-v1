import type { DemoContent } from "./contentMode";

// Production stand-in for demoContent.ts (next.config.ts aliases "aili-demo-content" here wherever
// the fixture registry is not allowed): no fixture manifest is in the build, and no demo label shows.
export const DEMO_CONTENT: DemoContent | null = null;
