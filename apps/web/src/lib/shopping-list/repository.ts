import { emptyShoppingList, parseShoppingList, serializeShoppingList } from "@comprafino/core";
import type { ShoppingList } from "@comprafino/core";

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

const importOwnerKey = "comprafino-shopping-list-import-owner";

// A pending import stays attached to its first account across navigation/reload.
export function claimShoppingImport(owner: string): boolean {
  try {
    const current = window.localStorage.getItem(importOwnerKey);

    if (current && current !== owner) return false;

    window.localStorage.setItem(importOwnerKey, owner);

    return window.localStorage.getItem(importOwnerKey) === owner;
  } catch {
    return false;
  }
}

export function clearShoppingImport(imported: ShoppingList, owner: string): boolean {
  try {
    if (window.localStorage.getItem(importOwnerKey) !== owner) return false;

    const current = readShoppingStorage();

    if (
      current.warning ||
      serializeShoppingList(current.list) !== serializeShoppingList(imported)
    ) {
      return false;
    }

    window.localStorage.removeItem(shoppingStorageKey);
    window.localStorage.removeItem(importOwnerKey);

    return true;
  } catch {
    return false;
  }
}
