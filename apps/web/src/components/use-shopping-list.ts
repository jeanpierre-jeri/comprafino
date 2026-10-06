"use client";
import { useEffect, useState } from "react";
import { emptyShoppingList } from "@comprafino/core";
import type { ShoppingList } from "@comprafino/core";
import { authClient } from "../lib/auth-client";
import {
  readShoppingStorage,
  shoppingStorageKey,
  writeShoppingStorage,
  claimShoppingImport,
  clearShoppingImport,
} from "../lib/shopping-list-repository";
import { ShoppingListSyncClient } from "../lib/shopping-list-sync-client";

const syncSignal = "comprafino-shopping-list-sync";
const client = new ShoppingListSyncClient(
  {
    read: readShoppingStorage,
    write: writeShoppingStorage,
    claim: claimShoppingImport,
    clear: clearShoppingImport,
  },
  (...args) => fetch(...args),
  () => {
    try {
      window.localStorage.setItem(syncSignal, crypto.randomUUID());
    } catch {
      /* Focus/visibility refresh still works when storage is blocked. */
    }
  },
);
let subscriptions = 0;
function storage(event: StorageEvent) {
  if (event.key === shoppingStorageKey || event.key === syncSignal || event.key === null)
    client.storageChanged();
}
function refresh() {
  if (!document.hidden) void client.refresh(false);
}
export function useShoppingList() {
  const session = authClient.useSession();
  const [snapshot, setSnapshot] = useState(client.getSnapshot);
  // Session identity, not only user identity: old-session responses cannot commit.
  const key = session.data
    ? `${session.data.user.id}:${session.data.session.id}`
    : session.isPending || (session.error && snapshot.accountKnown)
      ? undefined
      : null;
  useEffect(() => {
    const update = () => setSnapshot(client.getSnapshot());
    const unsubscribe = client.subscribe(update);
    if (subscriptions++ === 0) {
      window.addEventListener("storage", storage);
      window.addEventListener("focus", refresh);
      document.addEventListener("visibilitychange", refresh);
    }
    update();
    return () => {
      unsubscribe();
      if (--subscriptions === 0) {
        window.removeEventListener("storage", storage);
        window.removeEventListener("focus", refresh);
        document.removeEventListener("visibilitychange", refresh);
      }
    };
  }, []);
  useEffect(() => {
    client.setSession(key);
  }, [key]);
  // Hide a previous identity's data during render, before effects invalidate requests.
  const current = key === snapshot.key;
  return {
    list: current ? snapshot.list : emptyShoppingList(),
    warning:
      session.error && key !== null
        ? "No pudimos comprobar tu sesión. Intenta nuevamente."
        : current
          ? snapshot.warning
          : "",
    ready: current && snapshot.ready,
    busy: !current || snapshot.busy,
    authenticated: Boolean(key),
    accountKey: key,
    change: (next: (list: ShoppingList) => ShoppingList) => {
      client.setSession(key);
      return client.change(next);
    },
    retry: () => {
      void session.refetch();
      void client.refresh();
    },
  };
}
