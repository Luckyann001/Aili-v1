import { defineConfig, devices } from "@playwright/test";

// The founder demo mode's labels (slice A), on a TEST build: the recorded live path (e2e/fixtures),
// answered from a recording, never a model, with AILI_CONTENT_MODE=founder-demo and the drafts flag
// pinned OFF, so the fixture scene must show without it. Its own folder and port. Not a live run.
const PORT = 3400;
const ENV = "AILI_DIST_DIR=.next-demo NEXT_PUBLIC_AILI_INCLUDE_DRAFTS=0 NEXT_PUBLIC_AILI_FAKE_DIRECTOR=0 NEXT_PUBLIC_AILI_DEMO_TOOLS=0 AILI_E2E_RECORDED_LIVE=1 AILI_CONTENT_MODE=founder-demo";

export default defineConfig({
  testDir: "e2e-demo",
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, channel: "chrome" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
    { name: "tablet", use: { viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: "phone", use: { ...devices["Pixel 7"], channel: "chrome" } },
  ],
  webServer: {
    command: `${ENV} npm run build && ${ENV} npx next start --port ${PORT}`,
    url: `http://localhost:${PORT}/home`,
    timeout: 300_000,
    reuseExistingServer: false,
  },
});
