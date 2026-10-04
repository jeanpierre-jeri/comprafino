import Link from "next/link";
import { formatPen, historyRanges } from "@comprafino/core";
import type { HistoryRange } from "@comprafino/core";
import { createDatabase, getCanonicalProductPriceHistory } from "@comprafino/db";
import { RetailerBadge, ObservedAt } from "./product-info";
import { PriceHistoryChart } from "./price-history-chart";

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
}: {
  productId: string;
  range: HistoryRange;
  benefits: boolean;
}) {
  let history;
  try {
    history = await getCanonicalProductPriceHistory(createDatabase(), productId, { range });
  } catch (error) {
    console.error("Public price history query failed", error);
  }
  return (
    <section
      className="mt-8 min-w-0 rounded-2xl bg-surface p-4 sm:p-6"
      aria-labelledby="history-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id="history-title" className="text-2xl font-semibold tracking-tight">
          Historial del precio para todos
        </h2>
        <nav className="flex gap-2" aria-label="Rango del historial">
          {historyRanges.map((r) => (
            <Link
              key={r}
              scroll={false}
              aria-current={range === r ? "page" : undefined}
              className={`inline-flex min-h-11 items-center rounded-lg border px-3 text-sm ${range === r ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}
              href={`/products/${productId}?range=${r}${benefits ? "&priceMode=benefits" : ""}`}
            >
              {Number.parseInt(r, 10)} días
            </Link>
          ))}
        </nav>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Mostramos estados de precio registrados; puede haber periodos sin observaciones. Los puntos
        no están conectados. Beneficios como CMR se muestran por separado.
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
          {history.retailers.some((r) => r.summary.status === "events") ? (
            <PriceHistoryChart
              start={history.start.getTime()}
              end={history.end.getTime()}
              series={history.retailers.map((r) => ({
                retailerId: r.retailerId,
                retailerName: r.retailerName,
                points: r.summary.points,
              }))}
            />
          ) : (
            <p className="my-5 rounded-xl bg-secondary p-4 text-sm">
              {history.retailers.every((r) => r.summary.status === "empty")
                ? "No tenemos registros de precio en este rango."
                : "Aún no tenemos suficiente historial para mostrar una tendencia."}
            </p>
          )}
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
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
                    Último precio verificado en el rango
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">
                    {s.currentPriceCents === null
                      ? "Sin verificación en el rango"
                      : formatPen(s.currentPriceCents)}
                  </p>
                  <ObservedAt date={r.lastObservedAt} />
                  {r.available === false && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      No disponible en la última consulta.
                    </p>
                  )}
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">Mínimo registrado</dt>
                      <dd className="mt-1 font-semibold">
                        {s.minimumPriceCents === null ? "—" : formatPen(s.minimumPriceCents)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Máximo registrado</dt>
                      <dd className="mt-1 font-semibold">
                        {s.maximumPriceCents === null ? "—" : formatPen(s.maximumPriceCents)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Cambios de precio</dt>
                      <dd className="mt-1">{s.changeCount}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        Desde el primer estado del rango
                      </dt>
                      <dd className="mt-1">
                        {s.differenceCents === null
                          ? "—"
                          : `${s.differenceCents > 0 ? "+" : s.differenceCents < 0 ? "−" : ""}${formatPen(Math.abs(s.differenceCents))}`}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-4 text-sm leading-relaxed">
                    {s.lastChange
                      ? `Último cambio: ${s.lastChange.toCents < s.lastChange.fromCents ? "bajó" : "subió"} de ${formatPen(s.lastChange.fromCents)} a ${formatPen(s.lastChange.toCents)} el ${date(s.lastChange.at)}.`
                      : s.status === "empty"
                        ? "Sin registros en este rango."
                        : "Sin cambios observados en este rango."}
                  </p>
                  <details className="mt-3 text-xs text-muted-foreground">
                    <summary className="min-h-10 cursor-pointer py-2">
                      Ver estados registrados ({s.states.length})
                    </summary>
                    <ul className="space-y-3">
                      {s.states.map((state) => (
                        <li key={state.validFrom.toISOString()}>
                          {formatPen(state.priceCents)} · Desde {date(state.validFrom)}
                          {state.validUntil
                            ? ` hasta ${date(state.validUntil)}`
                            : " · Estado abierto"}
                          {state.validFrom < history.start ? " · Iniciado antes del rango" : ""}
                        </li>
                      ))}
                    </ul>
                  </details>
                </article>
              );
            })}
          </div>
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            Mínimos y máximos corresponden a los estados registrados que intersectan este rango,
            incluidos los iniciados antes. Un estado abierto solo aporta hasta su última
            verificación. No conocemos el precio de cada día ni la hora exacta en que cambió en la
            tienda.
          </p>
        </>
      )}
    </section>
  );
}
