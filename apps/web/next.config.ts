import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

// `npm run dev:lan` sets AILI_LAN_HOST to this laptop's Wi-Fi address so a phone on the same
// network can load dev assets (Next 16 blocks other origins by default). Dev only.
const lanHost = process.env.AILI_LAN_HOST?.trim();

// The fake-director demo's test fixtures are in the build only with NEXT_PUBLIC_AILI_FAKE_DIRECTOR=1
// (dev and the main e2e build). Otherwise the import resolves to a stub, so production builds hold
// no file from content/robotics/test-fixtures (checked by the no-drafts e2e build). Live turns
// (AILI_LIVE=1, `npm run dev:live`) also use the fixtures, but only on a DEV server, never a build.
const fakeDirector = process.env.NEXT_PUBLIC_AILI_FAKE_DIRECTOR === "1";
// The e2e test of the live path (slice 6) answers from a recording in e2e/fixtures: only in a build
// made with AILI_E2E_RECORDED_LIVE=1 (the main e2e build); every other build gets a stub.
const recordedLive = process.env.AILI_E2E_RECORDED_LIVE === "1";

const nextConfig = (phase: string): NextConfig => {
  // Where the test-fixture registry may be in the build: the fake director, the recorded e2e build, or
  // a DEV server in live mode. Never a real production build.
  const fixturesAllowed = fakeDirector || recordedLive || (phase === PHASE_DEVELOPMENT_SERVER && process.env.AILI_LIVE === "1");
  // The founder demo mode (`npm run dev:demo` sets AILI_CONTENT_MODE in its own environment; never
  // .env.local or a committed file): honoured only where the fixtures are allowed. Every other build
  // is inlined as "standard", whatever the environment says.
  const contentMode = fixturesAllowed && process.env.AILI_CONTENT_MODE === "founder-demo" ? "founder-demo" : "standard";
  return {
  env: { AILI_CONTENT_MODE_BUILD: contentMode },
  // A separate output folder lets the no-drafts production test build alongside the main one.
  distDir: process.env.AILI_DIST_DIR || ".next",
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
  allowedDevOrigins: lanHost ? [lanHost] : [],
  // No dev indicator over the input or in recordings: live mode (`dev:live`, `dev:demo`) and the prepared
  // lessons recorded with `npm run dev:record` (Lucky, 23 Oct 2026). Errors still show (Next.js does that).
  ...(process.env.AILI_LIVE === "1" || process.env.AILI_RECORDING === "1" ? { devIndicators: false as const } : {}),
  turbopack: {
    resolveAlias: {
      "aili-turn-fixtures": fixturesAllowed ? "./src/turn/fixtureRegistry.ts" : "./src/turn/noFixtureRegistry.ts",
      // The fixture scene and asset manifests the page labels in the founder demo mode (a stub elsewhere).
      "aili-demo-content": fixturesAllowed ? "./src/turn/demoContent.ts" : "./src/turn/noDemoContent.ts",
      "aili-recorded-live": recordedLive ? "./src/turn/recordedLive.ts" : "./src/turn/noRecordedLive.ts",
    },
  },
  };
};

export default nextConfig;
