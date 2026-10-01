import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Variantes:
 * - default, secondary, destructive, outline: as de sempre (intactas).
 * - soft-* (redesign do CRM, F2): pílula de status suave, h-6 px-2.5 11/500,
 *   fundo `bg-<cor>-soft` e texto `text-<cor>-soft-foreground` (contraste AA
 *   sobre o suave nos dois temas; ver index.css). Cores: soft-success,
 *   soft-warning, soft-info, soft-orange, soft-purple, soft-pink, soft-teal,
 *   soft-slate, soft-destructive e soft-primary (bg-primary-soft
 *   text-primary-soft-fg, derivado da marca). Cor com significado (status)
 *   nunca usa soft-primary: na marca verde ele colidiria com success.
 */
const SOFT = "h-6 rounded-full border-transparent px-2.5 text-[11px] font-medium";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive: "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground",
        "soft-success": `${SOFT} bg-success-soft text-success-soft-foreground`,
        "soft-warning": `${SOFT} bg-warning-soft text-warning-soft-foreground`,
        "soft-info": `${SOFT} bg-info-soft text-info-soft-foreground`,
        "soft-orange": `${SOFT} bg-orange-soft text-orange-soft-foreground`,
        "soft-purple": `${SOFT} bg-purple-soft text-purple-soft-foreground`,
        "soft-pink": `${SOFT} bg-pink-soft text-pink-soft-foreground`,
        "soft-teal": `${SOFT} bg-teal-soft text-teal-soft-foreground`,
        "soft-slate": `${SOFT} bg-slate-soft text-slate-soft-foreground`,
        "soft-destructive": `${SOFT} bg-destructive-soft text-destructive-soft-foreground`,
        "soft-primary": `${SOFT} bg-primary-soft text-primary-soft-fg`,
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
