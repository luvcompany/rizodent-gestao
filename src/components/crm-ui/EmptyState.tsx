import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description?: string; action?: ReactNode }) {
  return <div className="flex min-h-48 flex-col items-center justify-center px-5 py-10 text-center"><span className="grid h-12 w-12 place-items-center rounded-full bg-slate-soft text-slate-soft-foreground"><Icon className="h-5 w-5" /></span><h3 className="mt-4 text-sm font-semibold text-foreground">{title}</h3>{description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}{action && <div className="mt-4">{action}</div>}</div>;
}