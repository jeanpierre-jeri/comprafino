import { defineConfig } from "drizzle-kit";

// Generation is local and does not need credentials or a live database.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
});
