import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DateRangeFilter, getDateRangeFromFilter, type DateRangeFilterValue } from "@/components/ui/date-range-filter";
import { asDateParam } from "@/lib/reportKit";
import {
  buscarRelatorioSdr, fmtInt, fmtMinutos, fmtNota, fmtPct, fmtSegundos, taxaComparecimento,
  type EstadoRpc, type LinhaRelatorioSdr,
} from "@/lib/relatorioSdr";
import {
  AlertTriangle, CalendarCheck, CheckCircle2, Clock, Coffee, Inbox, Info, Loader2,
  MessageSquareText, RefreshCw, Star, Timer, TrendingUp, UserCheck, type LucideIcon,
} from "lucide-react";

/**
 * Meu desempenho — a SDR vê SÓ os próprios números (Fase 5 do rodízio).
 *
 * Fonte única: RPC relatorio_sdr_minha(p_de, p_ate), que no banco exige papel
 * sdr e devolve apenas a linha de auth.uid() — a tela não escolhe de quem
 * ver. Só números agregados: nenhum lead, nenhum telefone.
 *
 * Gate: a rota vive sob /crm/sdr (allowlist da SDR no ProtectedRoute); aqui
 * só evitamos montar uma tela que não funcionaria para outro papel. Enquanto
 * o papel não resolveu, "carregando" — nunca expulsar por negação com o
 * papel ainda nulo (regra da "corrida do papel no boot").
 *
 * Erro nunca vira zero: uma falha de rede e um mês sem lead ficariam
 * idênticos na tela, e ela concluiria que o sistema perdeu o trabalho dela
 * (mesmo cuidado de CloserMetricas).
 */

