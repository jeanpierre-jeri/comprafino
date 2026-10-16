import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { requireDatabaseUrl } from "./env.ts";
import * as schema from "./schema.ts";
import { withStatementBudget } from "./statement-budget.ts";

/** Production transport only; importing this module opens no connection. */
export function createDatabase(
  env: Record<string, string | undefined> = process.env,
  options: { requestTimeoutMs?: number; statementTimeoutMs?: number; signal?: AbortSignal } = {},
) {
  const timeout = options.requestTimeoutMs;
  for (const duration of [timeout, options.statementTimeoutMs]) {
    if (
      duration !== undefined &&
      (!Number.isSafeInteger(duration) || duration <= 0 || duration > 2_147_483_647)
    ) {
      throw new Error("Database timeout must be a positive timer-safe integer");
    }
  }

  const fetchOptions =
    timeout === undefined && options.signal === undefined
      ? undefined
      : {
          // Neon spreads these options when executing each HTTP request. A signal
          // created when constructing the client would permanently expire that client.
          get signal() {
            options.signal?.throwIfAborted();
            const signals = options.signal ? [options.signal] : [];

            if (timeout !== undefined) signals.push(AbortSignal.timeout(timeout));

            return AbortSignal.any(signals);
          },
        };

  const client = neon(requireDatabaseUrl(env), { fetchOptions });

  return drizzle(
    options.statementTimeoutMs === undefined
      ? client
      : withStatementBudget(client, options.statementTimeoutMs),
    { schema },
  );
}
