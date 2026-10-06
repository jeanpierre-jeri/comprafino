import { defineConfig } from "@playwright/test";

// Real Better Auth HTTP handlers and PostgreSQL; no browser or Google requests.
export default defineConfig({
  testDir: "./testing",
  testMatch: ["auth.integration.spec.ts", "shopping-list-sync.integration.spec.ts"],
  workers: 1,
  reporter: "list",
});
