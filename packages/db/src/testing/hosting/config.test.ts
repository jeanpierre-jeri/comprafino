import { describe, expect, it } from "vitest";
import {
  hostingDatabaseTarget,
  hostingRuntimeConfig,
  productionProjectId,
  requireOwnedState,
} from "./config.ts";

const runId = "a".repeat(32);
const remote = {
  HOSTING_TEST_RUN_ID: runId,
  HOSTING_TEST_DB_HOST: "ep-fixture-test.us-east-1.aws.neon.tech",
  HOSTING_TEST_REMOTE_APPROVED: runId,
  TEST_DATABASE_URL:
    "postgresql://test:unused@ep-fixture-test.us-east-1.aws.neon.tech/comprafino_hosting_aaaaaaaa?sslmode=require",
};

describe("isolated hosting test boundaries", () => {
  it("requires explicit test credentials and rejects any production configuration", () => {
    expect(() => hostingDatabaseTarget({ DATABASE_URL: remote.TEST_DATABASE_URL })).toThrow(
      "Production configuration",
    );
    expect(() =>
      hostingDatabaseTarget({ ...remote, DATABASE_URL: remote.TEST_DATABASE_URL }),
    ).toThrow("Production configuration");
    expect(() =>
      hostingDatabaseTarget({ ...remote, VERCEL_PROJECT_ID: productionProjectId }),
    ).toThrow("Production configuration");
    expect(() =>
      hostingDatabaseTarget({ ...remote, HOSTING_TEST_REMOTE_APPROVED: undefined }),
    ).toThrow("explicitly approved");
    expect(hostingDatabaseTarget(remote).runId).toBe(runId);
  });

  it.each([
    "postgresql://test:unused@ep-other.neon.tech/comprafino_hosting_aaaaaaaa?sslmode=require",
    "postgresql://test:unused@ep-fixture-test.us-east-1.aws.neon.tech/neondb?sslmode=require",
    `${remote.TEST_DATABASE_URL}&options=-csearch_path=public`,
    remote.TEST_DATABASE_URL.replace("sslmode=require", "sslmode=disable"),
  ])("rejects a changed host/database or connection settings: %s", (url) => {
    expect(() => hostingDatabaseTarget({ ...remote, TEST_DATABASE_URL: url })).toThrow(
      "explicitly approved",
    );
  });

  it("confines local rehearsal to the disposable Docker database", () => {
    const local = {
      HOSTING_TEST_RUN_ID: runId,
      COMPRAFINO_TEST_DATABASE_MODE: "local",
      TEST_DATABASE_URL: "postgresql://comprafino_test@127.0.0.1:55432/comprafino_test",
    };
    expect(hostingDatabaseTarget(local).runId).toBe(runId);
    expect(() => hostingDatabaseTarget({ ...local, VERCEL: "1" })).toThrow("loopback");
    expect(() =>
      hostingDatabaseTarget({
        ...local,
        TEST_DATABASE_URL: local.TEST_DATABASE_URL.replace("127.0.0.1", "example.com"),
      }),
    ).toThrow("loopback");
  });

  it("fails closed on expired credentials and unsafe schemas", () => {
    const now = Date.parse("2026-10-16T12:00:00Z");
    const env = {
      ...remote,
      HOSTING_TEST_SCHEMA: `comprafino_e2e_${"b".repeat(32)}`,
      HOSTING_TEST_SECRET: "s".repeat(48),
      HOSTING_TEST_EXPIRES_AT: "2026-10-16T13:00:00Z",
    };
    expect(hostingRuntimeConfig(env, now).expiresAt).toBe(now + 3600000);
    expect(() => hostingRuntimeConfig(env, now + 3600000)).toThrow("expire within");
    expect(() => hostingRuntimeConfig(env, now - 12 * 3600000)).toThrow("expire within");
    expect(() => hostingRuntimeConfig({ ...env, HOSTING_TEST_SCHEMA: "public" }, now)).toThrow(
      "Invalid",
    );
    expect(() => hostingRuntimeConfig({ ...env, HOSTING_TEST_SECRET: "short" }, now)).toThrow(
      "Too small",
    );
  });

  it("pins cleanup ownership to run, schema syntax and database identity", () => {
    const target = hostingDatabaseTarget(remote);
    const state = {
      version: 1,
      runId,
      commit: "c".repeat(40),
      schema: `comprafino_e2e_${"b".repeat(32)}`,
      targetHash: target.targetHash,
      asOf: "2026-10-16T12:00:00Z",
      size: 2000,
      exactIds: [],
    };
    expect(requireOwnedState(state, remote).state.runId).toBe(runId);
    expect(() => requireOwnedState({ ...state, targetHash: "0".repeat(64) }, remote)).toThrow(
      "differs",
    );
    expect(() => requireOwnedState({ ...state, runId: "d".repeat(32) }, remote)).toThrow("differs");
    expect(() => requireOwnedState({ ...state, schema: 'public" cascade; --' }, remote)).toThrow(
      "Invalid",
    );
  });
});
