import { remoteShoppingListSchema, serializeShoppingList } from "@comprafino/core";
import type { QueryClient } from "@tanstack/react-query";
import type { ShoppingSession } from "./session";
import { shoppingSessionQueryKey } from "./query-client";
import { withinRequestBudget } from "../request-budget";
import { publicRequestPolicy } from "../public-request-policy";

const messages = {
  expired: "Tu sesión venció o fue cerrada. Inicia sesión nuevamente para descargar tu lista.",
  changed: "La cuenta o sesión cambió. Vuelve a descargar desde tu cuenta actual.",
  unavailable: "No pudimos descargar tu lista. Intenta nuevamente.",
};

export class AccountListExportError extends Error {
  constructor(readonly code: keyof typeof messages) {
    super(messages[code]);
  }
}

function exportIdentity(value: unknown) {
  if (value === null) return null;
  if (
    typeof value !== "object" ||
    !value ||
    !("user" in value) ||
    typeof value.user !== "object" ||
    !value.user ||
    !("id" in value.user) ||
    typeof value.user.id !== "string" ||
    !("session" in value) ||
    typeof value.session !== "object" ||
    !value.session ||
    !("id" in value.session) ||
    typeof value.session.id !== "string"
  ) {
    throw new AccountListExportError("unavailable");
  }
  return { userId: value.user.id, sessionId: value.session.id };
}

export async function exportAccountList({
  queryClient,
  session,
  signal,
  download,
  request = fetch,
  budgetMs = publicRequestPolicy.browserMs,
}: {
  queryClient: QueryClient;
  session: Extract<ShoppingSession, { status: "authenticated" }>;
  signal: AbortSignal;
  download: (document: string) => void;
  request?: typeof fetch;
  budgetMs?: number;
}): Promise<"downloaded" | "empty"> {
  const queryKey = ["shopping-export", ...shoppingSessionQueryKey(session)];
  try {
    const document = await queryClient.fetchQuery({
      queryKey,
      staleTime: 0,
      gcTime: 0,
      retry: false,
      queryFn: ({ signal: querySignal }) =>
        withinRequestBudget(
          budgetMs,
          AbortSignal.any([signal, querySignal]),
          async (requestSignal) => {
            const response = await request("/api/list/export", {
              headers: { "x-comprafino-export-session": session.sessionId },
              credentials: "same-origin",
              cache: "no-store",
              signal: requestSignal,
            });
            requestSignal.throwIfAborted();
            if (response.status === 401) throw new AccountListExportError("expired");
            if (response.status === 409) throw new AccountListExportError("changed");
            if (!response.ok) throw new AccountListExportError("unavailable");
            const list = remoteShoppingListSchema.parse(await response.json());
            requestSignal.throwIfAborted();

            // A delayed response may belong to a session since replaced in another
            // tab. Revalidate the cookie before releasing any document to the UI.
            const checked = await request("/api/auth/get-session?disableCookieCache=true", {
              credentials: "same-origin",
              cache: "no-store",
              signal: requestSignal,
            });
            if (checked.status === 401) throw new AccountListExportError("expired");
            if (!checked.ok) throw new AccountListExportError("unavailable");
            const identity = exportIdentity(await checked.json());
            requestSignal.throwIfAborted();
            if (!identity) throw new AccountListExportError("expired");
            if (identity.userId !== session.userId || identity.sessionId !== session.sessionId) {
              throw new AccountListExportError("changed");
            }
            return list.items.length ? serializeShoppingList(list) : null;
          },
        ),
    });
    signal.throwIfAborted();
    // No await between the final cancellation check and the browser download.
    if (document !== null) download(document);
    return document === null ? "empty" : "downloaded";
  } catch (error) {
    if (error instanceof AccountListExportError) throw error;
    throw new AccountListExportError("unavailable");
  } finally {
    queryClient.removeQueries({ queryKey, exact: true });
  }
}
