import { MutationObserver } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type { ShoppingSession } from "./shopping-list/session";
import { withinRequestBudget } from "./request-budget";
import { publicRequestPolicy } from "./public-request-policy";

const messages = {
  cancelled: "Eliminación cancelada antes de enviarse.",
  expired: "Tu sesión ya no está disponible. Inicia sesión de nuevo y abre otra confirmación.",
  reauthenticate:
    "Por seguridad, cierra sesión e inicia sesión nuevamente antes de eliminar tu cuenta.",
  changed: "La cuenta o sesión cambió. Abre otra confirmación desde tu cuenta actual.",
  rejected: "No se autorizó la eliminación. Tu cuenta no se eliminó con esta solicitud.",
  uncertain:
    "No pudimos confirmar la eliminación. Puede haberse completado. No repetiremos la solicitud automáticamente. Comprobar la sesión no confirma por sí solo que la cuenta se haya eliminado.",
};

export class AccountDeletionError extends Error {
  constructor(readonly code: keyof typeof messages) {
    super(messages[code]);
  }
}

export async function deleteOwnAccount({
  queryClient,
  session,
  signal,
  request = fetch,
  budgetMs = publicRequestPolicy.browserMs,
}: {
  queryClient: QueryClient;
  session: Extract<ShoppingSession, { status: "authenticated" }>;
  signal: AbortSignal;
  request?: typeof fetch;
  budgetMs?: number;
}): Promise<void> {
  let dispatched = false;
  const mutation = new MutationObserver(queryClient, {
    mutationKey: ["account-delete", session.userId, session.sessionId],
    retry: false,
    gcTime: 0,
    networkMode: "always",
    mutationFn: () =>
      withinRequestBudget(budgetMs, signal, async (requestSignal) => {
        requestSignal.throwIfAborted();
        dispatched = true;
        const response = await request("/api/auth/delete-user", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          signal: requestSignal,
          headers: {
            "Content-Type": "application/json",
            "x-comprafino-confirm-delete": "delete-own-account",
            "x-comprafino-delete-owner": session.userId,
            "x-comprafino-delete-session": session.sessionId,
          },
          body: "{}",
        });
        requestSignal.throwIfAborted();
        if (response.status === 401) throw new AccountDeletionError("expired");
        if (response.status === 409) throw new AccountDeletionError("changed");
        const body: unknown = await response.json();
        requestSignal.throwIfAborted();
        if (
          response.status === 400 &&
          typeof body === "object" &&
          body &&
          "code" in body &&
          body.code === "SESSION_EXPIRED"
        ) {
          throw new AccountDeletionError("reauthenticate");
        }
        if ([400, 403, 405, 408, 413, 415, 429].includes(response.status)) {
          throw new AccountDeletionError("rejected");
        }
        if (
          !response.ok ||
          typeof body !== "object" ||
          !body ||
          !("success" in body) ||
          body.success !== true ||
          !("message" in body) ||
          body.message !== "User deleted"
        ) {
          throw new AccountDeletionError("uncertain");
        }
      }),
  });
  try {
    await mutation.mutate();
    signal.throwIfAborted();
  } catch (error) {
    if (error instanceof AccountDeletionError) throw error;
    throw new AccountDeletionError(dispatched ? "uncertain" : "cancelled");
  } finally {
    mutation.reset();
  }
}
