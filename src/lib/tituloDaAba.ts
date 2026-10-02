/**
 * Nome da tela para a aba do navegador, tirado dos próprios itens do menu
 * (que já mudam por papel e segmento). Sem casamento: undefined (só a marca).
 */
type ItemDoTitulo = { to: string; label: string; end?: boolean; search?: string };

const casaPrefixo = (path: string, to: string) => path === to || path.startsWith(to + "/");

export function tituloDaAba(
  pathname: string,
  search: string,
  itens: ItemDoTitulo[],
  extras: Record<string, string> = {},
): string | undefined {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;

  const candidatos = itens.filter((i) => (i.end ? path === i.to : casaPrefixo(path, i.to)));
  if (candidatos.length > 0) {
    const ordenados = [...candidatos].sort((a, b) => {
      const qa = a.search && a.search === search ? 1 : 0;
      const qb = b.search && b.search === search ? 1 : 0;
      if (qa !== qb) return qb - qa;
      return b.to.length - a.to.length;
    });
    return ordenados[0].label;
  }

  const extra = Object.keys(extras)
    .filter((p) => casaPrefixo(path, p))
    .sort((a, b) => b.length - a.length)[0];
  return extra ? extras[extra] : undefined;
}
