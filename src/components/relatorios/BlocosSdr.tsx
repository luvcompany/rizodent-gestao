import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { fmtPct } from "@/lib/relatorioSdr";
import { DialogoLeads, useListaLeads } from "@/components/relatorios/SdrDiario";

export type Blocos = Record<string, string[]>;

export async function buscarBlocosSdr(de: string, ate: string): Promise<Record<string, Blocos>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("relatorio_sdr_blocos", { p_de: de, p_ate: ate });
  if (error) throw new Error(error.message);
  const out: Record<string, Blocos> = {};
  for (const r of (data ?? []) as { user_id: string; blocos: Blocos }[]) out[r.user_id] = r.blocos;
  return out;
}

const TONS = {
  total: "bg-primary-soft text-primary-soft-fg",
  compareceu: "bg-success-soft text-success-soft-foreground",
  falta: "bg-destructive-soft text-destructive-soft-foreground",
  cancelou: "bg-muted text-muted-foreground",
  pendente: "bg-warning-soft text-warning-soft-foreground",
  remarcou: "bg-purple-soft text-purple-soft-foreground",
} as const;

type Item = { rotulo: string; chave: string; tom: keyof typeof TONS };

const BLOCOS: { titulo: string; ajuda: string; itens: Item[]; base?: string }[] = [
  { titulo: "Agendados", ajuda: "Primeira consulta do lead, marcada para o período", itens: [
    { rotulo: "Total", chave: "agd", tom: "total" },
    { rotulo: "Compareceram", chave: "agd_compareceu", tom: "compareceu" },
    { rotulo: "Faltas", chave: "agd_falta", tom: "falta" },
    { rotulo: "Cancelamentos", chave: "agd_cancelou", tom: "cancelou" },
    { rotulo: "Pendentes", chave: "agd_pendente", tom: "pendente" },
  ] },
  { titulo: "Remarcados", ajuda: "Consultas seguintes do lead, marcadas para o período", itens: [
    { rotulo: "Total", chave: "rem", tom: "total" },
    { rotulo: "Compareceram", chave: "rem_compareceu", tom: "compareceu" },
    { rotulo: "Faltas", chave: "rem_falta", tom: "falta" },
    { rotulo: "Cancelamentos", chave: "rem_cancelou", tom: "cancelou" },
    { rotulo: "Pendentes", chave: "rem_pendente", tom: "pendente" },
  ] },
  { titulo: "Geral", ajuda: "Desfecho final de cada lead no período", base: "ger", itens: [
    { rotulo: "Total", chave: "ger", tom: "total" },
    { rotulo: "Compareceram", chave: "ger_compareceu", tom: "compareceu" },
    { rotulo: "Faltas", chave: "ger_falta", tom: "falta" },
    { rotulo: "Cancelamentos", chave: "ger_cancelou", tom: "cancelou" },
    { rotulo: "Pendentes", chave: "ger_pendente", tom: "pendente" },
    { rotulo: "Contratados", chave: "contratados", tom: "compareceu" },
  ] },
];


export function BlocosSdr({ nome, blocos }: { nome: string; blocos: Blocos | undefined }) {
  const { lista, setLista, linhas } = useListaLeads();
  return (
    <div className="space-y-4">
      {BLOCOS.map((b) => (
        <div key={b.titulo}>
          <div className="mb-2 flex flex-wrap items-baseline gap-x-2 border-b border-border/60 pb-1.5">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{b.titulo}</h3>
            <span className="text-[11px] text-muted-foreground/70">{b.ajuda}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {b.itens.map((it) => {
              const ids = blocos?.[it.chave] ?? [];
              const base = b.base ? (blocos?.[b.base] ?? []).length : 0;
              const pct = b.base && it.chave !== b.base && ids.length > 0 ? fmtPct(ids.length, base) : null;
              return (
                <button key={it.chave} type="button" disabled={!ids.length}
                  onClick={() => setLista({ titulo: `${nome} · ${b.titulo} · ${it.rotulo} (${ids.length})`, leadIds: ids })}
                  className={cn("flex flex-col items-start rounded-xl px-3 py-2 text-left transition hover:opacity-85 disabled:cursor-default disabled:hover:opacity-100", TONS[it.tom])}>
                  <span className="text-[11px] font-medium opacity-80">{it.rotulo}</span>
                  <span className="text-xl font-bold tabular-nums">{blocos ? ids.length : "–"}</span>
                  {pct && pct !== "—" ? <span className="text-[11px] leading-tight opacity-75">{pct} do total</span> : null}
                </button>
              );
            })}
          </div>

        </div>
      ))}
      <DialogoLeads lista={lista} linhas={linhas} onClose={() => setLista(null)} />
    </div>
  );
}
