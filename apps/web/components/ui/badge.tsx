import * as React from "react";

import { cn } from "@/lib/utils";

const styles = {
  default: "bg-primary/15 text-primary border-primary/35",
  warning: "bg-accent/15 text-accent border-accent/35",
  destructive: "bg-destructive/15 text-red-300 border-destructive/35",
  muted: "bg-muted/45 text-slate-200 border-muted"
} as const;

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: keyof typeof styles }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        styles[variant],
        className
      )}
      {...props}
    />
  );
}
