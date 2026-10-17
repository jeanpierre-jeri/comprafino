import { emptyShoppingList, parseShoppingList, serializeShoppingList } from "@comprafino/core";
import type { ShoppingList } from "@comprafino/core";
import { publicRequestPolicy } from "../public-request-policy";

export const shoppingStorageKey = "comprafino-shopping-list";

export function readShoppingStorage(fallback: ShoppingList = emptyShoppingList()) {
  if (typeof window === "undefined") return { list: emptyShoppingList(), warning: "" };

  try {
    const parsed = parseShoppingList(window.localStorage.getItem(shoppingStorageKey));

    return {
      list: parsed.list,
      warning: parsed.invalid ? "La lista guardada no es compatible. Puedes crear una nueva." : "",
    };
  } catch {
    return {
      list: fallback,
      warning: "No podemos guardar en este navegador. Tu lista durará esta sesión.",
    };
  }
}

export function writeShoppingStorage(list: ShoppingList): string {
  try {
    window.localStorage.setItem(shoppingStorageKey, serializeShoppingList(list));

    return "";
  } catch {
    return "No podemos guardar en este navegador. Tu lista durará esta sesión.";
  }
}

export const importOwnerKey = "comprafino-shopping-list-import-owner";

// A pending import stays attached to its first account across navigation/reload.
export function claimShoppingImport(owner: string): "claimed" | "other-account" | "unavailable" {
  try {
    const current = window.localStorage.getItem(importOwnerKey);

    if (current && current !== owner) return "other-account";

    window.localStorage.setItem(importOwnerKey, owner);

    return window.localStorage.getItem(importOwnerKey) === owner ? "claimed" : "other-account";
  } catch {
    return "unavailable";
  }
}

export function clearShoppingImport(
  imported: ShoppingList,
  owner: string,
): "cleared" | "changed" | "unavailable" {
  try {
    if (window.localStorage.getItem(importOwnerKey) !== owner) return "changed";

    const current = inspectShoppingImport();
    if (current.status === "unavailable") return "unavailable";

    if (
      current.status !== "available" ||
      serializeShoppingList(current.snapshot.list) !== serializeShoppingList(imported)
    ) {
      return "changed";
    }

    window.localStorage.removeItem(shoppingStorageKey);
    window.localStorage.removeItem(importOwnerKey);

    return "cleared";
  } catch {
    return "unavailable";
  }
}

export type ShoppingImportSnapshot = {
  list: ShoppingList;
  raw: string;
  owner: string | null;
};

export type ShoppingImportInspection =
  | { status: "available"; snapshot: ShoppingImportSnapshot }
  | { status: "empty" | "unavailable" | "invalid" };

export function inspectShoppingImport(): ShoppingImportInspection {
  try {
    const raw = window.localStorage.getItem(shoppingStorageKey);
    const owner = window.localStorage.getItem(importOwnerKey);
    const parsed = parseShoppingList(raw);
    if (parsed.invalid) return { status: "invalid" };
    if (!raw || !parsed.list.items.length) return { status: "empty" };

    return { status: "available", snapshot: { list: parsed.list, raw, owner } };
  } catch {
    return { status: "unavailable" };
  }
}

// Caller holds the shared storage lock. Compare exact bytes and ownership again
// after confirmation; never remove a newer snapshot or release another claim.
export function discardShoppingImport(
  snapshot: ShoppingImportSnapshot,
): "discarded" | "changed" | "unavailable" {
  try {
    if (
      window.localStorage.getItem(shoppingStorageKey) !== snapshot.raw ||
      window.localStorage.getItem(importOwnerKey) !== snapshot.owner
    ) {
      return "changed";
    }

    // Remove data first: a failed marker removal must not leave unowned data
    // available for a different account to import. Storage is not transactional.
    window.localStorage.removeItem(shoppingStorageKey);
    window.localStorage.removeItem(importOwnerKey);
    return "discarded";
  } catch {
    return "unavailable";
  }
}

export class ShoppingStorageCoordinationError extends Error {}

export async function withShoppingStorageLock<T>(
  action: () => Promise<T> | T,
  signal: AbortSignal,
  required = true,
): Promise<T> {
  const locks = window.navigator.locks;
  if (!locks) {
    if (required) {
      throw new ShoppingStorageCoordinationError();
    }
    signal.throwIfAborted();
    return action();
  }

  // Bound the queue wait using the existing browser budget. Once granted,
  // request() keeps the lock until action settles; each fetch retains its budget.
  const waitSignal = AbortSignal.any([signal, AbortSignal.timeout(publicRequestPolicy.browserMs)]);
  return locks.request("comprafino-shopping-import", { signal: waitSignal }, action);
}
