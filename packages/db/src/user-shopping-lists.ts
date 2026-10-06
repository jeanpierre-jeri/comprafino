import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  emptyShoppingList,
  shoppingListSchema,
  saveShoppingItem,
  removeShoppingItem,
  shoppingListOwnerIdSchema,
  shoppingListSyncRequestSchema,
  shoppingListRevisionMaximum,
  shoppingListRevisionSchema,
  remoteShoppingListStateSchema,
  remoteShoppingListSchema,
} from "@comprafino/core";
import type {
  RemoteShoppingListState,
  ShoppingListSyncRequest,
  ShoppingListSyncOperation,
  ShoppingList,
} from "@comprafino/core";
import type { createDatabase } from "./client.ts";
import { userShoppingLists } from "./schema.ts";

type Database = ReturnType<typeof createDatabase>;
export type UserShoppingListMutation =
  | { status: "success"; state: RemoteShoppingListState }
  | { status: "conflict"; current: RemoteShoppingListState };

export class ShoppingListDomainError extends Error {
  constructor(cause: unknown) {
    super("Shopping list operation rejected", { cause });
  }
}
export class ShoppingListRevisionExhaustedError extends Error {
  constructor() {
    super("Shopping list revision exhausted");
  }
}
const stored = z.object({ revision: shoppingListRevisionSchema.min(1), data: z.unknown() });
function state(row: unknown): RemoteShoppingListState {
  const parsed = stored.parse(row);
  return remoteShoppingListStateSchema.parse({
    revision: parsed.revision,
    list: remoteShoppingListSchema.parse(parsed.data),
  });
}
const absent = (): RemoteShoppingListState => ({ revision: 0, list: emptyShoppingList() });
export async function readUserShoppingList(
  db: Database,
  rawUserId: string,
): Promise<RemoteShoppingListState> {
  const userId = shoppingListOwnerIdSchema.parse(rawUserId);
  const rows = await db
    .select({ revision: userShoppingLists.revision, data: userShoppingLists.data })
    .from(userShoppingLists)
    .where(eq(userShoppingLists.userId, userId));
  return rows[0] ? state(rows[0]) : absent();
}
function apply(list: ShoppingList, operation: ShoppingListSyncOperation): ShoppingList {
  try {
    return shoppingListSchema.parse(
      operation.type === "save"
        ? saveShoppingItem(list, operation.item)
        : removeShoppingItem(list, operation.id),
    );
  } catch (error) {
    throw new ShoppingListDomainError(error);
  }
}

/** Single-statement writes; no interactive transactions or automatic CAS retry. */
export async function mutateUserShoppingList(
  db: Database,
  rawUserId: string,
  rawRequest: ShoppingListSyncRequest,
): Promise<UserShoppingListMutation> {
  const userId = shoppingListOwnerIdSchema.parse(rawUserId);
  const { expectedRevision, operation } = shoppingListSyncRequestSchema.parse(rawRequest);
  const conflict = async (): Promise<UserShoppingListMutation> => ({
    status: "conflict",
    current: await readUserShoppingList(db, userId),
  });
  if (expectedRevision === 0 && operation.type === "save") {
    const data = apply(emptyShoppingList(), operation);
    const rows = await db
      .insert(userShoppingLists)
      .values({ userId, revision: 1, data })
      .onConflictDoNothing({ target: userShoppingLists.userId })
      .returning({ revision: userShoppingLists.revision, data: userShoppingLists.data });
    // A separate SELECT sees a concurrently committed winner, unlike a shared CTE snapshot.
    return rows[0] ? { status: "success", state: state(rows[0]) } : conflict();
  }
  const current = await readUserShoppingList(db, userId);
  if (current.revision !== expectedRevision) return { status: "conflict", current };
  if (operation.type === "remove" && !current.list.items.some((item) => item.id === operation.id)) {
    return { status: "success", state: current };
  }
  const data = apply(current.list, operation);
  if (current.revision === shoppingListRevisionMaximum)
    throw new ShoppingListRevisionExhaustedError();
  const rows = await db
    .update(userShoppingLists)
    .set({
      data,
      revision: sql`${userShoppingLists.revision} + 1`,
      updatedAt: sql`clock_timestamp()`,
    })
    .where(
      and(eq(userShoppingLists.userId, userId), eq(userShoppingLists.revision, expectedRevision)),
    )
    .returning({ revision: userShoppingLists.revision, data: userShoppingLists.data });
  return rows[0] ? { status: "success", state: state(rows[0]) } : conflict();
}
