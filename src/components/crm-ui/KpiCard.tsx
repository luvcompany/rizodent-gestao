import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type SemanticTone = "primary" | "success" | "warning" | "destructive" | "info" | "purple" | "slate";
const tones: Record<SemanticTone, string> = {
  primary: "bg-primary-soft text-primary-soft-foreground", success: "bg-success-soft text-success-soft-foreground",
  warning: "bg-warning-soft text-warning-soft-foreground", destructive: "bg-destructive-soft text-destructive-soft-foreground",
  info: "bg-info-soft text-info-soft-foreground", purple: "bg-purple-soft text-purple-soft-foreground",
  slate: "bg-slate-soft text-slate-soft-foreground",
};

type KpiCardProps = { label: string; value: ReactNode; icon: LucideIcon; tone?: SemanticTone; detail?: ReactNode; className?: string };
export function KpiCard({ label, value, icon: Icon, tone = "primary", detail, className }: KpiCardProps) {
  return <Card className={cn("p-5", className)}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-2 text-3xl font-bold tabular-nums text-foreground">{value}</p>{detail && <div className="mt-1 text-xs text-muted-foreground">{detail}</div>}</div><span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-control", tones[tone])}><Icon className="h-5 w-5" /></span></div></Card>;
}