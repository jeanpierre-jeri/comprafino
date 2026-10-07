import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

// Adapted from the shadcn base-nova Alert registry, with existing theme tokens
// and the repository's cn utility. No external cn package is required.
const alertVariants = cva("relative grid w-full gap-2 rounded-xl border p-4 text-left text-sm", {
  variants: {
    variant: {
      default: "bg-surface text-foreground",
      destructive: "bg-surface text-destructive",
      savings: "border-primary/20 bg-secondary text-foreground",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Alert({
  className,
  variant,
  ...props
}: ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

export function AlertTitle({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="alert-title" className={cn("font-semibold", className)} {...props} />;
}

export function AlertDescription({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn("text-sm leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  );
}
