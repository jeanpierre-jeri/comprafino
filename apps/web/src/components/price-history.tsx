import { logDiagnostic } from "../server/diagnostics.ts";
import Link from "next/link";
import { formatPen, historyRanges } from "@comprafino/core";
import type { HistoryRange } from "@comprafino/core";
import { getCanonicalProductPriceHistory } from "@comprafino/db";
import { withPublicDatabase } from "../server/public-database.ts";
import { RetailerBadge, ObservedAt } from "./product-info";
import { PriceHistoryChart } from "./price-history-chart";
import { withSearchReturn } from "../lib/search-return";

const date = (at: Date) =>
  new Intl.DateTimeFormat("es-PE", {
    timeZone: "America/Lima",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);

export async function PriceHistory({
  productId,
  range,
  benefits,
  returnTo,
}: {
  productId: string;
  range: HistoryRange;
  benefits: boolean;
  returnTo?: string | null;
}) {
  let history;

  try {
    history = await withPublicDatabase((db) =>
      getCanonicalProductPriceHistory(db, productId, { range }),
    );
  } catch (error) {
    logDiagnostic(error, { stage: "public", operation: "history", reason: "db_read_failed" });
  }

  return (
    <PriceHistoryPresentation
      history={history ?? null}
      range={range}
      path={`/products/${productId}`}
      benefits={benefits}
      returnTo={returnTo}
    />
  );
}

export function PriceHistoryPresentation({
  history,
  range,
  path,
  benefits = false,
  returnTo,
}: {
  history: import("@comprafino/db").CanonicalProductPriceHistory | null;
  range: HistoryRange;
  path: string;
  benefits?: boolean;
  returnTo?: string | null;
}) {
  return (
    <section
      className="mt-8 min-w-0 rounded-2xl border bg-surface p-4 sm:p-6"
      aria-labelledby="history-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id="history-title" className="text-2xl font-semibold tracking-tight">
          Historial de precios sin tarjeta ni membresía
        </h2>
        <nav className="flex flex-wrap gap-2" aria-label="Rango del historial">
          {historyRanges.map((r) => (
            <Link
              key={r}
              scroll={false}
              aria-current={range === r ? "page" : undefined}
              className="selection-control"
              href={withSearchReturn(
                `${path}?range=${r}${benefits ? "&priceMode=benefits" : ""}`,
                returnTo,
              )}
            >
              {Number.parseInt(r, 10)} días
            </Link>
          ))}
        </nav>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        No conocemos el precio entre consultas ni la hora exacta en que cambió en la tienda. Los
        mínimos y máximos usan solo los registros disponibles y pueden incluir registros iniciados
        antes del período.
      </p>
      {!history ? (
        <p className="mt-5 text-sm text-muted-foreground">
          No pudimos cargar el historial. Puedes seguir comparando los precios de arriba.
        </p>
      ) : (
        <>
          <p className="mt-2 text-xs text-muted-foreground">
            {date(history.start)} – {date(history.end)} · Hora de Perú
          </p>
          <div
            className={`mt-5 grid gap-4 ${history.retailers.length > 1 ? "lg:grid-cols-2 xl:grid-cols-4" : ""}`}
          >
            {history.retailers.map((r) => {
              const s = r.summary;

              return (
                <article
                  key={r.retailerId}
                  className="min-w-0 rounded-xl border p-4"
                  aria-label={`Historial de ${r.retailerName}`}
                >
                  <h3>
                    <RetailerBadge id={r.retailerId} name={r.retailerName} />
                  </h3>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Último precio consultado en el período
                  </p>
                  <p className="price-value mt-1 text-2xl">
                    {s.currentPriceCents === null
                      ? "Sin consulta en el período"
                      : formatPen(s.currentPriceCents)}
                  </p>
                  <ObservedAt date={r.lastObservedAt} />
                  {r.available === false && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      No disponible en la última consulta.
                    </p>
                  )}
                  <p className="mt-4 text-sm leading-relaxed">{lastChangeDescription(s)}</p>
                  <PriceChangeInsight summary={s} />
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">Mínimo registrado</dt>
                      <dd className="price-value mt-1">
                        {s.minimumPriceCents === null ? "—" : formatPen(s.minimumPriceCents)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Máximo registrado</dt>
                      <dd className="price-value mt-1">
                        {s.maximumPriceCents === null ? "—" : formatPen(s.maximumPriceCents)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Cambios registrados</dt>
                      <dd className="mt-1">{s.changeCount}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        Diferencia frente al primer registro
                      </dt>
                      <dd className="mt-1">{priceDifferenceLabel(s.differenceCents)}</dd>
                    </div>
                  </dl>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {r.coverage.length} días con consultas en este período.
                  </p>
                  <details className="mt-3 text-xs text-muted-foreground">
                    <summary className="min-h-11 cursor-pointer py-2">
                      Ver registros de precio ({s.states.length})
                    </summary>
                    <p className="mb-3 leading-relaxed">
                      Cada registro empieza cuando consultamos ese precio. Puede terminar cuando
                      detectamos otro precio o un cambio en sus datos de referencia. Si sigue
                      abierto, solo cuenta hasta la última consulta.
                    </p>
                    <ul className="flex flex-col gap-3">
                      {s.states.map((state) => (
                        <li key={state.validFrom.toISOString()}>
                          {formatPen(state.priceCents)} · Desde {date(state.validFrom)}
                          {state.validUntil
                            ? ` hasta ${date(state.validUntil)}`
                            : " · Sin cierre registrado"}
                          {state.validFrom < history.start ? " · Registrado antes del período" : ""}
                        </li>
                      ))}
                    </ul>
                  </details>
                </article>
              );
            })}
          </div>
          {history.retailers.some(
            (r) => r.summary.status === "events" || r.summary.segments.length > 0,
          ) ? (
            <PriceHistoryChart
              start={history.start.getTime()}
              end={history.end.getTime()}
              series={history.retailers.map((r) => ({
                retailerId: r.retailerId,
                retailerName: r.retailerName,
                points: r.summary.points,
                segments: r.summary.segments,
              }))}
            />
          ) : (
            <p className="my-5 rounded-xl bg-secondary p-4 text-sm">
              {history.retailers.every((r) => r.summary.status === "empty")
                ? "No tenemos registros de precio en este rango."
                : "Aún no tenemos suficiente historial para mostrar una tendencia."}
            </p>
          )}
          <details className="mt-4 text-xs leading-relaxed text-muted-foreground">
            <summary className="min-h-11 cursor-pointer py-3">Cómo leer este historial</summary>
            <p>
              Los mínimos y máximos usan los registros que coinciden con el período, incluso si
              empezaron antes. No representan el precio de todos los días. Un registro sin cierre
              solo cuenta hasta la última consulta; no se extiende hasta hoy sin datos.
            </p>
            <p className="mt-2">
              Las líneas unen consultas en días consecutivos; los espacios sin línea indican que
              faltan datos. Los círculos huecos marcan el inicio y el fin de cada tramo. Los puntos
              sólidos muestran registros, incluidos los anteriores a las consultas diarias. Los
              precios con tarjeta, membresía u otras condiciones no entran en este historial.
            </p>
          </details>
        </>
      )}
    </section>
  );
}

type HistorySummary = ReturnType<typeof import("@comprafino/core").summarizePriceHistory>;

function priceDifferenceLabel(difference: number | null): string {
  if (difference === null) return "—";

  let prefix = "";

  if (difference > 0) {
    prefix = "+";
  } else if (difference < 0) {
    prefix = "−";
  }

  return `${prefix}${formatPen(Math.abs(difference))}`;
}

function lastChangeDescription(summary: HistorySummary): string {
  if (summary.lastChange) {
    const change = summary.lastChange;
    const direction = change.toCents < change.fromCents ? "bajó" : "subió";

    return `Último cambio registrado: ${direction} de ${formatPen(change.fromCents)} a ${formatPen(change.toCents)} el ${date(change.at)}.`;
  }

  return summary.status === "empty"
    ? "Sin registros en este rango."
    : "No registramos cambios de precio en este período.";
}

function PriceChangeInsight({ summary }: { summary: HistorySummary }) {
  if (summary.lastChange) {
    return (
      <p className="mt-2 text-sm font-medium" data-testid="price-change-insight">
        {summary.lastChange.direction === "down" ? "↓ Bajó" : "↑ Subió"}{" "}
        {formatPen(summary.lastChange.absoluteDifferenceCents)} en el último cambio del rango
        {summary.lastChange.percentDifference !== null
          ? ` (${Math.abs(summary.lastChange.percentDifference)}%)`
          : ""}
        .
      </p>
    );
  }

  if (summary.verifiedUnchangedDays !== null) {
    return (
      <p className="mt-2 text-sm font-medium" data-testid="unchanged-insight">
        Consultas con el mismo precio en {summary.verifiedUnchangedDays} días consecutivos.
      </p>
    );
  }

  return null;
}
