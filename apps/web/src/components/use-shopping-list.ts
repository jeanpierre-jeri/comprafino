"use client";
import { useEffect, useState } from "react";
import { emptyShoppingList } from "@comprafino/core";
import type { ShoppingList } from "@comprafino/core";
import {
  readShoppingStorage,
  shoppingStorageKey,
  writeShoppingStorage,
} from "../lib/shopping-list-repository";

// Module state preserves the session fallback across client navigation when
// browser storage is blocked. Effects subscribe only after hydration.
let sessionList: ShoppingList = emptyShoppingList();
let sessionWarning = "";
let loaded = false;
const listeners = new Set<() => void>();
function notify() {
  for (const listener of listeners) listener();
}
export function useShoppingList() {
  const [list, setList] = useState<ShoppingList>(emptyShoppingList);
  const [warning, setWarning] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!loaded) {
      const stored = readShoppingStorage(sessionList);
      sessionList = stored.list;
      sessionWarning = stored.warning;
      loaded = true;
    }
    const update = () => {
      setList(sessionList);
      setWarning(sessionWarning);
      setReady(true);
    };
    const storage = (event: StorageEvent) => {
      if (event.key !== shoppingStorageKey && event.key !== null) return;
      const stored = readShoppingStorage(sessionList);
      sessionList = stored.list;
      sessionWarning = stored.warning;
      notify();
    };
    listeners.add(update);
    window.addEventListener("storage", storage);
    update();
    return () => {
      listeners.delete(update);
      window.removeEventListener("storage", storage);
    };
  }, []);
  function change(next: (current: ShoppingList) => ShoppingList) {
    // Read latest persisted state before mutation to reduce cross-tab lost writes.
    let readWarning = "";
    if (!sessionWarning) {
      const stored = readShoppingStorage(sessionList);
      sessionList = stored.list;
      readWarning = stored.warning;
    }
    sessionList = next(sessionList);
    sessionWarning = writeShoppingStorage(sessionList) || readWarning;
    notify();
  }
  return { list, warning, ready, change };
}
