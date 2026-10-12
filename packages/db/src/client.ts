import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { requireDatabaseUrl } from "./env.ts";
import * as schema from "./schema.ts";

/** Production transport only; importing this module opens no connection. */
export function createDatabase(
  env: Record<string, string | undefined> = process.env,
  options: { requestTimeoutMs?: number } = {},
) {
  const timeout = options.requestTimeoutMs;
  if (
    timeout !== undefined &&
    (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 2_147_483_647)
  ) {
    throw new Error("Database request timeout must be a positive timer-safe integer");
  }

  const fetchOptions =
    timeout === undefined
      ? undefined
      : {
          // Neon spreads these options when executing each HTTP request. A signal
          // created when constructing the client would permanently expire that client.
          get signal() {
            return AbortSignal.timeout(timeout);
          },
        };

  return drizzle(neon(requireDatabaseUrl(env), { fetchOptions }), { schema });
}
