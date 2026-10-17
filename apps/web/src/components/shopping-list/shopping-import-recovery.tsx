"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "@comprafino/ui/components/button";
import { Alert, AlertDescription, AlertTitle } from "@comprafino/ui/components/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@comprafino/ui/components/dialog";
import type { ShoppingImportRecovery as Recovery } from "../../lib/shopping-list/sync-client";
import { ShoppingListSyncError } from "../../lib/shopping-list/sync-errors";
import { downloadShoppingList } from "../../lib/shopping-list/download";
import { useShoppingList } from "./use-shopping-list";

export function ShoppingImportRecovery() {
  const shopping = useShoppingList();
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (confirming) cancel.current?.focus();
  }, [confirming]);

  async function act(action: () => Promise<void>) {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await action();
    } catch (failure) {
      setError(
        failure instanceof ShoppingListSyncError
          ? failure.message
          : "No pudimos completar la acción. Conserva esta copia e intenta nuevamente.",
      );
    } finally {
      setPending(false);
    }
  }

  async function download() {
    if (!recovery) return;
    const document = await shopping.exportPendingImport(recovery);
    downloadShoppingList(document, "comprafino-lista-local.json");
  }

  if (!shopping.importIssue && !recovery) return null;

  const otherAccount =
    recovery?.snapshot.owner &&
    shopping.session.status === "authenticated" &&
    recovery.snapshot.owner !== shopping.session.userId;
  const blocked = pending || shopping.busy;

  return (
    <>
      {shopping.importIssue && (
        <Alert className="mt-4">
          <AlertTitle>Copia local conservada</AlertTitle>
          <AlertDescription>
            Puedes conservarla, descargar una copia o revisar cómo descartarla. No se moverá a otra
            cuenta automáticamente.
          </AlertDescription>
          <Button
            ref={trigger}
            variant="outline"
            className="min-h-11 w-fit"
            disabled={blocked}
            onClick={() => {
              setError("");
              try {
                setRecovery(shopping.prepareImportRecovery());
                setConfirming(false);
                setOpen(true);
              } catch (failure) {
                setError(
                  failure instanceof ShoppingListSyncError
                    ? failure.message
                    : "No pudimos leer la copia local.",
                );
              }
            }}
          >
            Revisar copia local
          </Button>
          {!recovery && error && <p role="alert">{error}</p>}
        </Alert>
      )}
      {recovery && (
        <Dialog
          open={open}
          onOpenChange={(next) => {
            if (!pending) setOpen(next);
          }}
          onOpenChangeComplete={(next) => {
            if (!next) setRecovery(null);
          }}
        >
          <DialogContent
            role={confirming ? "alertdialog" : "dialog"}
            className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
            initialFocus={cancel}
            finalFocus={() =>
              trigger.current ?? window.document.getElementById("shopping-list-heading")
            }
            showCloseButton={!pending}
          >
            <DialogTitle className="pr-12">
              {confirming ? "¿Descartar la copia local?" : "Recuperar la copia local"}
            </DialogTitle>
            <DialogDescription>
              Esta copia contiene {recovery.snapshot.list.items.length} productos. Solo corresponde
              a este navegador; no es una exportación de tu cuenta.
            </DialogDescription>
            {confirming ? (
              <>
                <p>
                  Se eliminará esta copia del navegador. No se borrará lo que ya esté guardado en
                  ninguna cuenta. Descárgala antes si quieres conservarla.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    ref={cancel}
                    variant="outline"
                    className="min-h-11"
                    disabled={blocked}
                    onClick={() => {
                      setConfirming(false);
                      setError("");
                    }}
                  >
                    Conservar copia
                  </Button>
                  <Button
                    variant="destructive"
                    className="min-h-11"
                    disabled={blocked || !shopping.ready}
                    onClick={() =>
                      void act(async () => {
                        await shopping.discardPendingImport(recovery);
                        setOpen(false);
                      })
                    }
                  >
                    Confirmar descarte local
                  </Button>
                </div>
              </>
            ) : (
              <>
                {!shopping.ready && (
                  <p>
                    Puedes descargar la copia. Para descartarla, primero vuelve a consultar tu
                    cuenta y confirma el estado de la sincronización.
                  </p>
                )}
                <p>
                  Conservarla no cambia nada. Si vuelves a la cuenta que inició la importación,
                  podrás reintentarlo desde allí.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    className="min-h-11"
                    disabled={blocked}
                    onClick={() => void act(download)}
                  >
                    Descargar copia local
                  </Button>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    disabled={blocked || !shopping.ready || shopping.importIssue === "coordination"}
                    onClick={() => {
                      setConfirming(true);
                      setError("");
                    }}
                  >
                    Descartar copia local…
                  </Button>
                </div>
                {otherAccount && (
                  <Button
                    variant="outline"
                    className="min-h-11 h-auto whitespace-normal"
                    disabled={blocked}
                    onClick={() =>
                      void act(async () => {
                        await shopping.returnToImportAccount(recovery);
                      })
                    }
                  >
                    Cerrar sesión para volver a la cuenta original
                  </Button>
                )}
                <Button
                  ref={cancel}
                  variant="secondary"
                  className="min-h-11"
                  disabled={pending}
                  onClick={() => setOpen(false)}
                >
                  Conservar copia y cerrar
                </Button>
              </>
            )}
            {pending && <output>Procesando…</output>}
            {error && <p role="alert">{error}</p>}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
