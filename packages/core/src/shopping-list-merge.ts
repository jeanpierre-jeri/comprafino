import { emptyShoppingList, saveShoppingItem, shoppingItemKey } from "./shopping-list.ts";
import type { ShoppingList, ShoppingListItem } from "./shopping-list.ts";

/** Normalize through the same writer as persistence before comparing identity. */
export function shoppingImportOperation(remote: ShoppingList, raw: ShoppingListItem) {
  const item = saveShoppingItem(emptyShoppingList(), raw).items[0]!;
  const existing =
    remote.items.find((i) => i.id === item.id) ??
    remote.items.find((i) => shoppingItemKey(i) === shoppingItemKey(item));

  // Remote wins ties; amounts are never summed. Save preserves remote ID/createdAt.
  if (existing && Date.parse(existing.updatedAt) >= Date.parse(item.updatedAt)) return null;

  const next = saveShoppingItem(remote, item);
  // Capacity/colliding identities fail closed.
  return {
    type: "save" as const,
    item: next.items.find((i) => i.id === (existing?.id ?? item.id))!,
  };
}

/** Remote order first, then anonymous order. Rejected items stay available for retry. */
export function planShoppingImport(remote: ShoppingList, anonymous: ShoppingList) {
  let list = remote;
  const operations = [];
  const rejected: ShoppingListItem[] = [];

  for (const item of anonymous.items) {
    try {
      const operation = shoppingImportOperation(list, item);

      if (operation) {
        operations.push(operation);
        list = saveShoppingItem(list, operation.item);
      }
    } catch {
      rejected.push(item);
    }
  }

  return { list, operations, rejected };
}
