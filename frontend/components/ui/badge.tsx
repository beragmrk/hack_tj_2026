import * as React from "react";

import { cn } from "@/lib/utils";

const styles = {
  default: "bg-primary/14 text-[#1f5979] border-primary/40",
  warning: "bg-accent/12 text-[#9a4f19] border-accent/45",
  destructive: "bg-destructive/10 text-[#9a2424] border-destructive/45",
  muted: "bg-muted/75 text-[#375566] border-[#b1c7d6]"
} as const;

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: keyof typeof styles }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-[0.01em]",
        styles[variant],
        className
      )}
      {...props}
    />
  );
}
