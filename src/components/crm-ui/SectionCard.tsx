import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type SectionCardProps = { title: string; icon?: LucideIcon; actions?: ReactNode; children: ReactNode; className?: string; contentClassName?: string };

export function SectionCard({ title, icon: Icon, actions, children, className, contentClassName }: SectionCardProps) {
  return (
    <Card className={className}>
      <CardHeader className="flex-row items-center justify-between space-y-0 p-5">
        <div className="flex min-w-0 items-center gap-3">
          {Icon && <span className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-primary-soft text-primary-soft-foreground"><Icon className="h-4 w-4" /></span>}
          <CardTitle className="break-words text-base font-semibold leading-snug">{title}</CardTitle>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </CardHeader>
      <CardContent className={cn("p-5 pt-0", contentClassName)}>{children}</CardContent>
    </Card>
  );
}