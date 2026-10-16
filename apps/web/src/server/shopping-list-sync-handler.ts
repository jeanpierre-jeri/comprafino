import {
  shoppingListOwnerIdSchema,
  shoppingListSyncRequestSchema,
  remoteShoppingListStateSchema,
  shoppingListRevisionConflictSchema,
} from "@comprafino/core";
import {
  createDatabase,
  readUserShoppingList,
  mutateUserShoppingList,
  ShoppingListDomainError,
  ShoppingListRevisionExhaustedError,
} from "@comprafino/db";
import { boundedJson } from "./request-body.ts";
import { logDiagnostic } from "./diagnostics.ts";
import { withinRequestBudget } from "../lib/request-budget.ts";
import { publicRequestPolicy } from "../lib/public-request-policy.ts";
import { publicDatabaseOptions } from "./public-database.ts";

type Session = { user: { id: string } } | null;

export function shoppingListSyncHandlers({
  session,
  origin,
  database = createDatabase,
  read = readUserShoppingList,
  mutate = mutateUserShoppingList,
  budgetMs = publicRequestPolicy.operationMs,
}: {
  session: (headers: Headers, signal: AbortSignal) => Promise<Session>;
  origin: () => string;
  database?: typeof createDatabase;
  read?: typeof readUserShoppingList;
  mutate?: typeof mutateUserShoppingList;
  budgetMs?: number;
}) {
  const reply = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  const unavailable = () => reply({ error: "list_unavailable" }, 503);

  async function owner(
    request: Request,
    signal: AbortSignal,
  ): Promise<{ userId: string } | Response> {
    try {
      const resolved = await session(request.headers, signal);
      signal.throwIfAborted();

      return resolved
        ? { userId: shoppingListOwnerIdSchema.parse(resolved.user.id) }
        : reply({ error: "unauthenticated" }, 401);
    } catch (error) {
      logDiagnostic(error, {
        stage: "persistence",
        operation: "list_sync",
        reason: "db_read_failed",
      });

      return unavailable();
    }
  }

  return {
    GET: async (request: Request) => {
      try {
        return await withinRequestBudget(budgetMs, request.signal, async (signal) => {
          const authenticated = await owner(request, signal);

          if (authenticated instanceof Response) return authenticated;

          signal.throwIfAborted();
          return reply(
            remoteShoppingListStateSchema.parse(
              await read(
                database(process.env, publicDatabaseOptions(signal)),
                authenticated.userId,
              ),
            ),
          );
        });
      } catch (error) {
        logDiagnostic(error, {
          stage: "persistence",
          operation: "list_sync",
          reason: "db_read_failed",
        });

        return unavailable();
      }
    },
    POST: async (request: Request) => {
      let mutationStarted = false;
      try {
        return await withinRequestBudget(budgetMs, request.signal, async (signal) => {
          const authenticated = await owner(request, signal);

          if (authenticated instanceof Response) return authenticated;

          const trusted = origin();
          const configured = new URL(trusted);

          if (configured.origin !== trusted || !["https:", "http:"].includes(configured.protocol)) {
            throw new Error("Invalid sync origin configuration");
          }

          if (request.headers.get("origin") !== trusted) {
            return reply({ error: "untrusted_mutation" }, 403);
          }

          if (
            request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
            "application/json"
          ) {
            return reply({ error: "unsupported_media_type" }, 415);
          }

          const input = await boundedJson(request, signal);

          if ("status" in input) return reply({ error: "invalid_request" }, input.status);

          const parsed = shoppingListSyncRequestSchema.safeParse(input.body);

          if (!parsed.success) return reply({ error: "invalid_request" }, 400);

          signal.throwIfAborted();
          const db = database(process.env, publicDatabaseOptions(signal));
          mutationStarted = true;
          const result = await mutate(db, authenticated.userId, parsed.data);

          return result.status === "success"
            ? reply(remoteShoppingListStateSchema.parse(result.state))
            : reply(
                shoppingListRevisionConflictSchema.parse({
                  error: "revision_conflict",
                  current: result.current,
                }),
                409,
              );
        });
      } catch (error) {
        if (error instanceof ShoppingListDomainError) {
          return reply({ error: "mutation_rejected" }, 422);
        }
        if (error instanceof ShoppingListRevisionExhaustedError) return unavailable();

        logDiagnostic(error, {
          stage: "persistence",
          operation: "list_sync",
          reason: "db_write_failed",
        });

        // A lost response/timeout is not proof that an atomic CAS write rolled back.
        return mutationStarted ? reply({ error: "mutation_uncertain" }, 503) : unavailable();
      }
    },
  };
}
