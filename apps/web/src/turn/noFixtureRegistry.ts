import type { fixtureTurnRegistry as Real } from "./fixtureRegistry";

// Production stand-in for the fixture registry (next.config.ts aliases "aili-turn-fixtures" here
// when NEXT_PUBLIC_AILI_FAKE_DIRECTOR is not 1), so no test-fixture file is ever in the build.
// It is never called: the turn routes return 404 before reaching it.
export const fixtureTurnRegistry: typeof Real = () => {
  throw new Error("the test-fixture registry is not part of this build");
};
