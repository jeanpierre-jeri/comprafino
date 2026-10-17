const syncMessages = {
  unavailable: "No pudimos sincronizar tu lista. Intenta nuevamente.",
  uncertain:
    "No pudimos confirmar si el cambio se guardó. Vuelve a consultar la lista antes de editar; no repetimos el cambio automáticamente.",
  expired: "Tu sesión ya no está disponible. Inicia sesión nuevamente para sincronizar.",
  conflict: "Tu lista cambió en otra pestaña o dispositivo. Intenta nuevamente.",
  busy: "Espera a que termine la sincronización de tu lista.",
  accountChanged: "La cuenta cambió. Vuelve a abrir el editor.",
  importChanged:
    "La copia local o su cuenta de origen cambió. Cierra esta ventana y vuelve a revisar la recuperación.",
  importStorage:
    "No podemos confirmar la copia local. Revisa los permisos y el espacio del navegador antes de reintentar.",
  importCoordination:
    "Este navegador no permite coordinar la copia entre pestañas. Puedes descargarla; la importación y el descarte siguen bloqueados.",
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
