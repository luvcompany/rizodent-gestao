import * as React from "react";

import { cn } from "@/lib/utils";

/*
 * Pele do CRM (F2): raio 16 (rounded-card), sombra suave (shadow-crm-card) e
 * borda /60 (marcador crm-card) só sob a casca do CRM; o título vai a 16/600
 * pelas variáveis do marcador crm-card-title. Fora da casca, rounded-card =
 * rounded-lg, shadow-crm-card = shadow-sm e o título continua text-2xl
 * leading-none tracking-tight (mesmos valores calculados). Um tamanho passado
 * por className (text-sm, text-lg…) continua vencendo.
 */

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("crm-card rounded-card border bg-card text-card-foreground shadow-crm-card", className)}
    {...props}
  />
));
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
  ),
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn(
        "crm-card-title text-[length:var(--crm-card-title-size,1.5rem)] font-semibold leading-[var(--crm-card-title-leading,1)] tracking-[var(--crm-card-title-tracking,-0.025em)]",
        className,
      )}
      {...props}
    />
  ),
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
  ),
);
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />,
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-6 pt-0", className)} {...props} />
  ),
);
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
