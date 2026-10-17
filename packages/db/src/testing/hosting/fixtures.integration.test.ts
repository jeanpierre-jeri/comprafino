import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import {
  createHostingFixtures,
  scaleHostingFixtures,
  openHostingFixtures,
  removeHostingFixtures,
} from "./fixtures.ts";
import { closeLocalTestConnections } from "../test-query-client.ts";

afterAll(closeLocalTestConnections, 60000);

it.skipIf(process.env.COMPRAFINO_TEST_DATABASE_MODE !== "local")(
  "rehearses synthetic fixture growth, persisted ownership and selective cleanup",
  async () => {
    // Never consumes DATABASE_URL, even when the developer has an application .env.
    const env = {
      TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
      COMPRAFINO_TEST_DATABASE_MODE: process.env.COMPRAFINO_TEST_DATABASE_MODE,
      HOSTING_TEST_RUN_ID: randomUUID().replaceAll("-", ""),
    };
    if (env.COMPRAFINO_TEST_DATABASE_MODE !== "local") {
      throw new Error("Hosting preparation rehearsal requires explicit local test configuration");
    }
    let state = await createHostingFixtures("c".repeat(40), env);
    process.stdout.write(`${JSON.stringify({ owner: state })}\n`);
    try {
      const sizes =
        env.COMPRAFINO_TEST_DATABASE_MODE === "local" &&
        process.env.HOSTING_TEST_FULL_REHEARSAL === "1"
          ? [2000, 10000, 50000]
          : [2000];
      for (const size of sizes) {
        const result = await scaleHostingFixtures(state, size, env);
        state = result.state;
        expect(state.exactIds).toHaveLength(50);
        expect(Number(result.storage)).toBeGreaterThan(0);
        process.stdout.write(
          `${JSON.stringify({ size, counts: result.counts, storageBytes: result.storage })}\n`,
        );
      }
      await expect(openHostingFixtures({ ...state, commit: "d".repeat(40) }, env)).rejects.toThrow(
        "ownership marker",
      );
      await expect(removeHostingFixtures(state, env)).rejects.toThrow("Stop");
      expect((await openHostingFixtures(state, env)).state.size).toBe(sizes.at(-1));
    } finally {
      await removeHostingFixtures(state, { ...env, HOSTING_TEST_STOPPED: env.HOSTING_TEST_RUN_ID });
    }
    await expect(openHostingFixtures(state, env)).rejects.toThrow(/does not exist/u);
  },
  900000,
);
