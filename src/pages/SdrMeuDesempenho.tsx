import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DateRangeFilter, getDateRangeFromFilter, type DateRangeFilterValue } from "@/components/ui/date-range-filter";
import { asDateParam } from "@/lib/reportKit";
import {
  buscarLigacoesSdr, buscarReagendamentosSdr, buscarRelatorioSdr, fmtInt, fmtMinutos, fmtNota, fmtPct, fmtSegundos, juntarReagendamentos, taxaComparecimento,
  type EstadoRpc, type LigacoesSdr, type LinhaRelatorioSdr,
} from "@/lib/relatorioSdr";
import { AlertTriangle, CalendarCheck2, CheckCircle2, Clock3, Headphones, Info, Loader2, Phone, RefreshCw, Users } from "lucide-react";
import { EmptyState, KpiCard, PageHeader, SectionCard } from "@/components/crm-ui";

/**
 * Meu desempenho — a SDR vê SÓ os próprios números (Fase 5 do rodízio).
 *
 * Fontes: RPC relatorio_sdr_minha(p_de, p_ate) (só a linha de auth.uid(); sem
 * contratos — o ciclo dela termina no comparecimento) e relatorio_sdr_ligacoes
 * (ligações feitas, atendidas pelo lead e duração média). Só agregados.
 *
 * Gate: enquanto o papel não resolveu, "carregando" — nunca expulsar por
 * negação com o papel nulo (corrida do papel no boot). Erro nunca vira zero.
 */

type Dados = { l: LinhaRelatorioSdr | null; lig: LigacoesSdr | null };

