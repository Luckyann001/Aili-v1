import { defineConfig, devices } from "@playwright/test";

// A real production build WITHOUT the drafts flag (pinned to 0, which takes priority over any
// .env.local value), in its own output folder and port. Checks that draft scenes stay hidden.
const PORT = 3300;
// The fake-director and demo-tools flags are pinned off too, as in a real production deployment.
// AILI_LIVE is pinned ON on purpose: a production build and server must refuse live mode anyway.
// AILI_E2E_RECORDED_LIVE is set at RUN time only (not at build): a build made without it must refuse
// the recorded live path even when the variable and the test's cookie are present.
// AILI_CONTENT_MODE=founder-demo is set on purpose too: a production build must ignore the founder demo mode.
const ENV = "AILI_DIST_DIR=.next-nodrafts NEXT_PUBLIC_AILI_INCLUDE_DRAFTS=0 NEXT_PUBLIC_AILI_FAKE_DIRECTOR=0 NEXT_PUBLIC_AILI_DEMO_TOOLS=0 AILI_LIVE=1 AILI_CONTENT_MODE=founder-demo";

export default defineConfig({
  testDir: "e2e-nodrafts",
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, channel: "chrome" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
    { name: "phone", use: { ...devices["Pixel 7"], channel: "chrome" } },
  ],
  webServer: {
    command: `${ENV} npx next build && ${ENV} AILI_E2E_RECORDED_LIVE=1 npx next start --port ${PORT}`,
    url: `http://localhost:${PORT}/home`,
    timeout: 300_000,
    reuseExistingServer: false,
  },
});
