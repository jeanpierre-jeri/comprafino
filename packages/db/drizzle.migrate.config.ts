import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";
import { requireDatabaseUrl } from "./src/env";
import base from "./drizzle.config";

config({ path: "../../.env", quiet: true });
export default defineConfig({ ...base, dbCredentials: { url: requireDatabaseUrl() } });
