import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { format, parseISO } from "date-fns";
import {
  CalendarCheck, CalendarX, UserCheck, UserX, Users, Repeat, Ban, Loader2, UserPlus, Clock, AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Ids = string[];
type Dados = {
  chegaram: number;
  agendados: Ids; compareceram: Ids; faltas: Ids; agd_cancelados: Ids; agd_pendentes: Ids; agd_remarcados: Ids;
  remarcados: Ids; rem_compareceram: Ids; rem_faltas: Ids; rem_cancelados: Ids; rem_pendentes: Ids;
  geral_agendados: Ids; geral_compareceram: Ids; geral_faltas: Ids; cancelados: Ids; geral_pendentes: Ids;
  falta_sem_remarcacao: Ids; falta_novamente: Ids; falta_periodo_anterior: Ids;
  pend_agendamento_futuro: Ids; pend_remarcacao_futura: Ids; pend_hoje: Ids; pend_sem_resultado: Ids;
  outros_agendamentos: Ids;
};

type Detalhe = {
  lead_id: string; nome: string | null; telefone: string | null; cidade: string | null; servico: string | null;
  origem: string | null; responsavel: string | null; primeiro: string | null; ultima_remarcacao: string | null;
  ultimo: string | null; ultimo_status: string | null;
};

const STATUS: Record<string, string> = {
  contracted: "Compareceu (fechou)", not_contracted: "Compareceu (não fechou)", no_show: "Faltou",
  cancelled: "Cancelou", confirmed: "Confirmado", scheduled: "Agendado", pending: "Agendado",
};

type Tom = "primary" | "success" | "destructive" | "purple" | "slate" | "info" | "warning";
const TOM: Record<Tom, string> = {
  primary: "bg-primary-soft text-primary-soft-fg",
  success: "bg-success-soft text-success-soft-foreground",
  destructive: "bg-destructive-soft text-destructive-soft-foreground",
  purple: "bg-purple-soft text-purple-soft-foreground",
  slate: "bg-slate-soft text-slate-soft-foreground",
  info: "bg-info-soft text-info-soft-foreground",
  warning: "bg-warning-soft text-warning-soft-foreground",
};

function Kpi({ label, value, icon: Icon, tom, onClick, hint }: {
  label: string; value: number | null; icon: LucideIcon; tom: Tom; onClick?: () => void; hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick || !value}
      className="text-left rounded-2xl border border-border/60 bg-card p-5 shadow-card transition hover:shadow-md disabled:cursor-default disabled:hover:shadow-card"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm text-muted-foreground leading-snug">{label}</span>
        <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", TOM[tom])}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-3 text-[30px] font-bold leading-none tabular-nums text-foreground">
        {value === null ? "—" : value.toLocaleString("pt-BR")}
      </div>
      {hint && <p className="mt-2 text-xs text-muted-foreground">{hint}</p>}
    </button>
  );
}

const dt = (d: string | null) => (d ? format(parseISO(d), "dd/MM/yy") : "—");
const GRID5 = "grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5";

