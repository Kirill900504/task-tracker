import { defineConfig } from "@playwright/test";

// No separate staging environment exists (see e2e/global-setup.ts for why
// that's safe to run against production anyway) — defaults to the live
// deployment; override with E2E_BASE_URL for a local dev server instead.
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  reporter: "list",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: process.env.E2E_BASE_URL || "https://task-tracker-beta-ebon.vercel.app",
    screenshot: "only-on-failure",
  },
});
