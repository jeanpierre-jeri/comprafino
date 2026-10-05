import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "stream-cancellation.spec.ts",
  workers: 1,
  reporter: "list",
});
