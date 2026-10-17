import { createHash } from "node:crypto";
import { z } from "zod";

export const productionProjectId = "prj_Mxem9c1J6AFyLgWrJg6sAzHL6cF3";
export const hostingStateSchema = z.object({
  version: z.literal(1),
  runId: z.string().regex(/^[0-9a-f]{32}$/u),
  commit: z.string().regex(/^[0-9a-f]{40}$/u),
  schema: z.string().regex(/^comprafino_e2e_[0-9a-f]{32}$/u),
  targetHash: z.string().regex(/^[0-9a-f]{64}$/u),
  asOf: z.iso.datetime(),
  size: z.union([z.literal(80), z.literal(2000), z.literal(10000), z.literal(50000)]),
  exactIds: z.array(z.uuid()),
});
export type HostingState = z.infer<typeof hostingStateSchema>;

/** Explicit test credentials only. A test-named database is additional protection,
 * not evidence that the operator chose a separate Neon project. */
export function hostingDatabaseTarget(env: Record<string, string | undefined> = process.env) {
  if (env.DATABASE_URL || env.VERCEL_PROJECT_ID === productionProjectId) {
    throw new Error("Production configuration is forbidden in the hosting test kit");
  }
  const runId = z
    .string()
    .regex(/^[0-9a-f]{32}$/u)
    .parse(env.HOSTING_TEST_RUN_ID);
  const value = z.string().min(1).parse(env.TEST_DATABASE_URL);
  const url = new URL(value);
  if (env.COMPRAFINO_TEST_DATABASE_MODE === "local") {
    if (
      env.VERCEL ||
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.pathname !== "/comprafino_test" ||
      url.search ||
      url.hash
    ) {
      throw new Error("Local rehearsal requires the disposable loopback test database");
    }
  } else if (
    env.COMPRAFINO_TEST_DATABASE_MODE !== undefined ||
    env.HOSTING_TEST_REMOTE_APPROVED !== runId ||
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname.endsWith(".neon.tech") ||
    url.hostname !== env.HOSTING_TEST_DB_HOST ||
    url.pathname !== `/comprafino_hosting_${runId.slice(0, 8)}` ||
    url.searchParams.get("sslmode") !== "require" ||
    [...url.searchParams.keys()].some((key) => key !== "sslmode") ||
    url.hash ||
    !url.username ||
    !url.password
  ) {
    throw new Error("Expected an explicitly approved separate hosting test database");
  }
  const targetHash = createHash("sha256")
    .update(`${url.hostname}:${url.port}${url.pathname}:${url.username}`)
    .digest("hex");
  return { url: value, runId, targetHash };
}

export function hostingRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
  now = Date.now(),
) {
  const target = hostingDatabaseTarget(env);
  const schema = hostingStateSchema.shape.schema.parse(env.HOSTING_TEST_SCHEMA);
  const secret = z.string().min(32).parse(env.HOSTING_TEST_SECRET);
  const expiresAt = Date.parse(z.iso.datetime().parse(env.HOSTING_TEST_EXPIRES_AT));
  if (expiresAt <= now || expiresAt > now + 12 * 60 * 60 * 1000) {
    throw new Error("Hosting test access must expire within twelve hours");
  }
  return { ...target, schema, secret, expiresAt };
}

export function requireOwnedState(
  value: unknown,
  env: Record<string, string | undefined> = process.env,
) {
  const state = hostingStateSchema.parse(value);
  const target = hostingDatabaseTarget(env);
  if (state.runId !== target.runId || state.targetHash !== target.targetHash) {
    throw new Error("Fixture owner or database target differs from the manifest");
  }
  return { state, target };
}
