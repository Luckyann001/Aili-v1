import { defineConfig, devices } from "@playwright/test";

// Runs against a production build on its own port, so it never clashes with your `npm run dev`.
// Uses the installed Google Chrome (channel "chrome"); no Playwright browser download.
const PORT = 3200;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, channel: "chrome", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
    { name: "phone", use: { ...devices["Pixel 7"], channel: "chrome" } },
  ],
  webServer: {
    command: `npm run build && npx next start --port ${PORT}`,
    url: `http://localhost:${PORT}/home`,
    timeout: 240_000,
    reuseExistingServer: false,
  },
});
