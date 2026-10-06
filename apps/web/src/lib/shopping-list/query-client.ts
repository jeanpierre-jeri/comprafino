import { QueryClient } from "@tanstack/react-query";
import type { ShoppingSession } from "./session";

export function createShoppingQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        networkMode: "always",
        staleTime: 0,
        gcTime: Infinity,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: { retry: false, networkMode: "always", gcTime: 0 },
    },
  });
}

export function shoppingSessionQueryKey(session: ShoppingSession) {
  if (session.status === "authenticated") {
    return [session.status, session.userId, session.sessionId] as const;
  }
  return [session.status] as const;
}

export function remoteShoppingQueryKey(session: ShoppingSession) {
  return ["shopping-list", ...shoppingSessionQueryKey(session)] as const;
}
