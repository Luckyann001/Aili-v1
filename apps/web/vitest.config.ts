import { defineConfig } from "vitest/config";

// Unit tests only; browser tests in e2e/ run under Playwright (npm run test:e2e).
export default defineConfig({
  test: { include: ["src/**/*.test.ts"], exclude: ["e2e/**", "node_modules/**"] },
});
