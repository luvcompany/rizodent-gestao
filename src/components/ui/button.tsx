import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Pele do CRM (F2): as classes crm-btn-* são marcadoras; os valores novos
 * (hover primary-hover, sombra da marca no primário, outline em card com hover
 * afundado, ghost com hover em muted) só existem sob a casca do CRM (index.css,
 * @layer components). Fora dela, cada var() cai no valor de antes e o admin
 * fica idêntico. Alturas, variantes e props não mudaram.
 *
 * A sombra da marca só vale enquanto o botão tem a classe bg-primary: se a
 * tela trocar o fundo (className="bg-green-600"), o cn() remove bg-primary e o
 * brilho azul some junto (regra .crm-btn-default:where([class~="bg-primary"])).
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "crm-btn-default bg-primary text-primary-foreground hover:bg-[color:var(--crm-btn-default-hover,hsl(var(--primary)/0.9))]",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "crm-btn-outline border border-[color:var(--crm-btn-outline-border,hsl(var(--input)))] bg-[color:var(--crm-btn-outline-bg,hsl(var(--background)))] hover:bg-[color:var(--crm-btn-outline-hover-bg,hsl(var(--accent)))] hover:text-[color:var(--crm-btn-outline-hover-fg,hsl(var(--accent-foreground)))]",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "crm-btn-ghost hover:bg-[color:var(--crm-btn-ghost-hover-bg,hsl(var(--accent)))] hover:text-[color:var(--crm-btn-ghost-hover-fg,hsl(var(--accent-foreground)))]",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-control px-3",
        lg: "h-11 rounded-control px-8",
        icon: "h-10 w-10",
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

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
