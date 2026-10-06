"use client";

import { useId, useRef, useState } from "react";
import { Button, ChevronDown, LoaderCircle, LogOut } from "@comprafino/ui";
import { Avatar, AvatarImage, AvatarFallback } from "@comprafino/ui/components/avatar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from "@comprafino/ui/components/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@comprafino/ui/components/dialog";
import { Skeleton } from "@comprafino/ui/components/skeleton";
import { toast } from "@comprafino/ui/components/toast";
import { accountInitials, avatarUrl } from "../lib/account-identity";
import { authClient } from "../lib/auth-client";
import { GoogleMark } from "./google-mark";

type SessionUser = NonNullable<ReturnType<typeof authClient.useSession>["data"]>["user"];

function LoginDialog({ onClose }: { onClose: () => void }) {
  const title = useId();
  const [open, setOpen] = useState(true);
  const google = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);

  async function signIn() {
    if (inFlight.current) return;

    inFlight.current = true;
    setPending(true);
    setFailed(false);

    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: window.location.href,
      });

      if (!result.error) return; // Keep loading until the successful redirect leaves the page.
    } catch {
      // Both transport and API failures remain retryable inside this dialog.
    }

    inFlight.current = false;
    setPending(false);
    setFailed(true);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <DialogContent className="auth-dialog gap-0" initialFocus={google}>
        <DialogTitle id={title} className="pr-8">
          Inicia sesión en CompraFino
        </DialogTitle>
        <p className="mt-1 text-base leading-relaxed">
          Guarda tu lista y tenla disponible en tus dispositivos.
        </p>
        <DialogDescription className="mt-2 leading-relaxed">
          Al iniciar sesión, combinaremos la lista de este navegador con la de tu cuenta.
          Conservaremos la versión más reciente de cada necesidad.
        </DialogDescription>
        <Button
          variant="outline"
          className="mt-6 h-12 w-full gap-3 bg-surface"
          disabled={pending}
          aria-busy={pending}
          ref={google}
          onClick={() => void signIn()}
        >
          {pending ? (
            <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
          ) : (
            <GoogleMark />
          )}
          {pending ? "Conectando con Google…" : "Continuar con Google"}
        </Button>
        {failed && (
          <p
            role="alert"
            className="mt-3 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm leading-relaxed text-destructive"
          >
            No pudimos iniciar sesión con Google. Intenta nuevamente.
          </p>
        )}
        <p className="mt-5 text-center text-sm leading-relaxed text-muted-foreground">
          También puedes seguir usando CompraFino sin una cuenta.
        </p>
      </DialogContent>
    </Dialog>
  );
}

export function AuthControl() {
  const { data, isPending, error: sessionError } = authClient.useSession();
  const [loginOpen, setLoginOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [retainedUser, setRetainedUser] = useState<SessionUser | null>(null);
  const inFlight = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const user = retainedUser ?? data?.user;

  async function signOut() {
    if (inFlight.current || !user) return;

    inFlight.current = true;
    setRetainedUser(user);
    setLoggingOut(true);

    try {
      const result = await authClient.signOut();

      if (result.error) {
        throw new Error("Sign-out failed");
      }

      setMenuOpen(false);
      setRetainedUser(null);
    } catch {
      toast.add({ type: "error", title: "No pudimos cerrar sesión. Intenta nuevamente." });
    } finally {
      inFlight.current = false;
      setLoggingOut(false);
      setRetainedUser(null);
    }
  }

  if (isPending && !user) {
    return (
      <output aria-label="Cargando sesión">
        <Skeleton className="h-11 w-32 rounded-lg" />
      </output>
    );
  }

  return (
    <div className="shrink-0">
      {user ? (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
          <DropdownMenuTrigger
            render={<Button variant="ghost" className="h-11 max-w-44 gap-2 px-2" />}
            aria-label={`Cuenta de ${user.name.trim() || user.email}`}
          >
            <Avatar aria-hidden="true">
              {avatarUrl(user.image) && (
                <AvatarImage
                  src={avatarUrl(user.image)}
                  alt=""
                  width={32}
                  height={32}
                  referrerPolicy="no-referrer"
                />
              )}
              <AvatarFallback>{accountInitials(user.name, user.email)}</AvatarFallback>
            </Avatar>
            <span className="max-w-20 truncate text-sm">
              {user.name.trim().split(/\s+/u)[0] || "Mi cuenta"}
            </span>
            <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={8}
            className="w-64 max-w-[calc(100vw-1.5rem)]"
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="px-3 py-3">
                <p className="text-sm font-semibold wrap-anywhere">
                  {user.name.trim() || "Mi cuenta"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground wrap-anywhere">{user.email}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                closeOnClick={false}
                disabled={loggingOut}
                onClick={() => void signOut()}
                className="min-h-11 gap-2 px-3"
              >
                {loggingOut ? (
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <LogOut className="size-4" aria-hidden="true" />
                )}
                {loggingOut ? "Cerrando sesión…" : "Cerrar sesión"}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button
          ref={trigger}
          variant="outline"
          className="h-11 px-3"
          disabled={Boolean(sessionError)}
          title={sessionError ? "Inicio de sesión no disponible" : undefined}
          onClick={() => setLoginOpen(true)}
        >
          Iniciar sesión
        </Button>
      )}
      {loginOpen && (
        <LoginDialog
          onClose={() => {
            setLoginOpen(false);
            trigger.current?.focus();
          }}
        />
      )}
    </div>
  );
}
