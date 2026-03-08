import * as React from "react";

import { cn } from "@/lib/utils";

const styles = {
  default: "bg-primary/90 text-slate-950 hover:bg-primary",
  ghost: "bg-transparent text-foreground hover:bg-primary/10"
} as const;

export function Button({
  className,
  variant = "default",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof styles;
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-md px-3 py-2 text-xs font-semibold transition",
        styles[variant],
        className
      )}
      {...props}
    />
  );
}
