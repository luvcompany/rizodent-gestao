import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useGestorEquipe } from "@/hooks/useGestorEquipe";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateRangeFilter, getDateRangeFromFilter, type DateRangeFilterValue } from "@/components/ui/date-range-filter";
import { asDateParam } from "@/lib/reportKit";
import {
  buscarReagendamentosSdr, buscarRelatorioSdr, fmtInt, fmtMinutos, fmtNota, fmtPct, fmtSegundos, juntarReagendamentos, taxaComparecimento,
  type EstadoRpc, type LinhaRelatorioSdr,
} from "@/lib/relatorioSdr";
import { AlertTriangle, BarChart3, Info, Loader2, RefreshCw, Users } from "lucide-react";

/**
 * Relatório por SDR — visão do GESTOR da equipe (Fase 5 do rodízio).
 *
 * Quem entra: só quem `is_gestor_equipe()` devolve true (superadmin ou o gestor
 * NOMEADO em crm_rodizio_config.gestor_user_id) — o mesmo gate da aba Equipe,
 * porque /crm/equipe* não está em nenhuma allowlist do ProtectedRoute: a
 * tranca de verdade é a RPC `relatorio_sdr`, que repete a checagem no banco.
 *
 * Fonte única: RPC relatorio_sdr(p_de, p_ate) — uma linha por SDR (ordem
 * alfabética) e a linha "Equipe (total)" por último (is_total). Só números
 * agregados: nenhum lead aparece aqui. Zero SDRs = lista vazia com aviso.
 *
 * Números nunca viram zero silencioso: ou carrega, ou mostra o dado, ou mostra
 * o erro com "Tentar novamente" (mesmo princípio de CrmRelatorios).
 */

type Coluna = {
  chave: string;
  titulo: string;
  dica: string;
  render: (l: LinhaRelatorioSdr) => React.ReactNode;
  /** Texto pequeno abaixo do valor. */
  apoio?: (l: LinhaRelatorioSdr) => React.ReactNode;
};

const COLUNAS: Coluna[] = [
  {
    chave: "recebidos",
    titulo: "Recebidos",
    dica: "Leads que chegaram a ela no período (distribuição do rodízio, transferência ou criação).",
    render: (l) => fmtInt(l.leads_recebidos),
  },
  {
    chave: "respondidos",
    titulo: "Respondidos",
    dica: "Leads recebidos que receberam ao menos uma mensagem humana enquanto eram dela.",
    render: (l) => fmtInt(l.leads_respondidos),
    apoio: (l) => fmtPct(l.leads_respondidos, l.leads_recebidos),
  },
  {
    chave: "mediana",
    titulo: "1ª resposta (mediana)",
    dica: "Tempo até a primeira resposta humana, relógio corrido. Metade dos leads foi respondida em até este tempo.",
    render: (l) => fmtSegundos(l.resp_mediana_seg),
    apoio: (l) => (l.resp_amostra > 0 ? `${fmtInt(l.resp_amostra)} na amostra` : "sem amostra"),
  },
  {
    chave: "media",
    titulo: "1ª resposta (média)",
    dica: "Média do mesmo tempo. Uma resposta muito tardia puxa a média para cima; a mediana não.",
    render: (l) => fmtSegundos(l.resp_media_seg),
  },
  {
    chave: "agendamentos",
    titulo: "Agendamentos",
    dica: "Consultas que ela MARCOU no período, menos as canceladas. Conta pelo dia em que ela agendou, não pelo dia da consulta — o trabalho dela acontece quando marca.",
    render: (l) => fmtInt(l.agendamentos),
    apoio: (l) => (l.agend_cancelados > 0 ? `${fmtInt(l.agend_cancelados)} cancelados` : null),
  },
  {
    chave: "compareceram",
    titulo: "Compareceram",
    dica: "Das consultas que ela marcou no período, quantas o paciente compareceu (contratados + não contratados). Remarcado não é comparecimento. No filtro de hoje fica baixo: a consulta marcada hoje ainda não aconteceu.",
    render: (l) => fmtInt(l.compareceram),
    apoio: (l) => (l.compareceram + l.faltas > 0 ? `${taxaComparecimento(l)} de comparecimento` : null),
  },
  {
    chave: "faltas",
    titulo: "Faltas",
    dica: "Das consultas que ela marcou no período, quantas o paciente faltou. Como o comparecimento, só aparece depois que a consulta chega.",
    render: (l) => fmtInt(l.faltas),
  },
  {
    chave: "reagendamentos",
    titulo: "Reagendamentos",
    dica: "Consultas remarcadas (ligadas à consulta anterior) que ela REMARCOU no período — conta pelo dia em que ela remarcou, não pelo dia da consulta nova.",
    render: (l) => (typeof l.reagendamentos === "number" ? fmtInt(l.reagendamentos) : "—"),
  },
  {
    chave: "faltas_reag",
    titulo: "Reagendou e faltou",
    dica: "Faltas em consulta que já era reagendamento: o lead remarcou e faltou de novo.",
    render: (l) => (typeof l.faltas_apos_reagendar === "number" ? fmtInt(l.faltas_apos_reagendar) : "—"),
  },
  {
    chave: "leads_2_faltas",
    titulo: "Leads com 2+ faltas",
    dica: "Leads que faltaram duas ou mais vezes em consultas que ELA MARCOU no período — mesma coorte das outras colunas. Não é o histórico do paciente: quem faltou em agosto e de novo em setembro só aparece se as duas consultas foram marcadas dentro do período.",
    render: (l) => (typeof l.leads_2_faltas === "number" ? fmtInt(l.leads_2_faltas) : "—"),
  },
  {
    chave: "contratados",
    titulo: "Contratados",
    dica: "Consultas do crédito dela que fecharam tratamento.",
    render: (l) => fmtInt(l.contratados),
    apoio: (l) => (l.compareceram > 0 ? `${fmtPct(l.contratados, l.compareceram)} dos que compareceram` : null),
  },
  {
    chave: "fechadas",
    titulo: "Conversas fechadas",
    dica: "Conversas encerradas por ela no período (botão Fechar conversa).",
    render: (l) => fmtInt(l.conversas_fechadas),
  },
  {
    chave: "pesquisa",
    titulo: "Pesquisa",
    dica: "Nota média da pesquisa de satisfação respondida no período, creditada a ela.",
    render: (l) => fmtNota(l.pesquisa_nota_media),
    apoio: (l) => (l.pesquisa_respostas > 0 ? `${fmtInt(l.pesquisa_respostas)} ${l.pesquisa_respostas === 1 ? "resposta" : "respostas"}` : "sem respostas"),
  },
  {
    chave: "expediente",
    titulo: "Expediente",
    dica: "Tempo com o ponto aberto no período, já descontadas as pausas.",
    render: (l) => fmtMinutos(l.minutos_expediente),
  },
  {
    chave: "pausa",
    titulo: "Pausas",
    dica: "Tempo em pausa (café, almoço, outro) no período.",
    render: (l) => fmtMinutos(l.minutos_pausa),
  },
];

