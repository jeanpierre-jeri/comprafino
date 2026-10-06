"use client";

import * as React from "react";
import { ResponsiveContainer } from "recharts";
import { cn } from "../lib/utils";

/** Minimal shadcn base-nova ChartContainer, adapted to the repository's theme attributes.
 * Source: https://ui.shadcn.com/r/styles/base-nova/chart.json
 * Only the primitives needed by the public history view are retained.
 */
export type ChartConfig = Record<string, { label: React.ReactNode; color: string }>;

export function ChartContainer({
  config,
  children,
  className,
  style,
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartConfig;
  children: React.ComponentProps<typeof ResponsiveContainer>["children"];
}) {
  const id = React.useId();
  const colors: React.CSSProperties & Record<`--color-${string}`, string> = Object.fromEntries(
    Object.entries(config).map(([key, item]) => [`--color-${key}`, item.color]),
  );

  return (
    <div
      data-slot="chart"
      data-chart={id}
      style={{ ...colors, ...style }}
      className={cn(
        "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground",
        className,
      )}
      {...props}
    >
      <ResponsiveContainer initialDimension={{ width: 320, height: 256 }}>
        {children}
      </ResponsiveContainer>
    </div>
  );
}

export {
  Tooltip as ChartTooltip,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
