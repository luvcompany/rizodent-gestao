import { useCallback, useEffect, useMemo, useState } from "react";
import SaidaDeArea from "@/components/SaidaDeArea";
import { contagem } from "@/lib/plural";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DateRangeFilter, getDateRangeFromFilter, type DateRangeFilterValue } from "@/components/ui/date-range-filter";
import { asDateParam } from "@/lib/reportKit";
import {
  buscarLigacoesSdr, buscarReagendamentosSdr, buscarRelatorioSdr, fmtInt, fmtMinutos, fmtNota, fmtPct, fmtSegundos, juntarReagendamentos, taxaComparecimento, taxaResposta,
  type EstadoRpc, type LigacoesSdr, type LinhaRelatorioSdr,
} from "@/lib/relatorioSdr";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RemarcouMaisDeUmaVez } from "@/components/relatorios/RemarcouMaisDeUmaVez";
import { BlocosSdr, buscarBlocosSdr, type Blocos } from "@/components/relatorios/BlocosSdr";
import { SdrDiario, buscarSdrDiario, type LinhaDiaria } from "@/components/relatorios/SdrDiario";
import { AlertTriangle, CalendarCheck, Info, Loader2, Phone, RefreshCw, TrendingUp, UserCheck, Users } from "lucide-react";

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

