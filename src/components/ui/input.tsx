import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<"input">
>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    className={cn(
      "flex h-11 w-full min-h-11 rounded-[var(--radius-md)] border border-border bg-bg-subtle px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus-ring disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    ref={ref}
    {...props}
  />
));
Input.displayName = "Input";
