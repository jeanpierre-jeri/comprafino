import {
  remoteShoppingListStateSchema,
  serializeShoppingList,
  shoppingListOwnerIdSchema,
} from "@comprafino/core";
import { createDatabase, readUserShoppingList } from "@comprafino/db";
import { withinRequestBudget } from "../lib/request-budget.ts";
import { publicRequestPolicy } from "../lib/public-request-policy.ts";
import { publicDatabaseOptions } from "./public-database.ts";
import { logDiagnostic } from "./diagnostics.ts";

type ExportSession = { user: { id: string }; session: { id: string } } | null;

export function shoppingListExportHandler({
  session,
  database = createDatabase,
  read = readUserShoppingList,
  budgetMs = publicRequestPolicy.operationMs,
}: {
  session: (headers: Headers, signal: AbortSignal) => Promise<ExportSession>;
  database?: typeof createDatabase;
  read?: typeof readUserShoppingList;
  budgetMs?: number;
}) {
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  const failure = (error: string, status: number) => Response.json({ error }, { status, headers });

  return async (request: Request) => {
    try {
      return await withinRequestBudget(budgetMs, request.signal, async (signal) => {
        const resolved = await session(request.headers, signal);
        signal.throwIfAborted();
        if (!resolved) return failure("unauthenticated", 401);

        // The expected session is a stale-UI guard, never authorization. The
        // signed cookie alone establishes the owner used for the database read.
        if (request.headers.get("x-comprafino-export-session") !== resolved.session.id) {
          return failure("session_changed", 409);
        }
        const owner = shoppingListOwnerIdSchema.parse(resolved.user.id);
        const state = remoteShoppingListStateSchema.parse(
          await read(database(process.env, publicDatabaseOptions(signal)), owner),
        );
        signal.throwIfAborted();
        return new Response(serializeShoppingList(state.list), {
          headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
        });
      });
    } catch (error) {
      logDiagnostic(error, {
        stage: "persistence",
        operation: "list_sync",
        reason: "db_read_failed",
      });
      return failure("list_unavailable", 503);
    }
  };
}
