import { NavigationLink } from "./navigation-link";
import { ThemeControl } from "./theme-control";
import { AuthControl } from "./auth-control";
import Link from "next/link";
import { cn } from "@comprafino/ui/lib/utils";

export function PublicShell({
  children,
  compact = false,
}: {
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 sm:px-8">
      <a href="#main-content" className="skip-link">
        Saltar al contenido
      </a>
      <header
        className={cn(
          "grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 border-b py-3 sm:grid-cols-[auto_1fr_auto] sm:gap-6 sm:py-5",
          compact && "py-3 sm:py-4",
        )}
      >
        <Link href="/" className="wordmark" aria-label="CompraFino, inicio">
          <span>Compra</span>
          <span className="text-primary">
            Fino<span className="wordmark-dot">.</span>
          </span>
        </Link>
        <nav aria-label="Navegación principal" className="primary-navigation">
          <NavigationLink href="/search" className="primary-navigation-link">
            Productos
          </NavigationLink>
          <NavigationLink href="/list" className="primary-navigation-link bg-secondary">
            Mi lista
          </NavigationLink>
        </nav>
        <div className="col-start-2 row-start-1 flex min-w-0 items-center justify-end gap-2 sm:col-start-3 sm:gap-3">
          <ThemeControl />
          <AuthControl />
        </div>
      </header>
      <main
        id="main-content"
        className={cn("min-w-0 flex-1 py-7 sm:py-10", compact && "py-4 sm:py-6")}
      >
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
      Precios consultados en las webs de los supermercados. El precio principal no requiere tarjeta
      ni membresía; los otros precios indican sus condiciones. Confirma el precio y el stock antes
      de comprar: pueden variar según tu ubicación, si compras por web o en tienda y la fecha de
      consulta.
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
