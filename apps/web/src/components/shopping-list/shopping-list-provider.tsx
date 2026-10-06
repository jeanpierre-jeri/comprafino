"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useStore } from "zustand";
import { authClient } from "../../lib/auth-client";
import { ShoppingListSyncClient } from "../../lib/shopping-list/sync-client";
import { hasKnownShoppingAccount, resolveShoppingSession } from "../../lib/shopping-list/session";
import {
  readShoppingStorage,
  writeShoppingStorage,
  shoppingStorageKey,
  claimShoppingImport,
  clearShoppingImport,
} from "../../lib/shopping-list/repository";

const ShoppingContext = createContext<ShoppingListSyncClient | null>(null);

const syncSignalKey = "comprafino-shopping-list-sync";

function createShoppingClient() {
  return new ShoppingListSyncClient(
    {
      read: readShoppingStorage,
      write: writeShoppingStorage,
      claim: claimShoppingImport,
      clear: clearShoppingImport,
    },
    (...args) => fetch(...args),
    () => {
      try {
        window.localStorage.setItem(syncSignalKey, crypto.randomUUID());
      } catch {
        // Focus/visibility refresh remains available when signal storage is blocked.
      }
    },
  );
}

function ShoppingListSessionBridge({ client }: { client: ShoppingListSyncClient }) {
  const auth = authClient.useSession();
  const accountKnown = useStore(client.store, (state) => hasKnownShoppingAccount(state.session));
  const session = resolveShoppingSession(auth, accountKnown);

  useEffect(() => {
    function storageChanged(event: StorageEvent) {
      if (event.key === shoppingStorageKey || event.key === syncSignalKey || event.key === null) {
        client.storageChanged();
      }
    }

    function refreshVisibleList() {
      if (!document.hidden) {
        void client.refreshRemote();
      }
    }

    window.addEventListener("storage", storageChanged);
    window.addEventListener("focus", refreshVisibleList);
    document.addEventListener("visibilitychange", refreshVisibleList);

    return () => {
      window.removeEventListener("storage", storageChanged);
      window.removeEventListener("focus", refreshVisibleList);
      document.removeEventListener("visibilitychange", refreshVisibleList);
      client.dispose();
    };
  }, [client]);

  useEffect(() => {
    client.setSession(session);
  }, [client, session]);

  return null;
}

export function ShoppingListProvider({ children }: { children: ReactNode }) {
  // One instance per provider/request; nothing mutable is shared by server renders.
  const [client] = useState(createShoppingClient);

  return (
    <QueryClientProvider client={client.queryClient}>
      <ShoppingContext value={client}>
        <ShoppingListSessionBridge client={client} />
        {children}
      </ShoppingContext>
    </QueryClientProvider>
  );
}

export function useShoppingClient() {
  const context = useContext(ShoppingContext);

  if (!context) {
    throw new Error("Shopping-list components require ShoppingListProvider.");
  }

  return context;
}
