import type { ComponentProps } from "react";
import { cn } from "../lib/utils";

export function Empty({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("empty-surface flex flex-col gap-4", className)} {...props} />;
}

export function EmptyTitle({ className, children, ...props }: ComponentProps<"h2">) {
  return (
    <h2 className={cn("text-xl font-semibold", className)} {...props}>
      {children}
    </h2>
  );
}

export function EmptyDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}