type Dados = { l: LinhaRelatorioSdr | null; lig: LigacoesSdr | null; blocos: Blocos | undefined; diario: LinhaDiaria[] | null };

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
      const [linhas, ligacoes, extras, blocos, diario] = await Promise.all([
        buscarRelatorioSdr("relatorio_sdr_minha", de, ate),
        buscarLigacoesSdr(de, ate),
        buscarReagendamentosSdr(de, ate),
        buscarBlocosSdr(de, ate).catch(() => ({} as Record<string, Blocos>)),
        buscarSdrDiario(de, ate).catch(() => null),
      ]);
      setEstado({
        status: "ok",
        data: {
          l: juntarReagendamentos(linhas, extras).find((x) => !x.is_total) ?? null,
          lig: ligacoes.find((x) => !user?.id || x.user_id === user.id) ?? null,
          blocos: user?.id ? blocos[user.id] ?? {} : {},
          diario: diario ? diario.filter((x) => !user?.id || x.user_id === user.id) : null,
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
  if (userRole !== "sdr") return <SaidaDeArea destino="/crm" />;

  const carregando = estado.status === "loading";
  const l = estado.status === "ok" ? estado.data.l : null;
  const lig = estado.status === "ok" ? estado.data.lig : null;
  const feitas = lig?.ligacoes_feitas ?? 0;
  const atendidas = lig?.ligacoes_atendidas ?? 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1120px] flex-col gap-6 lg:gap-7 pb-10">
        <header className="flex flex-wrap items-center gap-4">
          <div className="min-w-0">
            <h1 className="flex items-center gap-3.5 text-[28px] sm:text-[32px] font-bold leading-tight tracking-tight text-foreground">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-brand">
                <TrendingUp size={24} className="text-primary-foreground" />
              </span>Meu desempenho
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground sm:pl-[62px]">O que aconteceu com os seus leads no período.</p>
          </div>
          <div className="ml-auto flex items-center gap-2 rounded-xl border border-border/60 bg-card p-1.5 shadow-card">
            <DateRangeFilter value={periodo} onChange={setPeriodo} excludePresets={["all", "multi"]} />
            <Button variant="outline" size="sm" className="h-10 w-10 shrink-0 rounded-xl border-border/60 p-0" title="Atualizar" disabled={carregando} onClick={() => setRecarga((n) => n + 1)}>
              <RefreshCw size={15} className={carregando ? "animate-spin" : ""} />
            </Button>
          </div>
        </header>

        {estado.status === "error" ? (
          <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-destructive/20 bg-destructive-soft px-5 py-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-card shadow-xs">
              <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
            </span>
            <div className="min-w-[200px] flex-1">
              <p className="text-sm font-semibold text-destructive-soft-foreground">Não foi possível carregar seus números</p>
              <p className="mt-0.5 break-words text-xs text-destructive-soft-foreground/80">{estado.message}</p>
            </div>
            <Button variant="outline" size="sm" className="h-10 rounded-xl border-destructive/30 bg-card px-4 font-semibold text-destructive-soft-foreground hover:bg-destructive-soft" onClick={() => setRecarga((n) => n + 1)}>Tentar novamente</Button>
          </div>
        ) : estado.status === "loading" ? (
          <>
            <Skeleton className="h-[148px] rounded-card" />
            <div className="grid gap-5 md:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[240px] rounded-card" />)}
            </div>
          </>
        ) : !l ? (
          <div className="rounded-card border border-border/60 bg-card px-6 py-16 text-center shadow-card">
            <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary-soft text-primary-soft-fg">
              <Info size={24} />
            </span>
            <p className="text-[15px] font-semibold text-foreground">Sem dados para mostrar</p>
            <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted-foreground">
              Não encontramos seu cadastro na equipe desta clínica. Fale com quem gere a equipe.
            </p>
          </div>
        ) : (
          <Tabs defaultValue="geral">
            <TabsList>
              <TabsTrigger value="geral">Visão geral</TabsTrigger>
              <TabsTrigger value="producao">Produção</TabsTrigger>
              <TabsTrigger value="multi">Remarcou mais de uma vez</TabsTrigger>
            </TabsList>
            <TabsContent value="geral" className="mt-6 space-y-6">
            {/* Resumo: os quatro números que importam, cada um no seu card */}
            <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:gap-5 md:grid-cols-4">
              <div className="relative rounded-card border border-border/60 bg-card p-4 sm:p-5 shadow-card">
                <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-info-soft text-info">
                  <Users size={20} />
                </span>
                <Destaque rotulo="Leads recebidos" valor={fmtInt(l.leads_recebidos)} apoio={(l.leads_cadastrados ?? 0) > 0 ? `chegaram a você (${contagem(l.leads_cadastrados!, "cadastrado", "cadastrados")} por você)` : "chegaram a você"} />
              </div>
              <div className="relative rounded-card border border-border/60 bg-card p-4 sm:p-5 shadow-card">
                <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-success-soft text-success">
                  <CalendarCheck size={20} />
                </span>
                <Destaque rotulo="Agendamentos" valor={fmtInt(l.agendamentos)} apoio="no seu crédito" />
              </div>
              <div className="relative overflow-hidden rounded-card border border-primary/25 bg-primary-soft-2 p-4 sm:p-5 shadow-card ring-1 ring-primary/10">
                <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-brand">
                  <UserCheck size={20} />
                </span>
                <Destaque
                  rotulo="Compareceram" valor={fmtInt(l.compareceram)} realce
                  apoio={l.compareceram + l.faltas > 0 ? `${taxaComparecimento(l)} de comparecimento` : "nenhuma consulta com desfecho"}
                />
              </div>
              <div className="relative rounded-card border border-border/60 bg-card p-4 sm:p-5 shadow-card">
                <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-purple-soft text-purple">
                  <Phone size={20} />
                </span>
                <Destaque rotulo="Ligações feitas" valor={fmtInt(feitas)} apoio={feitas > 0 ? `${fmtPct(atendidas, feitas)} atendidas pelo lead` : "nenhuma no período"} />
              </div>
            </section>

            <section className="rounded-card border border-border/60 bg-card p-5 sm:p-6 shadow-card">
              <h2 className="mb-4 text-base font-semibold text-foreground">Suas consultas no período</h2>
              <BlocosSdr nome="Você" blocos={estado.status === "ok" ? estado.data.blocos : undefined} />
            </section>

            <div className="grid gap-4 lg:gap-5 md:grid-cols-2">
              <Painel titulo="Atendimento">
                <Linha rotulo="Respondidos" valor={fmtInt(l.leads_respondidos)} apoio={l.leads_com_entrada == null ? (l.leads_recebidos > 0 ? `${fmtPct(l.leads_respondidos, l.leads_recebidos)} dos recebidos` : undefined) : l.leads_com_entrada > 0 ? `${taxaResposta(l)} de quem escreveu (${l.resp_amostra} de ${l.leads_com_entrada})` : "nenhum lead escreveu no período"} />
                <Linha rotulo="1ª resposta (mediana)" valor={fmtSegundos(l.resp_mediana_seg)} apoio={l.resp_amostra > 0 ? `${fmtInt(l.resp_amostra)} na amostra` : "sem amostra"} />
                <Linha rotulo="1ª resposta (média)" valor={fmtSegundos(l.resp_media_seg)} />
                <Linha rotulo="Conversas fechadas" valor={fmtInt(l.conversas_fechadas)} />
              </Painel>

              <Painel titulo="Ligações">
                <Linha rotulo="Feitas" valor={fmtInt(feitas)} apoio={lig ? `${fmtInt(lig.telefonia_feitas)} telefonia · ${fmtInt(lig.whatsapp_feitas)} WhatsApp` : undefined} />
                <Linha rotulo="Atendidas pelo lead" valor={fmtInt(atendidas)} apoio={feitas > 0 ? `${fmtPct(atendidas, feitas)} das feitas` : undefined} />
                <Linha rotulo="Duração média" valor={atendidas > 0 ? fmtSegundos(lig?.duracao_media_seg ?? 0) : "—"} apoio="das atendidas" />
              </Painel>

              <Painel titulo="Expediente e satisfação">
                <Linha rotulo="Expediente" valor={fmtMinutos(l.minutos_expediente)} apoio="com o ponto aberto, sem pausas" />
                <Linha rotulo="Pausas" valor={fmtMinutos(l.minutos_pausa)} apoio="café, almoço e outras" />
                <Linha rotulo="Pesquisa de satisfação" valor={fmtNota(l.pesquisa_nota_media)} apoio={l.pesquisa_respostas > 0 ? `${fmtInt(l.pesquisa_respostas)} ${l.pesquisa_respostas === 1 ? "resposta" : "respostas"}` : "sem respostas"} />
              </Painel>
            </div>
            </TabsContent>
            <TabsContent value="producao" className="mt-6">
              {estado.status === "ok" && estado.data.diario ? (
                <SdrDiario modo="feitos" linhas={estado.data.diario} de={de ?? ""} ate={ate ?? ""} />
              ) : (
                <p className="rounded-2xl border border-border/60 bg-card px-6 py-8 text-sm text-destructive shadow-card">Não foi possível carregar sua produção.</p>
              )}
            </TabsContent>
            <TabsContent value="multi" className="mt-6">
              <RemarcouMaisDeUmaVez de={de} ate={ate} />
            </TabsContent>
          </Tabs>
        )}

        <div className="flex items-start gap-3 rounded-xl bg-muted p-4 text-[13px] leading-relaxed text-muted-foreground">
          <Info size={16} className="mt-0.5 shrink-0 text-info" />
          <p>
            Os números contam o que aconteceu enquanto o lead era seu, e continuam seus mesmo depois
            de o lead passar para o administrador. Os blocos Agendados, Remarcados e Geral contam as consultas
            marcadas para o período: Agendados é a 1ª consulta do lead, Remarcados são as seguintes e o
            Geral mostra o desfecho final de cada lead, contado uma vez só. A Produção mostra, dia a dia,
            quantos agendamentos você fez. O relógio da 1ª resposta é corrido, sem descontar noite e fim
            de semana.
          </p>
        </div>
      </div>
    </div>
  );
}

function Destaque({ rotulo, valor, apoio, realce }: { rotulo: string; valor: string; apoio: string; realce?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-muted-foreground">{rotulo}</span>
      <span className={`text-[32px] font-bold leading-none tracking-tight tabular-nums ${realce ? "text-primary-soft-fg" : "text-foreground"}`}>{valor}</span>
      <span className="text-xs text-tertiary">{apoio}</span>
    </div>
  );
}

function Painel({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-border/60 bg-card p-5 sm:p-6 shadow-card">
      <h2 className="mb-3 flex items-center gap-2.5 text-base font-semibold text-foreground before:h-5 before:w-1 before:rounded-full before:bg-primary before:content-['']">{titulo}</h2>
      <div className="divide-y divide-border/60">{children}</div>
    </section>
  );
}

function Linha({ rotulo, valor, apoio }: { rotulo: string; valor: string; apoio?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 last:pb-0">
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{rotulo}</div>
        {apoio && <div className="mt-0.5 text-xs text-tertiary">{apoio}</div>}
      </div>
      <div className="shrink-0 text-[15px] font-semibold tabular-nums text-foreground">{valor}</div>
    </div>
  );
}