export default function RelatorioAgendamentos({ range }: { range: [Date, Date] }) {
  const navigate = useNavigate();
  const [dados, setDados] = useState<Dados | null>(null);
  const [loading, setLoading] = useState(false);
  const [lista, setLista] = useState<{ titulo: string; ids: string[]; situacao?: string } | null>(null);
  const [linhas, setLinhas] = useState<Detalhe[] | null>(null);

  const inicio = format(range[0], "yyyy-MM-dd");
  const fim = format(range[1], "yyyy-MM-dd");

  useEffect(() => {
    let vivo = true;
    setLoading(true);
    (supabase.rpc as any)("relatorio_agendamentos", { _inicio: inicio, _fim: fim }).then(({ data, error }: any) => {
      if (!vivo) return;
      if (!error) setDados(data as Dados);
      setLoading(false);
    });
    return () => { vivo = false; };
  }, [inicio, fim]);

  useEffect(() => {
    if (!lista) return;
    setLinhas(null);
    (supabase.rpc as any)("relatorio_agendamentos_detalhe", { _ids: lista.ids })
      .then(({ data }: any) => setLinhas((data || []) as Detalhe[]));
  }, [lista]);

  const n = (k: keyof Dados) => (dados ? (Array.isArray(dados[k]) ? (dados[k] as Ids).length : (dados[k] as number)) : null);
  const abrir = (titulo: string, k: keyof Dados, situacao?: string) => () =>
    dados && setLista({ titulo, ids: dados[k] as Ids, situacao });

  const somaFaltas = dados ? dados.falta_sem_remarcacao.length + dados.falta_novamente.length + dados.falta_periodo_anterior.length : 0;
  const somaGeral = dados
    ? dados.geral_compareceram.length + dados.geral_faltas.length + dados.cancelados.length + dados.geral_pendentes.length
    : 0;
  const naoFecha = dados && (somaGeral !== dados.geral_agendados.length || somaFaltas !== dados.geral_faltas.length);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        <div className="relative">
          <Kpi label="Leads que chegaram" value={n("chegaram")} icon={UserPlus} tom="info" />
          {loading && <Loader2 className="absolute right-4 top-4 h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
      </div>

      {naoFecha && (
        <div className="flex items-center gap-2 rounded-xl bg-destructive-soft px-4 py-3 text-sm text-destructive-soft-foreground">
          <AlertTriangle className="h-4 w-4" /> As contas do bloco Geral não fecham neste período. Avise o suporte.
        </div>
      )}

      <section className="rounded-2xl bg-card p-5 shadow-sm space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Agendados (primeiro agendamento)</h2>
        <div className={GRID5}>
          <Kpi label="Agendados" value={n("agendados")} icon={CalendarCheck} tom="primary" onClick={abrir("Agendados", "agendados")} hint="Resultado só da primeira consulta" />
          <Kpi label="Compareceram" value={n("compareceram")} icon={UserCheck} tom="success" onClick={abrir("Agendados que compareceram", "compareceram")} />
          <Kpi label="Faltas" value={n("faltas")} icon={UserX} tom="destructive" onClick={abrir("Faltas dos agendados", "faltas")} hint="Cada lead conta uma vez" />
          <Kpi label="Cancelamentos" value={n("agd_cancelados")} icon={Ban} tom="slate" onClick={abrir("Cancelamentos dos agendados", "agd_cancelados")} hint="Avisou que não iria" />
          <Kpi label="Pendentes" value={n("agd_pendentes")} icon={Clock} tom="warning" onClick={abrir("Pendentes dos agendados", "agd_pendentes")} hint="Sem resultado ainda" />
        </div>
        {dados && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <button type="button" disabled={!n("agd_remarcados")}
              onClick={abrir("Primeira consulta remarcada", "agd_remarcados")}
              className="rounded-full bg-purple-soft px-2.5 py-1 font-medium text-purple-soft-foreground disabled:opacity-50">
              Primeira consulta remarcada: {n("agd_remarcados")}
            </button>
            <span>O resultado desses leads aparece em Remarcados.</span>
          </div>
        )}
      </section>

      <section className="rounded-2xl bg-card p-5 shadow-sm space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Remarcados</h2>
        <div className={GRID5}>
          <Kpi label="Remarcados" value={n("remarcados")} icon={Repeat} tom="purple" onClick={abrir("Remarcados", "remarcados")} />
          <Kpi label="Compareceram" value={n("rem_compareceram")} icon={UserCheck} tom="success" onClick={abrir("Remarcados que compareceram", "rem_compareceram")} />
          <Kpi label="Faltas" value={n("rem_faltas")} icon={UserX} tom="destructive" onClick={abrir("Faltas dos remarcados", "rem_faltas")} hint="Cada lead conta uma vez" />
          <Kpi label="Cancelamentos" value={n("rem_cancelados")} icon={CalendarX} tom="slate" onClick={abrir("Cancelamentos dos remarcados", "rem_cancelados")} />
          <Kpi label="Pendentes" value={n("rem_pendentes")} icon={Clock} tom="warning" onClick={abrir("Pendentes dos remarcados", "rem_pendentes")} />
        </div>
        {dados && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Auditoria:</span>
            <button type="button" disabled={!n("outros_agendamentos")}
              onClick={abrir("Outros agendamentos de leads com histórico", "outros_agendamentos", "Nova consulta sem usar remarcação")}
              className="rounded-full bg-slate-soft px-2.5 py-1 font-medium text-slate-soft-foreground disabled:opacity-50">
              Outros agendamentos de leads com histórico: {n("outros_agendamentos")}
            </button>
            <span>Consulta nova criada sem usar a função de remarcar. Já incluídos em Remarcados.</span>
          </div>
        )}
      </section>

      <section className="rounded-2xl bg-card p-5 shadow-sm space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Geral</h2>
        <div className={GRID5}>
          <Kpi label="Leads agendados" value={n("geral_agendados")} icon={Users} tom="primary" onClick={abrir("Leads agendados (geral)", "geral_agendados")} hint="Cada lead uma vez" />
          <Kpi label="Comparecimentos" value={n("geral_compareceram")} icon={UserCheck} tom="success" onClick={abrir("Comparecimentos (geral)", "geral_compareceram")} />
          <Kpi label="Faltas" value={n("geral_faltas")} icon={UserX} tom="destructive" onClick={abrir("Faltas (geral)", "geral_faltas")} />
          <Kpi label="Cancelamentos" value={n("cancelados")} icon={Ban} tom="slate" onClick={abrir("Cancelamentos", "cancelados")} />
          <Kpi label="Pendentes" value={n("geral_pendentes")} icon={Clock} tom="warning" onClick={abrir("Pendentes (geral)", "geral_pendentes")} />
        </div>
        {dados && (
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span>Pendentes por motivo:</span>
            {([
              ["Agendamento futuro", "pend_agendamento_futuro"],
              ["Remarcação futura", "pend_remarcacao_futura"],
              ["Consulta hoje", "pend_hoje"],
              ["Agendamento sem resultado", "pend_sem_resultado"],
            ] as [string, keyof Dados][]).map(([t, k]) => (
              <button key={k} type="button" disabled={!n(k)} onClick={abrir(t, k, t)}
                className="rounded-full bg-warning-soft px-2.5 py-1 font-medium text-warning-soft-foreground disabled:opacity-50">
                {t}: {n(k)}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl bg-card p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-foreground">Relatório de Faltas</h2>
          <span className="text-sm text-muted-foreground">Total de faltas: <b className="text-foreground tabular-nums">{n("geral_faltas") ?? "—"}</b></span>
        </div>
        <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
          <Kpi label="Faltaram e não foram remarcados" value={n("falta_sem_remarcacao")} icon={UserX} tom="destructive" onClick={abrir("Faltaram e não foram remarcados", "falta_sem_remarcacao", "Faltou, sem remarcação")} />
          <Kpi label="Remarcados que faltaram novamente" value={n("falta_novamente")} icon={Repeat} tom="destructive" onClick={abrir("Remarcados que faltaram novamente", "falta_novamente", "Faltou novamente")} />
          <Kpi label="Remarcados de período anterior que faltaram" value={n("falta_periodo_anterior")} icon={CalendarX} tom="destructive" onClick={abrir("Remarcados de período anterior que faltaram", "falta_periodo_anterior", "Remarcado de antes, faltou")} />
        </div>
      </section>

      <Dialog open={!!lista} onOpenChange={(o) => !o && setLista(null)}>
        <DialogContent className="rounded-2xl max-w-5xl">
          <DialogHeader>
            <DialogTitle>{lista?.titulo} ({lista?.ids.length ?? 0})</DialogTitle>
          </DialogHeader>
          <div className="max-h-[65vh] overflow-auto rounded-xl border border-border/60">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="sticky top-0 bg-surface-sunken text-xs text-muted-foreground">
                <tr className="text-left">
                  {["Lead", "Cidade", "Serviço", "Origem", "Responsável", "1º agend.", "Últ. remarcação", "Últ. agend.", "Situação", ""].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {linhas?.map((l) => (
                  <tr key={l.lead_id}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-foreground">{l.nome || "Sem nome"}</div>
                      <div className="text-xs text-muted-foreground">{l.telefone}</div>
                    </td>
                    <td className="px-3 py-2">{l.cidade || "—"}</td>
                    <td className="px-3 py-2">{l.servico || "—"}</td>
                    <td className="px-3 py-2">{l.origem || "—"}</td>
                    <td className="px-3 py-2">{l.responsavel || "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{dt(l.primeiro)}</td>
                    <td className="px-3 py-2 tabular-nums">{dt(l.ultima_remarcacao)}</td>
                    <td className="px-3 py-2 tabular-nums">{dt(l.ultimo)}</td>
                    <td className="px-3 py-2">{lista?.situacao || (l.ultimo_status ? STATUS[l.ultimo_status] || l.ultimo_status : "—")}</td>
                    <td className="px-3 py-2">
                      <Button size="sm" variant="outline" className="rounded-xl"
                        onClick={() => navigate(`../conversas?lead=${l.lead_id}`, { relative: "path" })}>
                        Ver conversa
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!linhas && <p className="py-6 text-center text-sm text-muted-foreground">Carregando…</p>}
            {linhas && lista && linhas.length !== lista.ids.length && (
              <p className="py-3 text-center text-sm text-destructive">
                A lista trouxe {linhas.length} de {lista.ids.length} leads. Avise o suporte.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
