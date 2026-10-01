import * as React from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { renderIcon, type IconLike } from "./icon";

export interface SearchInputProps extends React.ComponentProps<"input"> {
  /** Ícone à esquerda. Padrão: Search (lucide). */
  icon?: IconLike;
  /** Classe do contêiner (largura, margem). `className` vai para o <input>. */
  wrapperClassName?: string;
}

/**
 * Input de busca de tela: fundo afundado, sem borda, ícone à esquerda.
 * Repassa ref e todas as props ao <input>. Não força type="search" (isso
 * trocaria o papel de textbox para searchbox no inventário de acessibilidade).
 */
export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  ({ icon, wrapperClassName, className, ...props }, ref) => (
    <div className={cn("relative", wrapperClassName)}>
      <span className="pointer-events-none absolute left-3 top-1/2 flex -translate-y-1/2 text-tertiary">
        {renderIcon(icon ?? Search, 18)}
      </span>
      <Input
        ref={ref}
        className={cn(
          "h-10 rounded-xl border-transparent bg-surface-sunken pl-10 placeholder:text-tertiary focus-visible:bg-card",
          className,
        )}
        {...props}
      />
    </div>
  ),
);
SearchInput.displayName = "SearchInput";
