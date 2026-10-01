import * as React from "react";
import { cn } from "@/lib/utils";
import { SectionCard, type SectionCardProps } from "./SectionCard";

export interface ChartCardProps extends Omit<SectionCardProps, "title" | "description"> {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Altura da área do gráfico (px ou valor CSS). Sem ela, o gráfico define a própria altura. */
  height?: number | string;
  bodyClassName?: string;
}

/** Card de gráfico: SectionCard com título 16/600 e controle (actions) à direita. */
export const ChartCard = React.forwardRef<HTMLElement, ChartCardProps>(
  ({ title, subtitle, height, bodyClassName, children, ...rest }, ref) => (
    <SectionCard ref={ref} title={title} description={subtitle} {...rest}>
      <div className={cn("w-full min-w-0", bodyClassName)} style={height != null ? { height } : undefined}>
        {children}
      </div>
    </SectionCard>
  ),
);
ChartCard.displayName = "ChartCard";
