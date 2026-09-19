import { defineConfig } from "@playwright/test";

// No separate staging environment exists (see e2e/global-setup.ts for why
// that's safe to run against production anyway) — defaults to the live
// deployment; override with E2E_BASE_URL for a local dev server instead.
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  // Один воркер, и это не про скорость. На весь прогон заводится ОДИН
  // тестовый аккаунт (`e2e/global-setup.ts`), а значит все тесты работают
  // с одними и теми же задачами, встречами и людьми: два параллельных
  // топчут строки друг друга. По умолчанию Playwright берёт половину ядер,
  // и 19.09.2026 это стоило отдельного разбирательства — `mobile.spec.ts`
  // падал в общем прогоне и проходил 6 из 6 в одиночку, и выглядело это
  // как регрессия, которой не было. Параллелить можно будет тогда, когда
  // аккаунт станет свой у каждого воркера, а не раньше.
  workers: 1,
  reporter: "list",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: process.env.E2E_BASE_URL || "https://task-tracker-beta-ebon.vercel.app",
    screenshot: "only-on-failure",
  },
});
