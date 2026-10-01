import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { SectionCard } from "./SectionCard";

export const crmChartColors = ["hsl(var(--primary))", "hsl(var(--info))", "hsl(var(--success))", "hsl(var(--warning))", "hsl(var(--purple))", "hsl(var(--slate))"] as const;
export function ChartCard({ title, icon, actions, children, className }: { title: string; icon?: LucideIcon; actions?: ReactNode; children: ReactNode; className?: string }) {
  return <SectionCard title={title} icon={icon} actions={actions} className={className} contentClassName="min-h-64">{children}</SectionCard>;
}