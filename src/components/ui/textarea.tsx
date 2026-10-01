import * as React from "react";

import { cn } from "@/lib/utils";

/*
 * Pele do CRM (F2, marcador crm-field): fundo de card, placeholder terciário e
 * borda primária suave no foco, só sob a casca do CRM (index.css). Fora dela,
 * cada var() cai no valor de antes (bg-background, border-input,
 * placeholder:text-muted-foreground) e rounded-control = rounded-md.
 */

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "crm-field flex min-h-[80px] w-full rounded-control border border-[color:var(--crm-field-border,hsl(var(--input)))] bg-[color:var(--crm-field-bg,hsl(var(--background)))] px-3 py-2 text-sm ring-offset-background placeholder:text-[color:var(--crm-field-placeholder,hsl(var(--muted-foreground)))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
