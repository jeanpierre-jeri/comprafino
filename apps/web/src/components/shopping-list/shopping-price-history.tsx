import Link from "next/link";
import { formatPen } from "@comprafino/core";
import type { ShoppingPriceHistory, ShoppingOption } from "@comprafino/core";

export function elapsedPriceLabel(daysAgo: number | null) {
  if (daysAgo === null) return "";
  if (daysAgo === 0) return "hoy";
  if (daysAgo === 1) return "hace 1 día";
  return `hace ${daysAgo} días`;
}

export function ShoppingHistory({
  history,
  option,
}: {
  history?: ShoppingPriceHistory;
  option?: ShoppingOption | null;
}) {
  const minimum = history?.periods.find((period) => period.days === 90);
  const current = option ? option.ordinaryTotalCents / option.packages : null;
  let comparison = "Aún no tenemos observaciones suficientes para comparar este precio.";
  if (minimum?.minimumCents && current) {
    const difference = current - minimum.minimumCents;
    if (difference <= 0) {
      comparison = "Hoy está al menor precio que hemos observado en este período.";
    } else {
      comparison = `Hoy cuesta ${formatPen(difference)} más por paquete que el mínimo observado.`;
    }
  }

  return (
    <section aria-label="Historial de tu producto" className="flex flex-col gap-3">
      <div>
        <h4 className="font-semibold">¿Cómo está el precio de hoy?</h4>
        <p className="mt-1 text-sm text-muted-foreground">{comparison}</p>
      </div>
      {history && (
        <>
          <dl className="grid grid-cols-3 gap-2">
            {history.periods.map((period) => (
              <div key={period.days} className="rounded-xl bg-muted/60 p-2 sm:p-3">
                <dt className="text-xs text-muted-foreground">Mínimo en {period.days} días</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums">
                  {period.minimumCents === null ? "Sin datos" : formatPen(period.minimumCents)}
                </dd>
                <dd className="mt-1 text-xs text-muted-foreground">
                  {period.observedAt && (
                    <>
                      <time dateTime={period.observedAt}>
                        {new Date(period.observedAt).toLocaleDateString("es-PE", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                          timeZone: "America/Lima",
                        })}
                      </time>{" "}
                      · {elapsedPriceLabel(period.daysAgo)}
                    </>
                  )}
                  <span className="mt-1 block">
                    {period.coveredDays} de {period.days} días con observaciones
                  </span>
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted-foreground">
            Por paquete · {history.retailerName} · Precio para todos, sin tarjeta ni beneficios. Los
            días sin observaciones quedan sin datos; estos mínimos no predicen futuras ofertas.
          </p>
          <Link className="card-link text-sm" href={`/listings/${history.listingId}`}>
            Ver historial completo
          </Link>
        </>
      )}
    </section>
  );
}
