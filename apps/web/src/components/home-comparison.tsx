import { connection } from "next/server";
import { formatPen, getHomeProductComparison } from "@comprafino/db";
import { ArrowRight } from "@comprafino/ui";
import { NavigationLink } from "./navigation-link";
import { packageSummary, RetailerBadge } from "./product-info";
import { withPublicDatabase } from "../server/public-database";
import { logDiagnostic } from "../server/diagnostics";

export function HomeComparisonFallback({ loading = false }: { loading?: boolean }) {
  return (
    <section
      className="home-comparison"
      aria-labelledby="home-comparison-title"
      aria-busy={loading}
    >
      <div>
        <h2 id="home-comparison-title" className="text-lg font-semibold tracking-tight">
          El mismo producto, tienda por tienda
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {loading
            ? "Consultando una comparación del catálogo…"
            : "Busca tu producto para consultar los precios disponibles."}
        </p>
      </div>
      <div className="flex flex-col items-start justify-center gap-2">
        <p className="text-sm text-muted-foreground">
          Busca por producto, marca o presentación para consultar los registros disponibles.
        </p>
        <NavigationLink
          href="/search"
          className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-primary"
        >
          Explorar productos <ArrowRight aria-hidden="true" size={16} />
        </NavigationLink>
      </div>
    </section>
  );
}

async function loadHomeComparison() {
  await connection();

  const observedNow = new Date();
  const product = await withPublicDatabase((database) =>
    getHomeProductComparison(database, observedNow),
  );

  return product;
}

export async function HomeComparison() {
  const product = await loadHomeComparison().catch((error: unknown) => {
    logDiagnostic(error, {
      stage: "public",
      operation: "comparison",
      reason: "db_read_failed",
    });

    return null;
  });

  if (!product) return <HomeComparisonFallback />;

  const observationDate = new Intl.DateTimeFormat("es-PE", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "America/Lima",
  });

  // Retained stale or explicitly unavailable records belong in the detail view,
  // not in this compact sample of usable ordinary price observations.
  const offers = product.offers.filter(
    (offer) => offer.freshness === "fresh" && offer.available !== false,
  );

  return (
    <section className="home-comparison" aria-labelledby="home-comparison-title">
      <div>
        <h2 id="home-comparison-title" className="eyebrow">
          Una comparación del catálogo
        </h2>
        <h3 className="mt-2 text-lg font-semibold tracking-tight">{product.displayName}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Presentación: {packageSummary(product)}
        </p>
      </div>
      <div>
        <ul className="home-comparison-offers" aria-label="Precios observados por tienda">
          {offers.map((offer) => (
            <li key={offer.retailerId}>
              <RetailerBadge id={offer.retailerId} name={offer.retailerName} />
              <p className="mt-1 text-lg font-semibold tabular-nums">
                {formatPen(offer.currentPriceCents)}
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                <time dateTime={offer.observedAt.toISOString()} title="Observado (hora de Perú)">
                  {observationDate.format(offer.observedAt)}
                </time>
              </p>
            </li>
          ))}
        </ul>
        <NavigationLink
          href={`/products/${product.id}`}
          className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-primary"
        >
          Ver comparación <ArrowRight aria-hidden="true" size={16} />
        </NavigationLink>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground lg:col-span-2">
        Precios observados en hora de Perú, sin tarjeta ni membresía. Verifica precio y
        disponibilidad en tienda.
      </p>
    </section>
  );
}
