"use client";

import { useRef, useState } from "react";
import type { RefObject } from "react";
import { Button } from "@comprafino/ui/components/button";
import { toast } from "@comprafino/ui/components/toast";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@comprafino/ui/components/dialog";
import { AccountDeletionError, deleteOwnAccount } from "../lib/account-deletion";
import type { ShoppingSession } from "../lib/shopping-list/session";
import { useShoppingClient } from "./shopping-list/shopping-list-provider";

export type AccountDeletionConfirmation = {
  session: Extract<ShoppingSession, { status: "authenticated" }>;
  email: string;
  controller: AbortController;
};

export function AccountDeletionDialog({
  confirmation,
  exporting,
  download,
  close,
  refreshSession,
  trigger,
}: {
  confirmation: AccountDeletionConfirmation;
  exporting: boolean;
  download: () => Promise<void>;
  close: () => void;
  refreshSession: () => Promise<void>;
  trigger: RefObject<HTMLButtonElement | null>;
}) {
  const shopping = useShoppingClient();
  const cancel = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const [phase, setPhase] = useState<"confirm" | "pending" | "done" | "failed">("confirm");
  const [message, setMessage] = useState("");
  const pending = phase === "pending";

  async function remove() {
    if (inFlight.current || phase !== "confirm" || exporting) return;
    if (confirmation.controller.signal.aborted) return;
    inFlight.current = true;
    // Quarantine the initiating session before any potentially uncertain write.
    // This aborts old list work but never touches anonymous storage or a new user.
    if (!shopping.withholdAccountSession(confirmation.session)) {
      setMessage(new AccountDeletionError("changed").message);
      setPhase("failed");
      return;
    }
    setPhase("pending");
    try {
      await deleteOwnAccount({
        queryClient: shopping.queryClient,
        session: confirmation.session,
        signal: confirmation.controller.signal,
      });
      if (confirmation.controller.signal.aborted) return;
      setMessage("Tu cuenta y su lista guardada se eliminaron. La copia local se conserva.");
      setPhase("done");
      toast.add({
        type: "success",
        title: "Tu cuenta y su lista guardada se eliminaron. La copia local se conserva.",
      });
      void refreshSession();
    } catch (error) {
      if (confirmation.controller.signal.aborted) return;
      setMessage(
        error instanceof AccountDeletionError
          ? error.message
          : new AccountDeletionError("uncertain").message,
      );
      setPhase("failed");
      // A null/failed session read is NEVER promoted to deletion success.
      if (!(error instanceof AccountDeletionError) || error.code === "uncertain") {
        toast.add({ type: "error", title: new AccountDeletionError("uncertain").message });
      }
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !pending) close();
      }}
    >
      <DialogContent
        role="alertdialog"
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
        initialFocus={cancel}
        finalFocus={trigger}
        showCloseButton={!pending}
      >
        <DialogTitle className="pr-8">¿Eliminar tu cuenta?</DialogTitle>
        <DialogDescription>
          Eliminarás la cuenta {confirmation.email}, sus sesiones, vínculos de acceso y lista
          guardada. Esta acción no se puede deshacer. No elimina tu cuenta de Google ni la copia
          local de este navegador.
        </DialogDescription>
        {phase === "confirm" && (
          <>
            <p>Puedes descargar tu lista sincronizada antes de confirmar.</p>
            <Button variant="outline" disabled={exporting} onClick={() => void download()}>
              {exporting ? "Preparando descarga…" : "Descargar lista de cuenta"}
            </Button>
          </>
        )}
        {message && <p role="alert">{message}</p>}
        <div className="flex flex-wrap gap-2">
          <Button ref={cancel} variant="secondary" disabled={pending || exporting} onClick={close}>
            {phase === "confirm" ? "Conservar mi cuenta" : "Cerrar"}
          </Button>
          {phase === "confirm" && (
            <Button variant="destructive" disabled={exporting} onClick={() => void remove()}>
              Eliminar mi cuenta definitivamente
            </Button>
          )}
          {(phase === "failed" || phase === "done") && (
            <Button variant="outline" onClick={() => void refreshSession()}>
              Comprobar sesión
            </Button>
          )}
        </div>
        {pending && (
          <output>Eliminando cuenta… No cierres esta ventana mientras se confirma.</output>
        )}
      </DialogContent>
    </Dialog>
  );
}
