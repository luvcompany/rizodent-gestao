import { GripVertical } from "lucide-react";
import * as ResizablePrimitive from "react-resizable-panels";

import { cn } from "@/lib/utils";

const ResizablePanelGroup = ({ className, ...props }: React.ComponentProps<typeof ResizablePrimitive.PanelGroup>) => (
  <ResizablePrimitive.PanelGroup
    className={cn("flex h-full w-full data-[panel-group-direction=vertical]:flex-col", className)}
    {...props}
  />
);

const ResizablePanel = ResizablePrimitive.Panel;

/**
 * ResizableHandle
 * - `variant="line"` (padrão): a linha de 1px de sempre.
 * - `variant="gap"` (opt-in, F2, para painéis em card no CRM): alça
 *   transparente de 12px que funciona como o espaço entre os painéis (use em
 *   vez de gap no PanelGroup, que estouraria os 100%); mostra um traço de 2px
 *   no hover e na cor da marca ao arrastar. Arrasto, teclado e tamanhos dos
 *   painéis não mudam.
 */
const ResizableHandle = ({
  withHandle,
  variant = "line",
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelResizeHandle> & {
  withHandle?: boolean;
  variant?: "line" | "gap";
}) => (
  <ResizablePrimitive.PanelResizeHandle
    className={cn(
      "relative flex w-px items-center justify-center bg-border after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:h-1 data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:-translate-y-1/2 data-[panel-group-direction=vertical]:after:translate-x-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 [&[data-panel-group-direction=vertical]>div]:rotate-90",
      variant === "gap" &&
        "w-3 bg-transparent after:inset-y-2 after:w-0.5 after:rounded-full after:transition-colors hover:after:bg-border data-[resize-handle-state=drag]:after:bg-primary/50 data-[panel-group-direction=vertical]:h-3 data-[panel-group-direction=vertical]:after:inset-x-2 data-[panel-group-direction=vertical]:after:h-0.5 data-[panel-group-direction=vertical]:after:w-auto",
      className,
    )}
    {...props}
  >
    {withHandle && (
      <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border">
        <GripVertical className="h-2.5 w-2.5" />
      </div>
    )}
  </ResizablePrimitive.PanelResizeHandle>
);

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