export default function SdrMeuDesempenho() {
  const { userRole, roleResolved, user } = useAuth();

  const [periodo, setPeriodo] = useState<DateRangeFilterValue>({ preset: "this_month" });
  const [estado, setEstado] = useState<EstadoRpc<Dados>>({ status: "loading" });
  const [recarga, setRecarga] = useState(0);

  const intervalo = useMemo(() => getDateRangeFromFilter(periodo), [periodo]);
  const de = intervalo ? asDateParam(intervalo.start) : null;
  const ate = intervalo ? asDateParam(intervalo.end) : null;

  const carregar = useCallback(async () => {
    if (!de || !ate) return;
    setEstado({ status: "loading" });
    try {
      const [linhas, ligacoes, extras] = await Promise.all([
        buscarRelatorioSdr("relatorio_sdr_minha", de, ate),
        buscarLigacoesSdr(de, ate),
        buscarReagendamentosSdr(de, ate),
      ]);
      setEstado({
        status: "ok",
        data: {
          l: juntarReagendamentos(linhas, extras).find((x) => !x.is_total) ?? null,
          lig: ligacoes.find((x) => !user?.id || x.user_id === user.id) ?? null,
        },
      });
    } catch (e) {
      setEstado({ status: "error", message: e instanceof Error ? e.message : "Não foi possível carregar seus números." });
    }
  }, [de, ate, user?.id]);

  useEffect(() => {
    if (roleResolved && userRole === "sdr") void carregar();
  }, [roleResolved, userRole, carregar, recarga]);

  if (!roleResolved) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 animate-spin" size={16} /> Carregando...
      </div>
    );
  }
  if (userRole !== "sdr") return <Navigate to="/crm" replace />;

  const carregando = estado.status === "loading";
  const l = estado.status === "ok" ? estado.data.l : null;
  const lig = estado.status === "ok" ? estado.data.lig : null;
  const feitas = lig?.ligacoes_feitas ?? 0;
  const atendidas = lig?.ligacoes_atendidas ?? 0;

  return (
    <div>
      <div className="mx-auto flex max-w-[1000px] flex-col gap-6 pb-10">
        <PageHeader
          title="Meu desempenho"
          subtitle="O que aconteceu com os seus leads no período."
          actions={<><DateRangeFilter value={periodo} onChange={setPeriodo} excludePresets={["all", "multi"]} /><Button variant="outline" size="icon" title="Atualizar" disabled={carregando} onClick={() => setRecarga((n) => n + 1)}><RefreshCw size={16} className={carregando ? "animate-spin" : ""} /></Button></>}
        />

        {estado.status === "error" ? (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-destructive/50 bg-destructive/5 px-5 py-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
            <div className="min-w-[200px] flex-1">
              <p className="text-sm font-medium text-destructive">Não foi possível carregar seus números</p>
              <p className="mt-0.5 break-words text-xs text-muted-foreground">{estado.message}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setRecarga((n) => n + 1)}>Tentar novamente</Button>
          </div>
        ) : estado.status === "loading" ? (
          <>
            <Skeleton className="h-[120px] rounded-2xl" />
            <div className="grid gap-4 md:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[190px] rounded-2xl" />)}
            </div>
          </>
        ) : !l ? (
          <EmptyState icon={Info} title="Sem dados para mostrar" description="Não encontramos seu cadastro na equipe desta clínica. Fale com quem gere a equipe." />
        ) : (
          <>
            <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard label="Leads recebidos" value={fmtInt(l.leads_recebidos)} detail="chegaram a você" icon={Users} tone="info" />
              <KpiCard label="Agendamentos" value={fmtInt(l.agendamentos)} detail="no seu crédito" icon={CalendarCheck2} tone="primary" />
              <KpiCard label="Compareceram" value={fmtInt(l.compareceram)} detail={l.compareceram + l.faltas > 0 ? `${taxaComparecimento(l)} de comparecimento` : "nenhuma consulta com desfecho"} icon={CheckCircle2} tone="success" />
              <KpiCard label="Ligações feitas" value={fmtInt(feitas)} detail={feitas > 0 ? `${fmtPct(atendidas, feitas)} atendidas pelo lead` : "nenhuma no período"} icon={Phone} tone="purple" />
            </section>

            <div className="grid gap-4 md:grid-cols-2">
              <SectionCard title="Atendimento" icon={Headphones} contentClassName="divide-y divide-border/60">
                <Linha rotulo="Respondidos" valor={fmtInt(l.leads_respondidos)} apoio={l.leads_recebidos > 0 ? `${fmtPct(l.leads_respondidos, l.leads_recebidos)} dos recebidos` : undefined} />
                <Linha rotulo="1ª resposta (mediana)" valor={fmtSegundos(l.resp_mediana_seg)} apoio={l.resp_amostra > 0 ? `${fmtInt(l.resp_amostra)} na amostra` : "sem amostra"} />
                <Linha rotulo="1ª resposta (média)" valor={fmtSegundos(l.resp_media_seg)} />
                <Linha rotulo="Conversas fechadas" valor={fmtInt(l.conversas_fechadas)} />
              </SectionCard>

              <SectionCard title="Consultas no seu crédito" icon={CalendarCheck2} contentClassName="divide-y divide-border/60">
                <Linha rotulo="Agendamentos" valor={fmtInt(l.agendamentos)} apoio="pelo dia em que você marcou" />
                <Linha rotulo="Compareceram" valor={fmtInt(l.compareceram)} apoio={l.compareceram + l.faltas > 0 ? taxaComparecimento(l) : undefined} />
                <Linha rotulo="Faltas" valor={fmtInt(l.faltas)} />
                <Linha rotulo="Reagendamentos" valor={typeof l.reagendamentos === "number" ? fmtInt(l.reagendamentos) : "—"} apoio="pelo dia em que você remarcou" />
                <Linha rotulo="Reagendou e faltou" valor={typeof l.faltas_apos_reagendar === "number" ? fmtInt(l.faltas_apos_reagendar) : "—"} apoio="faltou de novo depois de remarcar" />
                <Linha rotulo="Leads com 2+ faltas" valor={typeof l.leads_2_faltas === "number" ? fmtInt(l.leads_2_faltas) : "—"} />
                <Linha rotulo="Cancelados" valor={fmtInt(l.agend_cancelados)} apoio="avisaram que não viriam — contam como agendamento" />
              </SectionCard>

              <SectionCard title="Ligações" icon={Phone} contentClassName="divide-y divide-border/60">
                <Linha rotulo="Feitas" valor={fmtInt(feitas)} apoio={lig ? `${fmtInt(lig.telefonia_feitas)} telefonia · ${fmtInt(lig.whatsapp_feitas)} WhatsApp` : undefined} />
                <Linha rotulo="Atendidas pelo lead" valor={fmtInt(atendidas)} apoio={feitas > 0 ? `${fmtPct(atendidas, feitas)} das feitas` : undefined} />
                <Linha rotulo="Duração média" valor={atendidas > 0 ? fmtSegundos(lig?.duracao_media_seg ?? 0) : "—"} apoio="das atendidas" />
              </SectionCard>

              <SectionCard title="Expediente e satisfação" icon={Clock3} contentClassName="divide-y divide-border/60">
                <Linha rotulo="Expediente" valor={fmtMinutos(l.minutos_expediente)} apoio="com o ponto aberto, sem pausas" />
                <Linha rotulo="Pausas" valor={fmtMinutos(l.minutos_pausa)} apoio="café, almoço e outras" />
                <Linha rotulo="Pesquisa de satisfação" valor={fmtNota(l.pesquisa_nota_media)} apoio={l.pesquisa_respostas > 0 ? `${fmtInt(l.pesquisa_respostas)} ${l.pesquisa_respostas === 1 ? "resposta" : "respostas"}` : "sem respostas"} />
              </SectionCard>
            </div>
          </>
        )}

        <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
          <Info size={14} className="mt-0.5 shrink-0" />
          <p>
            Os números contam o que aconteceu enquanto o lead era seu, e continuam seus mesmo depois
            de o lead passar para o administrador. <strong>Agendamentos contam pelo dia em que você
            marcou</strong>, não pelo dia da consulta: no filtro de hoje, "Compareceram" e "Faltas"
            ficam baixos porque a consulta que você marcou hoje ainda não aconteceu — as duas colunas
            acompanham as mesmas consultas desta linha. Para ver quantas consultas ACONTECEM no
            período, use o Calendário. O relógio da 1ª resposta é corrido, sem descontar noite e fim
            de semana.
          </p>
        </div>
      </div>
    </div>
  );
}

function Linha({ rotulo, valor, apoio }: { rotulo: string; valor: string; apoio?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <div className="text-sm text-foreground">{rotulo}</div>
        {apoio && <div className="text-xs text-muted-foreground">{apoio}</div>}
      </div>
      <div className="font-mono text-lg font-semibold tabular-nums text-foreground">{valor}</div>
    </div>
  );
}
