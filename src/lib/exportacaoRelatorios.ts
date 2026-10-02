// Exportação dos relatórios: colunas em português, datas dd/mm/aaaa,
// dinheiro como número com 2 casas (para o Excel somar).

export function dataBR(v: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v ?? "");
}

export function diaMesBR(v: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ""));
  return m ? `${m[3]}/${m[2]}` : String(v ?? "");
}

export interface ColunaExport<T> {
  rotulo: string;
  valor: (l: T) => unknown;
  tipo?: "texto" | "numero" | "dinheiro" | "data";
  somar?: boolean;
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const duas = (n: number) => Math.round(n * 100) / 100;

function formatar(v: unknown, tipo: ColunaExport<any>["tipo"]): unknown {
  if (tipo === "dinheiro") return duas(num(v));
  if (tipo === "numero") return num(v);
  if (tipo === "data") return dataBR(v as string);
  return v ?? "";
}

export function linhasParaExportar<T>(linhas: T[], colunas: ColunaExport<T>[], opcoes?: { total?: string }): Record<string, unknown>[] {
  const out = linhas.map((l) => {
    const o: Record<string, unknown> = {};
    colunas.forEach((c) => { o[c.rotulo] = formatar(c.valor(l), c.tipo); });
    return o;
  });
  if (opcoes?.total) {
    const t: Record<string, unknown> = {};
    colunas.forEach((c, i) => {
      if (c.somar) {
        const s = linhas.reduce((acc, l) => acc + num(c.valor(l)), 0);
        t[c.rotulo] = c.tipo === "dinheiro" ? duas(s) : s;
      } else t[c.rotulo] = i === 0 ? opcoes.total : "";
    });
    out.push(t);
  }
  return out;
}
