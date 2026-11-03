import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  testMatch: "*.spec.ts",
  timeout: 30000,
  workers: 1,
  reporter: "list",
  use: { trace: "retain-on-failure" },
  outputDir: "test-results",
});
