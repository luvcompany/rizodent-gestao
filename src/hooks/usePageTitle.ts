import { useEffect } from "react";
import { registrarPaginaNoTitulo, useBrand } from "@/contexts/BrandContext";

/**
 * Título da aba: "<página> · <marca>" ou só "<marca>".
 * A marca é a efetiva (cliente, ou sistema quando não há cliente).
 */
export function usePageTitle(pagina?: string) {
  const { effective, loading } = useBrand();
  // Enquanto a marca carrega (sem cache), não põe o nome padrão na aba: o
  // provider escreve o título assim que a marca chegar, já com esta página.
  const nome = loading ? "" : effective.name;

  useEffect(() => {
    const p = pagina?.trim() || undefined;
    registrarPaginaNoTitulo(p, nome);
    return () => {
      // Ao sair da tela, volta ao título só com a marca (a próxima tela, se
      // chamar o hook, registra a dela logo em seguida).
      registrarPaginaNoTitulo(undefined, nome);
    };
  }, [pagina, nome]);
}
