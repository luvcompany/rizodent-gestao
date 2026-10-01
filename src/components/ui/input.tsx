import * as React from "react";

import { cn } from "@/lib/utils";

/*
 * Pele do CRM (F2, marcador crm-field): fundo de card, placeholder terciário e
 * borda primária suave no foco, só sob a casca do CRM (index.css). Fora dela,
 * cada var() cai no valor de antes (bg-background, border-input,
 * placeholder:text-muted-foreground) e rounded-control = rounded-md.
 */

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "crm-field flex h-10 w-full rounded-control border border-[color:var(--crm-field-border,hsl(var(--input)))] bg-[color:var(--crm-field-bg,hsl(var(--background)))] px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-[color:var(--crm-field-placeholder,hsl(var(--muted-foreground)))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
