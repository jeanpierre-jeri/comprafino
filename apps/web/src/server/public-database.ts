import { createDatabase } from "@comprafino/db";
import { publicRequestPolicy } from "../lib/public-request-policy.ts";
import { withinRequestBudget } from "../lib/request-budget.ts";

export function publicDatabaseOptions(signal: AbortSignal) {
  return {
    signal,
    requestTimeoutMs: publicRequestPolicy.transportMs,
    statementTimeoutMs: publicRequestPolicy.statementMs,
  };
}

export function withPublicDatabase<T>(
  operation: (database: ReturnType<typeof createDatabase>) => Promise<T>,
) {
  return withinRequestBudget(publicRequestPolicy.operationMs, undefined, (signal) =>
    operation(createDatabase(process.env, publicDatabaseOptions(signal))),
  );
}
