import { defineConfig } from "vitest/config";

// Unit tests only; browser tests in e2e/ run under Playwright (npm run test:e2e).
export default defineConfig({
  test: { include: ["src/**/*.test.ts"], exclude: ["e2e/**", "node_modules/**"] },
  // Unit tests always load the real fixture registry (next.config.ts picks it per build).
  resolve: {
    alias: {
      "aili-turn-fixtures": new URL("./src/turn/fixtureRegistry.ts", import.meta.url).pathname,
      "aili-recorded-live": new URL("./src/turn/recordedLive.ts", import.meta.url).pathname,
      "aili-demo-content": new URL("./src/turn/demoContent.ts", import.meta.url).pathname,
      // The app's "@/..." imports (tsconfig paths); matches "@/x" only, not "@aili/...".
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
});
