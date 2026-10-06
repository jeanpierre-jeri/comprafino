"use client";

import { useState } from "react";
import { authClient } from "../lib/auth-client";

export function AuthControl() {
  const { data, isPending, error: sessionError } = authClient.useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function act() {
    setBusy(true);
    setError(false);
    try {
      const result = data
        ? await authClient.signOut()
        : await authClient.signIn.social({ provider: "google", callbackURL: window.location.href });
      setError(Boolean(result.error));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {data && (
        <span className="max-w-32 truncate text-muted-foreground" title={data.user.email}>
          {data.user.name.trim().split(/\s+/u)[0] || data.user.email}
        </span>
      )}
      <button
        type="button"
        className="font-medium text-primary disabled:opacity-50"
        disabled={isPending || busy || Boolean(sessionError)}
        title={sessionError ? "Inicio de sesión no disponible" : undefined}
        onClick={() => void act()}
      >
        {data ? "Cerrar sesión" : "Iniciar sesión"}
      </button>
      {error && <span role="alert">No pudimos completar la acción. Intenta nuevamente.</span>}
    </div>
  );
}
