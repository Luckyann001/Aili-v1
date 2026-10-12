import { defineConfig, devices } from "@playwright/test";

// Runs against a production build on its own port, so it never clashes with your `npm run dev`.
// The drafts flag is set here (not read from .env.local): the lesson scenes are drafts.
// Uses the installed Google Chrome (channel "chrome"); no Playwright browser download.
const PORT = 3200;

// The fake-director and demo-tools flags are set here too: the ?demo=1 tools are tested in this build.
const ENV = "AILI_DIST_DIR=.next-e2e AILI_ENABLE_PREVIEW=1 NEXT_PUBLIC_AILI_INCLUDE_DRAFTS=1 NEXT_PUBLIC_AILI_FAKE_DIRECTOR=1 NEXT_PUBLIC_AILI_DEMO_TOOLS=1";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, channel: "chrome", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
    { name: "tablet", use: { viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: "phone", use: { ...devices["Pixel 7"], channel: "chrome" } },
  ],
  webServer: {
    // AILI_ENABLE_PREVIEW=1 keeps the dev-only /preview page in this test build (it is tested here).
    // Own output folder (.next-e2e), so a test run never rebuilds a `.next` that `npm run start` is serving.
    command: `${ENV} npm run build && ${ENV} npx next start --port ${PORT}`,
    url: `http://localhost:${PORT}/home`,
    timeout: 240_000,
    reuseExistingServer: false,
  },
});