export default function SdrMeuDesempenho() {
  const { userRole, roleResolved } = useAuth();

  const [periodo, setPeriodo] = useState<DateRangeFilterValue>({ preset: "this_month" });
  const [estado, setEstado] = useState<EstadoRpc<LinhaRelatorioSdr | null>>({ status: "loading" });
  const [recarga, setRecarga] = useState(0);

  const intervalo = useMemo(() => getDateRangeFromFilter(periodo), [periodo]);
  const de = intervalo ? asDateParam(intervalo.start) : null;
  const ate = intervalo ? asDateParam(intervalo.end) : null;

  const carregar = useCallback(async () => {
    if (!de || !ate) return;
    setEstado({ status: "loading" });
    try {
      const linhas = await buscarRelatorioSdr("relatorio_sdr_minha", de, ate);
      // A RPC devolve só a linha de quem chamou; vazio = perfil sem cliente
      // (conta bloqueada), que a tela trata como "sem dados", não como erro.
      setEstado({ status: "ok", data: linhas.find((l) => !l.is_total) ?? null });
    } catch (e) {
      setEstado({ status: "error", message: e instanceof Error ? e.message : "Não foi possível carregar seus números." });
    }
  }, [de, ate]);

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
  const l = estado.status === "ok" ? estado.data : null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-5 pb-10">
        <header className="flex flex-wrap items-center gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
              <TrendingUp size={22} className="text-primary" /> Meu desempenho
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Seus leads, respostas, agendamentos, pesquisa e expediente no período.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <DateRangeFilter value={periodo} onChange={setPeriodo} excludePresets={["all", "multi"]} />
            <Button
              variant="outline" size="sm" title="Atualizar" disabled={carregando}
              onClick={() => setRecarga((n) => n + 1)}
            >
              <RefreshCw size={14} className={carregando ? "animate-spin" : ""} />
            </Button>
          </div>
        </header>

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
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-[108px] rounded-2xl" />
            ))}
          </section>
        ) : !l ? (
          <div className="rounded-2xl border border-border bg-card px-6 py-14 text-center shadow-sm">
            <p className="font-semibold text-foreground">Sem dados para mostrar</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Não encontramos seu cadastro na equipe desta clínica. Fale com quem gere a equipe.
            </p>
          </div>
        ) : (
          <>
            <Grupo titulo="Atendimento">
              <Cartao
                rotulo="Leads recebidos"
                valor={fmtInt(l.leads_recebidos)}
                apoio="chegaram a você no período"
                Icone={Inbox} cor="text-indigo-600 dark:text-indigo-400" fundo="bg-indigo-500/10"
              />
              <Cartao
                rotulo="Respondidos"
                valor={fmtInt(l.leads_respondidos)}
                apoio={l.leads_recebidos > 0 ? `${fmtPct(l.leads_respondidos, l.leads_recebidos)} dos recebidos` : "nenhum lead no período"}
                Icone={CheckCircle2} cor="text-emerald-600 dark:text-emerald-400" fundo="bg-emerald-500/10"
              />
              <Cartao
                rotulo="1ª resposta (mediana)"
                valor={fmtSegundos(l.resp_mediana_seg)}
                apoio={l.resp_amostra > 0 ? `metade em até isso · ${fmtInt(l.resp_amostra)} na amostra` : "sem amostra ainda"}
                Icone={Timer} cor="text-sky-600 dark:text-sky-400" fundo="bg-sky-500/10"
              />
              <Cartao
                rotulo="1ª resposta (média)"
                valor={fmtSegundos(l.resp_media_seg)}
                apoio="uma resposta tardia puxa a média"
                Icone={Clock} cor="text-sky-600 dark:text-sky-400" fundo="bg-sky-500/10"
              />
            </Grupo>

            <Grupo titulo="Consultas no seu crédito">
              <Cartao
                rotulo="Agendamentos"
                valor={fmtInt(l.agendamentos)}
                apoio={l.agend_cancelados > 0 ? `${fmtInt(l.agend_cancelados)} cancelados fora da conta` : "por data agendada"}
                Icone={CalendarCheck} cor="text-violet-600 dark:text-violet-400" fundo="bg-violet-500/10"
              />
              <Cartao
                rotulo="Compareceram"
                valor={fmtInt(l.compareceram)}
                apoio={l.compareceram + l.faltas > 0 ? `${taxaComparecimento(l)} de comparecimento · ${fmtInt(l.faltas)} ${l.faltas === 1 ? "falta" : "faltas"}` : "nenhuma consulta com desfecho"}
                Icone={UserCheck} cor="text-emerald-600 dark:text-emerald-400" fundo="bg-emerald-500/10"
              />
              <Cartao
                rotulo="Conversas fechadas"
                valor={fmtInt(l.conversas_fechadas)}
                apoio="encerradas por você no período"
                Icone={MessageSquareText} cor="text-slate-600 dark:text-slate-300" fundo="bg-slate-500/10"
              />
            </Grupo>

            <Grupo titulo="Satisfação e expediente">
              <Cartao
                rotulo="Pesquisa"
                valor={fmtNota(l.pesquisa_nota_media)}
                apoio={l.pesquisa_respostas > 0 ? `nota média · ${fmtInt(l.pesquisa_respostas)} ${l.pesquisa_respostas === 1 ? "resposta" : "respostas"}` : "nenhuma resposta no período"}
                Icone={Star} cor="text-amber-600 dark:text-amber-400" fundo="bg-amber-500/10"
              />
              <Cartao
                rotulo="Expediente"
                valor={fmtMinutos(l.minutos_expediente)}
                apoio="com o ponto aberto, sem as pausas"
                Icone={Clock} cor="text-teal-600 dark:text-teal-400" fundo="bg-teal-500/10"
              />
              <Cartao
                rotulo="Pausas"
                valor={fmtMinutos(l.minutos_pausa)}
                apoio="café, almoço e outras"
                Icone={Coffee} cor="text-orange-600 dark:text-orange-400" fundo="bg-orange-500/10"
              />
            </Grupo>
          </>
        )}

        <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
          <Info size={14} className="mt-0.5 shrink-0" />
          <p>
            Os números contam o que aconteceu enquanto o lead era seu. O relógio da 1ª resposta é
            corrido (não desconta a noite nem o fim de semana) e começa quando o lead chega a você já
            com mensagem esperando, ou na primeira mensagem recebida depois disso. Agendamentos e
            comparecimentos ficam no crédito de quem era dona do lead quando a consulta foi marcada,
            por data agendada — remarcado não é comparecimento.
          </p>
        </div>
      </div>
    </div>
  );
}

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{titulo}</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>
    </section>
  );
}

function Cartao({
  rotulo, valor, apoio, Icone, cor, fundo,
}: {
  rotulo: string;
  valor: string;
  apoio: string;
  Icone: LucideIcon;
  cor: string;
  fundo: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${fundo} ${cor}`}>
          <Icone size={16} />
        </span>
        <span className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">{rotulo}</span>
      </div>
      <div className="mt-2.5 font-mono text-2xl font-semibold tabular-nums text-foreground">{valor}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{apoio}</div>
    </div>
  );
}
