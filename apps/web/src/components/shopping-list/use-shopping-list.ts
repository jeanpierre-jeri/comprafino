"use client";

import { skipToken, useQuery } from "@tanstack/react-query";
import { remoteShoppingQueryKey } from "../../lib/shopping-list/query-client";
import { useStore } from "zustand";
import { emptyShoppingList } from "@comprafino/core";
import type { ShoppingList, RemoteShoppingListState } from "@comprafino/core";
import { authClient } from "../../lib/auth-client";
import {
  hasKnownShoppingAccount,
  resolveShoppingSession,
  sameShoppingSession,
} from "../../lib/shopping-list/session";
import { useShoppingClient } from "./shopping-list-provider";

export function useShoppingList() {
  const client = useShoppingClient();
  const auth = authClient.useSession();
  const snapshot = useStore(client.store, (state) => state);
  const session = resolveShoppingSession(auth, hasKnownShoppingAccount(snapshot.session));
  const current = sameShoppingSession(session, snapshot.session);
  // The coordinator explicitly sequences reads/imports/replays; Query owns the remote document.
  const remote = useQuery<RemoteShoppingListState>({
    queryKey: remoteShoppingQueryKey(session),
    queryFn: skipToken,
    enabled: false,
  });
  let list = emptyShoppingList();
  if (current && session.status === "anonymous") {
    list = snapshot.anonymousList;
  } else if (current && snapshot.ready) {
    list = remote.data?.list ?? list;
  }

  let warning = "";

  if (session.status === "unavailable") {
    warning = "No pudimos comprobar tu sesión. Intenta nuevamente.";
  } else if (current) {
    warning = snapshot.warning;
  }

  return {
    // Withhold the old account during render, before the bridge invalidates requests.
    list,
    warning,
    ready: current && snapshot.ready,
    busy: !current || snapshot.busy,
    authenticated: session.status === "authenticated",
    session,
    change: (next: (list: ShoppingList) => ShoppingList) => {
      client.setSession(session);

      return client.change(next);
    },
    retry: () => {
      void auth.refetch();
      void client.importAnonymous();
    },
  };
}
