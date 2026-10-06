import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: [
    "**/stream-cancellation.spec.ts",
    "testing/shopping-api.spec.ts",
    "testing/auth.spec.ts",
    "testing/shopping-list-sync.spec.ts",
    "testing/shopping-list-client.spec.ts",
  ],
  workers: 1,
  reporter: "list",
});
