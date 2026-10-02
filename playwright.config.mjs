import { defineConfig } from "@playwright/test";

const baseURL = process.env.CATAN_DEMO_URL ?? "http://localhost:3000";
// Parallel demo invocations must not remove another running browser's traces.
// Keep this value consistent when Playwright loads the config in its worker.
process.env.CATAN_DEMO_RUN_ID ??= `${Date.now()}-${process.pid}`;

export default defineConfig({
  testDir: "./tests/playwright",
  testMatch: "catan-demo.spec.mjs",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // This is an intentionally slow, interactive game, bounded by a turn limit.
  timeout: 0,
  expect: { timeout: 15000 },
  reporter: "list",
  outputDir: `.wrangler/playwright-results/${process.env.CATAN_DEMO_RUN_ID}`,
  use: {
    baseURL,
    browserName: "chromium",
    headless: process.env.CATAN_DEMO_HEADLESS === "1",
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "no-preference",
    actionTimeout: 15000,
    navigationTimeout: 30000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      slowMo: Number(process.env.CATAN_DEMO_SLOW_MO_MS ?? 250),
      // Playwright normally mutes Chromium; keep the actual game audio audible.
      ignoreDefaultArgs: ["--mute-audio"],
    },
  },
  webServer: process.env.CATAN_DEMO_URL ? undefined : {
    command: "npm run dev -- -p 3000",
    url: `${baseURL}/catan`,
    reuseExistingServer: true,
    timeout: 120000,
  },
});
