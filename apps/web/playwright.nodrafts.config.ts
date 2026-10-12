import { defineConfig, devices } from "@playwright/test";

// A real production build WITHOUT the drafts flag (pinned to 0, which takes priority over any
// .env.local value), in its own output folder and port. Checks that draft scenes stay hidden.
const PORT = 3300;
// The fake-director flag is pinned off too, as in a real production deployment.
const ENV = "AILI_DIST_DIR=.next-nodrafts NEXT_PUBLIC_AILI_INCLUDE_DRAFTS=0 NEXT_PUBLIC_AILI_FAKE_DIRECTOR=0";

export default defineConfig({
  testDir: "e2e-nodrafts",
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, channel: "chrome" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
    { name: "phone", use: { ...devices["Pixel 7"], channel: "chrome" } },
  ],
  webServer: {
    command: `${ENV} npx next build && ${ENV} npx next start --port ${PORT}`,
    url: `http://localhost:${PORT}/home`,
    timeout: 300_000,
    reuseExistingServer: false,
  },
});