export default function CrmRelatorioSdr() {
  const { isGestor, resolved, erro: erroGestor, tentarDeNovo } = useGestorEquipe();

  const [periodo, setPeriodo] = useState<DateRangeFilterValue>({ preset: "this_month" });
  const [estado, setEstado] = useState<EstadoRpc<LinhaRelatorioSdr[]>>({ status: "loading" });
  const [recarga, setRecarga] = useState(0);

  const intervalo = useMemo(() => getDateRangeFromFilter(periodo), [periodo]);
  const de = intervalo ? asDateParam(intervalo.start) : null;
  const ate = intervalo ? asDateParam(intervalo.end) : null;

  const carregar = useCallback(async () => {
    if (!de || !ate) return;
    setEstado({ status: "loading" });
    try {
      const [linhas, extras] = await Promise.all([buscarRelatorioSdr("relatorio_sdr", de, ate), buscarReagendamentosSdr(de, ate)]);
      setEstado({ status: "ok", data: juntarReagendamentos(linhas, extras) });
    } catch (e) {
      setEstado({ status: "error", message: e instanceof Error ? e.message : "Não foi possível carregar o relatório." });
    }
  }, [de, ate]);

  useEffect(() => {
    if (resolved && isGestor) void carregar();
  }, [resolved, isGestor, carregar, recarga]);

  // --------------------------------------------------------------- gate
  // Só `false` vindo do banco fecha a rota. Erro de rede/5xx na RPC NÃO é
  // "não é gestor": fica em carregando com "Tentar de novo" (nunca expulsar
  // por uma decisão tomada por negação sobre um estado de erro).
  if (!resolved) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        {erroGestor ? (
          <>
            <p className="text-sm">Não foi possível confirmar sua permissão para ver o relatório da equipe.</p>
            <Button variant="outline" size="sm" onClick={tentarDeNovo}>
              <RefreshCw size={14} className="mr-1" /> Tentar de novo
            </Button>
          </>
        ) : (
          <span className="flex items-center"><Loader2 className="mr-2 animate-spin" size={16} /> Carregando...</span>
        )}
      </div>
    );
  }
  if (!isGestor) return <Navigate to="/crm" replace />;

  const linhas = estado.status === "ok" ? estado.data : [];
  const sdrs = linhas.filter((l) => !l.is_total);
  const total = linhas.find((l) => l.is_total) ?? null;
  const carregando = estado.status === "loading";

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-5 pb-10">
        <header className="flex flex-wrap items-center gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
              <BarChart3 size={22} className="text-primary" /> Relatório por SDR
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Leads, respostas, agendamentos, pesquisa e expediente de cada SDR no período.{" "}
              <Link to="/crm/equipe" className="underline underline-offset-2 hover:text-foreground">Ver a equipe</Link>
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

        <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          {estado.status === "error" ? (
            <div className="flex flex-wrap items-center gap-3 px-6 py-10">
              <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
              <div className="min-w-[200px] flex-1">
                <p className="text-sm font-medium text-destructive">Não foi possível carregar o relatório</p>
                <p className="mt-0.5 break-words text-xs text-muted-foreground">{estado.message}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setRecarga((n) => n + 1)}>Tentar novamente</Button>
            </div>
          ) : estado.status === "loading" ? (
            <div className="space-y-3 p-6">
              <Skeleton className="h-5 w-1/3" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : sdrs.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary/10">
                <Users className="text-primary" size={22} />
              </div>
              <p className="mt-3 font-semibold text-foreground">Nenhuma SDR cadastrada</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                O relatório aparece assim que a primeira SDR for criada na aba Equipe.
              </p>
              <Button size="sm" variant="outline" className="mt-4" asChild>
                <Link to="/crm/equipe"><Users size={14} className="mr-1" /> Abrir a Equipe</Link>
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[1240px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 z-10 bg-card">SDR</TableHead>
                    {COLUNAS.map((c) => (
                      <TableHead key={c.chave} className="whitespace-nowrap text-right" title={c.dica}>
                        {c.titulo}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sdrs.map((l) => (
                    <TableRow key={l.user_id ?? l.nome} className={l.bloqueada ? "opacity-70" : ""}>
                      <TableCell className="sticky left-0 z-10 bg-card">
                        <div className="flex flex-col gap-1">
                          <span className="font-medium text-foreground">{l.nome}</span>
                          <span className="text-xs text-muted-foreground">{l.email}</span>
                          <span className="flex flex-wrap gap-1">
                            {l.bloqueada && <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">Bloqueada</Badge>}
                            {!l.bloqueada && l.no_rodizio === false && (
                              <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-muted-foreground">Fora do rodízio</Badge>
                            )}
                          </span>
                        </div>
                      </TableCell>
                      {COLUNAS.map((c) => (
                        <CelulaNumero key={c.chave} valor={c.render(l)} apoio={c.apoio?.(l)} />
                      ))}
                    </TableRow>
                  ))}
                  {total && (
                    <TableRow className="border-t-2 border-border bg-muted font-semibold hover:bg-muted">
                      {/* Fundo sólido na célula fixa: translúcido deixaria as colunas roladas aparecerem por baixo. */}
                      <TableCell className="sticky left-0 z-10 bg-muted text-foreground">
                        Equipe (total)
                        <span className="block text-xs font-normal text-muted-foreground">
                          {sdrs.length} {sdrs.length === 1 ? "SDR" : "SDRs"}
                        </span>
                      </TableCell>
                      {COLUNAS.map((c) => (
                        <CelulaNumero key={c.chave} valor={c.render(total)} apoio={c.apoio?.(total)} destaque />
                      ))}
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
          <Info size={14} className="mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p>
              <strong className="font-medium text-foreground">Como os números são contados.</strong>{" "}
              Recebidos e respostas seguem a dona do lead: a resposta conta para quem era dona do lead na
              hora, não para quem digitou. O relógio da 1ª resposta é corrido (não desconta a noite nem o
              fim de semana) e começa quando o lead chega à SDR já com mensagem esperando, ou na primeira
              mensagem recebida depois disso. Agendamentos contam pelo dia em que a SDR MARCOU a consulta,
              e não pelo dia da consulta: o trabalho dela acontece quando ela marca. Comparecimentos,
              faltas e reagendamentos acompanham as mesmas consultas — é uma coorte, "do que ela marcou
              neste período, isto aconteceu". Por isso, no filtro de hoje, esses três ficam baixos ou
              zerados: a consulta marcada hoje ainda não chegou. Para ver quantas consultas ACONTECEM
              num período, use o Calendário. Remarcado não é comparecimento, e o crédito é o carimbado
              quando o agendamento foi criado. Expediente é o tempo com o ponto aberto, já sem as pausas; a mediana e
              a nota da equipe são recalculadas sobre todos os leads e respostas, não como média das médias.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function CelulaNumero({ valor, apoio, destaque = false }: { valor: React.ReactNode; apoio?: React.ReactNode; destaque?: boolean }) {
  return (
    <TableCell className="whitespace-nowrap text-right align-top">
      <span className={`block font-mono tabular-nums ${destaque ? "text-foreground" : ""}`}>{valor}</span>
      {apoio ? <span className="block text-[11px] font-normal text-muted-foreground">{apoio}</span> : null}
    </TableCell>
  );
}
