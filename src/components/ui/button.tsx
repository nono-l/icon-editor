import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-md)] text-sm font-medium transition-colors transition-transform duration-150 focus-ring disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-fg hover:brightness-110",
        secondary:
          "bg-bg-subtle text-fg border border-border hover:bg-border/40",
        outline:
          "border border-border bg-transparent text-fg hover:bg-bg-subtle",
        ghost: "text-fg-muted hover:bg-bg-subtle hover:text-fg",
        danger: "bg-live/15 text-live border border-live/30 hover:bg-live/25",
      },
      size: {
        default: "h-11 px-4 py-2 min-h-11",
        sm: "h-9 rounded-[var(--radius-sm)] px-3 text-xs min-h-9",
        lg: "h-12 rounded-[var(--radius-lg)] px-6 text-base min-h-12",
        icon: "h-11 w-11 min-h-11 min-w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
