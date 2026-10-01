import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type ThemedLoaderProps = {
  className?: string;
  fullScreen?: boolean;
};

const ThemedLoader = ({ className, fullScreen = true }: ThemedLoaderProps) => (
  <div
    className={cn(
      "flex items-center justify-center bg-background text-foreground",
      fullScreen ? "min-h-screen" : "min-h-full",
      className,
    )}
  >
    <div className="flex flex-col items-center gap-3" role="status" aria-live="polite">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-primary-soft text-primary-soft-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      </span>
      <span className="text-sm font-medium text-muted-foreground">Carregando…</span>
    </div>
  </div>
);

export default ThemedLoader;