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
} from "@comprafino/db";
import { boundedJson } from "./request-body.ts";
import { logDiagnostic } from "./diagnostics.ts";

type Session = { user: { id: string } } | null;
export function shoppingListSyncHandlers({
  session,
  origin,
  database = createDatabase,
  read = readUserShoppingList,
  mutate = mutateUserShoppingList,
}: {
  session: (headers: Headers) => Promise<Session>;
  origin: () => string;
  database?: typeof createDatabase;
  read?: typeof readUserShoppingList;
  mutate?: typeof mutateUserShoppingList;
}) {
  const reply = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  const unavailable = () => reply({ error: "list_unavailable" }, 503);
  async function owner(request: Request): Promise<{ userId: string } | Response> {
    try {
      const resolved = await session(request.headers);
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
      const authenticated = await owner(request);
      if (authenticated instanceof Response) return authenticated;
      try {
        return reply(
          remoteShoppingListStateSchema.parse(await read(database(), authenticated.userId)),
        );
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
      const authenticated = await owner(request);
      if (authenticated instanceof Response) return authenticated;
      try {
        const trusted = origin();
        const configured = new URL(trusted);
        if (configured.origin !== trusted || !["https:", "http:"].includes(configured.protocol))
          throw new Error("Invalid sync origin configuration");
        if (request.headers.get("origin") !== trusted) {
          return reply({ error: "untrusted_mutation" }, 403);
        }
        if (
          request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
          "application/json"
        ) {
          return reply({ error: "unsupported_media_type" }, 415);
        }
        const input = await boundedJson(request);
        if ("status" in input) return reply({ error: "invalid_request" }, input.status);
        const parsed = shoppingListSyncRequestSchema.safeParse(input.body);
        if (!parsed.success) return reply({ error: "invalid_request" }, 400);
        const result = await mutate(database(), authenticated.userId, parsed.data);
        return result.status === "success"
          ? reply(remoteShoppingListStateSchema.parse(result.state))
          : reply(
              shoppingListRevisionConflictSchema.parse({
                error: "revision_conflict",
                current: result.current,
              }),
              409,
            );
      } catch (error) {
        if (error instanceof ShoppingListDomainError)
          return reply({ error: "mutation_rejected" }, 422);
        logDiagnostic(error, {
          stage: "persistence",
          operation: "list_sync",
          reason: "db_write_failed",
        });
        return unavailable();
      }
    },
  };
}
