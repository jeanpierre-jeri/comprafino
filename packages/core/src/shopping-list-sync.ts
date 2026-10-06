import { z } from "zod";
import {
  shoppingListItemSchema,
  shoppingListSchema,
  shoppingQuantitySchema,
  shoppingListPolicy,
} from "./shopping-list.ts";

export const shoppingListRevisionMaximum = 2_147_483_647;
export const shoppingListRevisionSchema = z.number().int().min(0).max(shoppingListRevisionMaximum);
// Used only for the session/repository owner boundary; never accepted in requests.
export const shoppingListOwnerIdSchema = z.uuid();

// Derive strict wire schemas without copying domain fields, defaults or refinements.
const quantity = shoppingQuantitySchema.strict();
const [generic, preferred, strict] = shoppingListItemSchema.options;
const item = z.discriminatedUnion("intent", [
  generic.safeExtend({ quantity }).strict(),
  preferred.safeExtend({ quantity }).strict(),
  strict.safeExtend({ quantity }).strict(),
]);
export const remoteShoppingListSchema = shoppingListSchema
  .safeExtend({
    items: z.array(item).max(shoppingListPolicy.maximumItems),
  })
  .strict();

export const shoppingListSyncOperationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("save"), item }).strict(),
  z.object({ type: z.literal("remove"), id: z.uuid() }).strict(),
]);
export const shoppingListSyncRequestSchema = z
  .object({
    expectedRevision: shoppingListRevisionSchema,
    operation: shoppingListSyncOperationSchema,
  })
  .strict();
export const remoteShoppingListStateSchema = z
  .object({
    revision: shoppingListRevisionSchema,
    list: remoteShoppingListSchema,
  })
  .strict()
  .refine(
    (state) => state.revision !== 0 || state.list.items.length === 0,
    "Revision zero means absence",
  );
export const shoppingListRevisionConflictSchema = z
  .object({
    error: z.literal("revision_conflict"),
    current: remoteShoppingListStateSchema,
  })
  .strict();

export type ShoppingListSyncOperation = z.infer<typeof shoppingListSyncOperationSchema>;
export type ShoppingListSyncRequest = z.infer<typeof shoppingListSyncRequestSchema>;
export type RemoteShoppingListState = z.infer<typeof remoteShoppingListStateSchema>;
