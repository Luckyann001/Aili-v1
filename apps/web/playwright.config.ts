import { defineConfig, devices } from "@playwright/test";

// Runs against a production build on its own port, so it never clashes with your `npm run dev`.
// The drafts flag is set here (not read from .env.local): the lesson scenes are drafts.
// Uses the installed Google Chrome (channel "chrome"); no Playwright browser download.
const PORT = 3200;

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
    command: `NEXT_PUBLIC_AILI_INCLUDE_DRAFTS=1 npm run build && NEXT_PUBLIC_AILI_INCLUDE_DRAFTS=1 npx next start --port ${PORT}`,
    url: `http://localhost:${PORT}/home`,
    timeout: 240_000,
    reuseExistingServer: false,
  },
});
