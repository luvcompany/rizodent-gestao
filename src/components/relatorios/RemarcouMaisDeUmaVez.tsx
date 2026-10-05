import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/crm-ui";
import { cn } from "@/lib/utils";
import { dataBR } from "@/lib/exportacaoRelatorios";
import { CalendarClock, MessageCircle } from "lucide-react";

type Consulta = { data: string; hora: string | null; status: string; sdr: string | null };
type Linha = { lead_id: string; lead_nome: string; sdr_nome: string | null; qtd_remarcacoes: number; consultas: Consulta[] };

const STATUS: Record<string, { rotulo: string; tom: string }> = {
  rescheduled: { rotulo: "Remarcou", tom: "bg-purple-soft text-purple-soft-foreground" },
  no_show: { rotulo: "Faltou", tom: "bg-destructive-soft text-destructive-soft-foreground" },
  cancelled: { rotulo: "Cancelou", tom: "bg-muted text-muted-foreground" },
  contracted: { rotulo: "Contratou", tom: "bg-success-soft text-success-soft-foreground" },
  not_contracted: { rotulo: "Compareceu", tom: "bg-success-soft text-success-soft-foreground" },
};
const PENDENTE = { rotulo: "Pendente", tom: "bg-warning-soft text-warning-soft-foreground" };

export function RemarcouMaisDeUmaVez({ de, ate }: { de: string | null; ate: string | null }) {
  const navigate = useNavigate();
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!de || !ate) return;
    setLinhas(null); setErro(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc("relatorio_sdr_multi_remarcacoes", { p_de: de, p_ate: ate }).then(({ data, error }: any) => {
      if (error) setErro(error.message); else setLinhas((data ?? []) as Linha[]);
    });
  }, [de, ate]);

  if (erro) return <p className="rounded-2xl border border-border/60 bg-card px-6 py-8 text-sm text-destructive shadow-card">{erro}</p>;
  if (!linhas) return <Skeleton className="h-[320px] rounded-2xl" />;
  if (!linhas.length) return <EmptyState icon={CalendarClock} title="Nenhum lead remarcou mais de uma vez" description="No período escolhido, nenhum lead tem duas ou mais remarcações." />;

  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-card">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-muted/60 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">Lead</th>
              <th className="px-4 py-2.5 text-left font-medium">SDR</th>
              <th className="px-4 py-2.5 text-right font-medium">Remarcações</th>
              <th className="px-4 py-2.5 text-left font-medium">Datas agendadas</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.lead_id} className="border-t border-border/60 align-top">
                <td className="px-4 py-3 font-medium text-foreground">{l.lead_nome}</td>
                <td className="px-4 py-3 text-muted-foreground">{l.sdr_nome ?? "—"}</td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums">{l.qtd_remarcacoes}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    {l.consultas.map((c, i) => {
                      const s = STATUS[c.status] ?? PENDENTE;
                      return (
                        <span key={i} className={cn("whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-medium", s.tom)}
                          title={c.sdr ? `Crédito: ${c.sdr}` : undefined}>
                          {dataBR(c.data)}{c.hora ? ` ${c.hora.slice(0, 5)}` : ""} · {s.rotulo}
                        </span>
                      );
                    })}
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <Button size="sm" variant="outline" className="h-8 rounded-xl px-2.5 text-xs"
                    onClick={() => navigate(`../../conversas?lead=${l.lead_id}`, { relative: "path" })}>
                    <MessageCircle size={13} className="mr-1 shrink-0" /> Ver conversa
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
