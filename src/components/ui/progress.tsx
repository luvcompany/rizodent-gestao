import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";

import { cn } from "@/lib/utils";

/*
 * Pele do CRM (F2, marcadores crm-progress/crm-progress-bar): trilho afundado
 * de 10px e preenchimento arredondado, só sob a casca do CRM. Fora dela: h-4
 * e bg-secondary de antes.
 */

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn(
      "crm-progress relative h-[var(--crm-progress-h,1rem)] w-full overflow-hidden rounded-full bg-[color:var(--crm-progress-track,hsl(var(--secondary)))]",
      className,
    )}
    {...props}
  >
    <ProgressPrimitive.Indicator
      className="crm-progress-bar h-full w-full flex-1 bg-primary transition-all"
      style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
    />
  </ProgressPrimitive.Root>
));
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
