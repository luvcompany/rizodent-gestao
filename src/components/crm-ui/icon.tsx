import * as React from "react";
import type { LucideIcon, LucideProps } from "lucide-react";

/**
 * Ícone aceito pelos componentes do crm-ui: o componente do lucide
 * (`icon={Users}`) ou um elemento pronto (`icon={<Users />}`).
 * Componente vira elemento com strokeWidth 1.75 e o tamanho pedido;
 * elemento pronto é respeitado como veio.
 */
export type IconLike = LucideIcon | React.ComponentType<LucideProps> | React.ReactElement;

export const ICON_STROKE = 1.75;

export function renderIcon(icon: IconLike | null | undefined, size: number, className?: string): React.ReactNode {
  if (icon == null) return null;
  if (React.isValidElement(icon)) return icon;
  const Comp = icon as React.ComponentType<LucideProps>;
  return <Comp size={size} strokeWidth={ICON_STROKE} className={className} aria-hidden="true" />;
}
