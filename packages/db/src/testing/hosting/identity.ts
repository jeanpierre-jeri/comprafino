import { neon } from "@neondatabase/serverless";
import { z } from "zod";
import { hostingRuntimeConfig } from "./config.ts";
import { testSchemaClient } from "../test-schema-client.ts";

export async function hostingIdentity(runId: string, commit: string) {
  const config = hostingRuntimeConfig();
  const client = testSchemaClient(
    neon(config.url, {
      fetchOptions: { signal: AbortSignal.timeout(5000) },
    }),
    config.schema,
  );
  const owners = z
    .array(z.object({ run_id: z.string(), source_commit: z.string(), size: z.number() }))
    .parse(
      await client.query(
        "select run_id, source_commit, (select count(*)::int from retailer_listings) as size from hosting_test_owner",
      ),
    );
  const owner = owners[0];
  if (owners.length !== 1 || owner?.run_id !== runId || owner.source_commit !== commit) {
    throw new Error("Fixture ownership mismatch");
  }
  return { runId, commit, schema: config.schema, size: owner.size };
}
