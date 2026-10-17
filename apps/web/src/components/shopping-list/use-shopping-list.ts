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
import type { ShoppingImportRecovery } from "../../lib/shopping-list/sync-client";
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

  if (client.isAccountSessionWithheld(session)) {
    warning =
      "Esta sesión se pausó tras solicitar la eliminación. Comprueba la sesión; si la cuenta sigue disponible, vuelve a iniciar sesión antes de usar su lista.";
  } else if (session.status === "unavailable") {
    warning = "No pudimos comprobar tu sesión. Intenta nuevamente.";
  } else if (current) {
    warning = snapshot.warning;
  }

  return {
    // Withhold the old account during render, before the bridge invalidates requests.
    list,
    warning,
    importIssue: current ? snapshot.importIssue : null,
    prepareImportRecovery: () => client.prepareImportRecovery(session),
    exportPendingImport: (recovery: ShoppingImportRecovery) => {
      client.assertImportRecovery(recovery, session);
      return client.exportPendingImport(recovery);
    },
    discardPendingImport: (recovery: ShoppingImportRecovery) => {
      client.assertImportRecovery(recovery, session);
      return client.discardPendingImport(recovery);
    },
    returnToImportAccount: async (recovery: ShoppingImportRecovery) => {
      client.assertImportRecovery(recovery, session);
      const result = await authClient.signOut();
      if (result.error) {
        throw new Error(
          "No pudimos cerrar sesión. Conservamos la copia local; intenta nuevamente.",
        );
      }
    },
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
