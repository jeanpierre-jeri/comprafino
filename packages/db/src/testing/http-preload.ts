import { neonConfig } from "@neondatabase/serverless";
import { fixtureDatabaseUrl } from "./fixture-url.ts";
import { z } from "zod";
import { requireDatabaseUrl } from "../env.ts";
import { createTestQueryClient } from "./test-query-client.ts";

// Explicit node --import preload for the owned fixture server, never imported by
// production. Intercept the HTTP wire boundary so bundled Neon uses the same API.
const url = requireDatabaseUrl({ DATABASE_URL: process.env.TEST_DATABASE_URL });

const schema = z
  .string()
  .regex(/^comprafino_e2e_[0-9a-f]{32}$/u)
  .parse(process.env.COMPRAFINO_E2E_SCHEMA);

const mode = process.env.COMPRAFINO_TEST_DATABASE_MODE;

if (mode !== undefined && mode !== "local") {
  throw new Error("Unknown test transport");
}

const localClient = mode === "local" ? createTestQueryClient(url, mode) : null;

const nativeFetch = globalThis.fetch;

const querySchema = z.object({ query: z.string(), params: z.array(z.unknown()) });

const batchSchema = z.object({ queries: z.array(querySchema) });

const path = { query: "select set_config('search_path', $1, true)", params: [schema] };

const fixtureFetch: typeof fetch = async (input, init) => {
  const headers = new Headers(init?.headers);
  const connectionUrl = headers.get("Neon-Connection-String");

  if (!connectionUrl) return nativeFetch(input, init);

  // Neon adds its own application_name; compare all other URL components.
  const actual = new URL(connectionUrl);
  const expected = new URL(fixtureDatabaseUrl(url, mode));
  actual.protocol = "postgresql:";
  expected.protocol = "postgresql:";
  actual.searchParams.delete("application_name");
  expected.searchParams.delete("application_name");
  actual.searchParams.sort();
  expected.searchParams.sort();

  if (actual.href !== expected.href) {
    throw new Error("Fixture request used an unowned database URL");
  }

  if (typeof init?.body !== "string") {
    throw new Error("Expected Neon JSON body");
  }

  const value: unknown = JSON.parse(init.body);
  const batch = batchSchema.safeParse(value);
  const queries = [path, ...(batch.success ? batch.data.queries : [querySchema.parse(value)])];

  if (!localClient) {
    const response = await nativeFetch(input, { ...init, body: JSON.stringify({ queries }) });

    if (!response.ok) return response;

    const data = z.object({ results: z.array(z.unknown()) }).parse(await response.json());

    return Response.json(batch.success ? { results: data.results.slice(1) } : data.results[1]);
  }

  if (
    ["Neon-Batch-Isolation-Level", "Neon-Batch-Read-Only", "Neon-Batch-Deferrable"].some((key) =>
      headers.has(key),
    )
  ) {
    throw new Error("Local fixtures support default transaction options only");
  }

  try {
    // Share the same owned TCP pool, lazy batch, rollback and option guards as DB tests.
    const options = {
      arrayMode: true,
      fullResults: true,
      types: { getTypeParser: () => (raw: string) => raw },
    } as const;
    const results = await localClient.transaction(
      queries.map((query) => localClient.query(query.query, query.params)),
      options,
    );

    return Response.json(batch.success ? { results: results.slice(1) } : results[1]);
  } catch (error) {
    // Match the Neon wire error fields without serializing driver context.
    const parsed = z
      .object({ code: z.string().optional(), constraint: z.string().optional() })
      .safeParse(error);

    return Response.json(
      { message: "Fixture database query failed", ...(parsed.success ? parsed.data : {}) },
      { status: 400 },
    );
  }
};

globalThis.fetch = fixtureFetch;

neonConfig.fetchFunction = fixtureFetch;
