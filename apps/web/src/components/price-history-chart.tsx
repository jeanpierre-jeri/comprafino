"use client";

import { useState } from "react";
import { formatPen } from "@comprafino/core";
import {
  ChartContainer,
  ChartTooltip,
  ScatterChart,
  Scatter,
  CartesianGrid,
  XAxis,
  YAxis,
} from "@comprafino/ui/components/chart";
import type { ChartConfig } from "@comprafino/ui/components/chart";
import type { RetailerId } from "@comprafino/core";

const treatment = {
  tottus: { color: "var(--tottus-text)", shape: "circle", symbol: "●" },
  "plaza-vea": { color: "var(--plaza-text)", shape: "diamond", symbol: "◆" },
  metro: { color: "var(--metro-text)", shape: "square", symbol: "■" },
  makro: { color: "var(--makro-text)", shape: "triangle", symbol: "▲" },
} as const;

const date = (at: number, detailed = false) =>
  new Intl.DateTimeFormat("es-PE", {
    timeZone: "America/Lima",
    day: "numeric",
    month: "short",
    ...(detailed ? ({ year: "numeric", hour: "2-digit", minute: "2-digit" } as const) : {}),
  }).format(at);

type Series = {
  retailerId: RetailerId;
  retailerName: string;
  segments: { at: number; priceCents: number }[][];
  points: { at: number; priceCents: number; kind: "state-start" | "latest-observation" }[];
};

function CoverageBoundary({
  cx,
  cy,
  fill,
  payload,
}: {
  cx?: number;
  cy?: number;
  fill?: string;
  payload?: unknown;
}) {
  if (
    typeof cx !== "number" ||
    typeof cy !== "number" ||
    typeof payload !== "object" ||
    payload === null ||
    !("boundary" in payload) ||
    payload.boundary !== true
  ) {
    return <g aria-hidden="true" />;
  }

  return (
    <circle
      className="coverage-boundary"
      cx={cx}
      cy={cy}
      r={4}
      fill="var(--surface)"
      stroke={fill}
      strokeWidth={2}
    />
  );
}

function tooltipDescription(raw: object): string {
  if ("kind" in raw && raw.kind === "coverage-boundary") {
    return "Extremo del tramo con cobertura verificada";
  }

  if ("kind" in raw && raw.kind === "latest-observation") {
    return "Última verificación";
  }

  return "Inicio del estado registrado";
}

function EventTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly { payload?: unknown }[];
}) {
  const raw = payload?.[0]?.payload;

  if (
    !active ||
    typeof raw !== "object" ||
    raw === null ||
    !("at" in raw) ||
    typeof raw.at !== "number" ||
    !("priceCents" in raw) ||
    typeof raw.priceCents !== "number" ||
    !("retailerName" in raw) ||
    typeof raw.retailerName !== "string"
  ) {
    return null;
  }

  return (
    <div role="tooltip" className="max-w-60 rounded-lg border bg-surface p-3 text-xs shadow-soft">
      <p className="font-semibold">
        {raw.retailerName} · {formatPen(raw.priceCents)}
      </p>
      <p className="mt-1">{date(raw.at, true)}</p>
      <p className="mt-1 text-muted-foreground">{tooltipDescription(raw)}</p>
    </div>
  );
}

export function PriceHistoryChart({
  series,
  start,
  end,
}: {
  series: Series[];
  start: number;
  end: number;
}) {
  const [hidden, setHidden] = useState<RetailerId[]>([]);
  const config: ChartConfig = Object.fromEntries(
    series.map((s) => [
      s.retailerId,
      {
        label: s.retailerName,
        color: treatment[s.retailerId].color,
      },
    ]),
  );

  return (
    <div>
      <div className="my-4 flex flex-wrap gap-2" aria-label="Supermercados del historial">
        {series.map((s) => (
          <button
            key={s.retailerId}
            type="button"
            aria-pressed={!hidden.includes(s.retailerId)}
            className="min-h-11 rounded-lg border px-3 text-sm hover:bg-secondary aria-[pressed=false]:opacity-50"
            onClick={() =>
              setHidden((old) =>
                old.includes(s.retailerId)
                  ? old.filter((id) => id !== s.retailerId)
                  : [...old, s.retailerId],
              )
            }
          >
            <span aria-hidden="true" style={{ color: treatment[s.retailerId].color }}>
              {treatment[s.retailerId].symbol}
            </span>{" "}
            {s.retailerName}
          </button>
        ))}
      </div>
      <ChartContainer
        config={config}
        className="h-64 w-full min-w-0 aspect-auto"
        aria-label="Eventos observados de precio para todos"
      >
        <ScatterChart accessibilityLayer margin={{ top: 16, right: 20, bottom: 8, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            type="number"
            dataKey="at"
            domain={[start, end]}
            tickFormatter={(v: number) => date(v)}
            tickCount={3}
            padding={{ left: 8, right: 8 }}
            minTickGap={35}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="number"
            dataKey="priceCents"
            width={68}
            tickFormatter={(v: number) => formatPen(Math.max(0, Math.round(v)))}
            // Leave breathing room for flat prices without magnifying cents into a trend.
            domain={([minimum, maximum]: readonly [number, number]) => {
              const padding = Math.max(50, Math.ceil((maximum - minimum) * 0.15));

              return [Math.max(0, minimum - padding), maximum + padding];
            }}
            tickLine={false}
            axisLine={false}
          />
          <ChartTooltip cursor={false} content={<EventTooltip />} />
          {series.flatMap((s) =>
            s.segments.map((segment, index) => (
              <Scatter
                key={`${s.retailerId}-${index}`}
                name={s.retailerName}
                data={segment.map((point, pointIndex) => ({
                  ...point,
                  retailerName: s.retailerName,
                  kind: "coverage-boundary",
                  boundary: pointIndex === 0 || pointIndex === segment.length - 1,
                }))}
                className={`verified-segment verified-segment-${s.retailerId}`}
                // Core expands transitions into horizontal/vertical endpoints.
                // Joining those endpoints preserves exact steps and item tooltips.
                line={{ strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round" }}
                lineType="joint"
                lineJointType="linear"
                fill={treatment[s.retailerId].color}
                hide={hidden.includes(s.retailerId)}
                shape={CoverageBoundary}
                activeShape={CoverageBoundary}
                isAnimationActive={false}
              />
            )),
          )}
          {series.map((s) => (
            <Scatter
              key={s.retailerId}
              name={s.retailerName}
              hide={hidden.includes(s.retailerId)}
              data={s.points.map((p) => ({ ...p, retailerName: s.retailerName }))}
              fill={`var(--color-${s.retailerId})`}
              shape={treatment[s.retailerId].shape}
              line={false}
              isAnimationActive={false}
            />
          ))}
        </ScatterChart>
      </ChartContainer>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        Línea con extremos huecos: tramo verificado. Puntos sólidos: registros de precio. Los cortes
        indican falta de cobertura, no un cambio de precio.
      </p>
      {hidden.length === series.length && (
        <p className="text-sm text-muted-foreground">
          Selecciona un supermercado para ver sus registros.
        </p>
      )}
    </div>
  );
}
