// Build-time testing flags. Direct process.env access so Next inlines them; both are unset in a
// real production build, where ?demo=1 does nothing and the fake-director routes return 404.

/**
 * The fake-director demo (M2 slice 6): NEXT_PUBLIC_AILI_FAKE_DIRECTOR=1 only in .env.local (dev) and
 * the main e2e build. Unset: the turn routes return 404 and the fixture registry is not in the build.
 */
export const FAKE_DIRECTOR = process.env.NEXT_PUBLIC_AILI_FAKE_DIRECTOR === "1";

/**
 * Testing tools under ?demo=1 (Demo controls, performance readout, the fake-director demo):
 * NEXT_PUBLIC_AILI_DEMO_TOOLS=1 only in .env.local and the main e2e build.
 */
export const DEMO_TOOLS = process.env.NEXT_PUBLIC_AILI_DEMO_TOOLS === "1";
