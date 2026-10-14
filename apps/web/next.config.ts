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

const nextConfig = (phase: string): NextConfig => ({
  // A separate output folder lets the no-drafts production test build alongside the main one.
  distDir: process.env.AILI_DIST_DIR || ".next",
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
  allowedDevOrigins: lanHost ? [lanHost] : [],
  // Live mode (`npm run dev:live`): no dev indicator over the input or in recordings.
  ...(process.env.AILI_LIVE === "1" ? { devIndicators: false as const } : {}),
  turbopack: {
    resolveAlias: {
      "aili-turn-fixtures": fakeDirector || recordedLive || (phase === PHASE_DEVELOPMENT_SERVER && process.env.AILI_LIVE === "1") ? "./src/turn/fixtureRegistry.ts" : "./src/turn/noFixtureRegistry.ts",
      "aili-recorded-live": recordedLive ? "./src/turn/recordedLive.ts" : "./src/turn/noRecordedLive.ts",
    },
  },
});

export default nextConfig;
