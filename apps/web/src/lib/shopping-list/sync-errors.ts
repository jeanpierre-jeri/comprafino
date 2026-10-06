const syncMessages = {
  unavailable: "No pudimos sincronizar tu lista. Intenta nuevamente.",
  expired: "Tu sesión ya no está disponible. Inicia sesión nuevamente para sincronizar.",
  conflict: "Tu lista cambió en otra pestaña o dispositivo. Intenta nuevamente.",
  busy: "Espera a que termine la sincronización de tu lista.",
  accountChanged: "La cuenta cambió. Vuelve a abrir el editor.",
  invalidMutation: "Guarda o elimina una necesidad a la vez.",
} as const;

type SyncFailureCode = keyof typeof syncMessages;

export class ShoppingListSyncError extends Error {
  constructor(
    readonly code: SyncFailureCode,
    options?: ErrorOptions,
  ) {
    super(syncMessages[code], options);
  }
}

export function shoppingSyncFailure(error: unknown, expired: boolean): ShoppingListSyncError {
  if (expired) return new ShoppingListSyncError("expired", { cause: error });

  if (error instanceof ShoppingListSyncError) return error;

  return new ShoppingListSyncError("unavailable", { cause: error });
}
