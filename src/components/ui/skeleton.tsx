import { cn } from "@/lib/utils";

/* F2: rounded-control (= rounded-md fora da casca do CRM). */

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-control bg-muted", className)} {...props} />;
}

export { Skeleton };
