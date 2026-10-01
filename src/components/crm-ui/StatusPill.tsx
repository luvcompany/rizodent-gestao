import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type { SemanticTone } from "./KpiCard";

const variants = { primary: "primarySoft", success: "success", warning: "warning", destructive: "destructiveSoft", info: "info", purple: "purple", slate: "slate" } as const;
export function StatusPill({ children, tone = "slate", className }: { children: ReactNode; tone?: SemanticTone; className?: string }) {
  return <Badge variant={variants[tone]} className={className}>{children}</Badge>;
}