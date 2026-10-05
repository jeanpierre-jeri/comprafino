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
