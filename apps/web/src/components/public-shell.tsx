import { NavigationLink } from "./navigation-link";
import { ThemeControl } from "./theme-control";
import { AuthControl } from "./auth-control";
import Link from "next/link";

export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 sm:px-8">
      <a href="#main-content" className="skip-link">
        Saltar al contenido
      </a>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b py-5 sm:py-6">
        <Link href="/" className="wordmark" aria-label="CompraFino, inicio">
          <span>Compra</span>
          <span className="text-primary">
            Fino<span className="wordmark-dot">.</span>
          </span>
        </Link>
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <span className="hidden text-sm text-muted-foreground lg:inline">
            Hecho para comprar en Perú
          </span>
          <NavigationLink
            href="/list"
            className="inline-flex min-h-11 items-center text-sm font-medium text-primary"
          >
            Mi lista
          </NavigationLink>
          <ThemeControl />
          <AuthControl />
        </div>
      </header>
      <main id="main-content" className="min-w-0 flex-1 py-7 sm:py-10">
        {children}
      </main>
      <footer className="border-t py-6 text-xs text-muted-foreground">
        CompraFino · Más claridad para tus compras.
      </footer>
    </div>
  );
}

export function PriceNotice() {
  return (
    <p className="price-notice">
      Precios ordinarios observados en línea, sin tarjeta o membresía. Los beneficios requieren la
      condición indicada. Verifica el precio y la disponibilidad en el supermercado: pueden variar
      según ubicación, canal y actualización.
    </p>
  );
}

export function PublicDataError() {
  return (
    <div className="empty-surface">
      <h2 className="text-xl font-semibold">No pudimos cargar los precios.</h2>
      <p className="mt-2 text-muted-foreground">Intenta nuevamente en unos momentos.</p>
      <Link href="/search" className="mt-4 inline-block text-primary underline">
        Volver a buscar
      </Link>
    </div>
  );
}
