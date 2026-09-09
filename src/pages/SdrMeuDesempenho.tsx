import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DateRangeFilter, getDateRangeFromFilter, type DateRangeFilterValue } from "@/components/ui/date-range-filter";
import { asDateParam } from "@/lib/reportKit";
import {
  buscarLigacoesSdr, buscarRelatorioSdr, fmtInt, fmtMinutos, fmtNota, fmtPct, fmtSegundos, taxaComparecimento,
  type EstadoRpc, type LigacoesSdr, type LinhaRelatorioSdr,
} from "@/lib/relatorioSdr";
import { AlertTriangle, Info, Loader2, RefreshCw, TrendingUp } from "lucide-react";

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
      const [linhas, ligacoes] = await Promise.all([
        buscarRelatorioSdr("relatorio_sdr_minha", de, ate),
        buscarLigacoesSdr(de, ate),
      ]);
      setEstado({
        status: "ok",
        data: {
          l: linhas.find((x) => !x.is_total) ?? null,
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
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1000px] flex-col gap-6 pb-10">
        <header className="flex flex-wrap items-center gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
              <TrendingUp size={22} className="text-primary" /> Meu desempenho
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">O que aconteceu com os seus leads no período.</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <DateRangeFilter value={periodo} onChange={setPeriodo} excludePresets={["all", "multi"]} />
            <Button variant="outline" size="sm" title="Atualizar" disabled={carregando} onClick={() => setRecarga((n) => n + 1)}>
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
          <>
            <Skeleton className="h-[120px] rounded-2xl" />
            <div className="grid gap-4 md:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[190px] rounded-2xl" />)}
            </div>
          </>
        ) : !l ? (
          <div className="rounded-2xl border border-border bg-card px-6 py-14 text-center shadow-sm">
            <p className="font-semibold text-foreground">Sem dados para mostrar</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Não encontramos seu cadastro na equipe desta clínica. Fale com quem gere a equipe.
            </p>
          </div>
        ) : (
          <>
            {/* Resumo: os quatro números que importam, em uma faixa só */}
            <section className="grid grid-cols-2 divide-border rounded-2xl border border-border bg-card shadow-sm md:grid-cols-4 md:divide-x">
              <Destaque rotulo="Leads recebidos" valor={fmtInt(l.leads_recebidos)} apoio="chegaram a você" />
              <Destaque rotulo="Agendamentos" valor={fmtInt(l.agendamentos)} apoio="no seu crédito" />
              <Destaque
                rotulo="Compareceram" valor={fmtInt(l.compareceram)} realce
                apoio={l.compareceram + l.faltas > 0 ? `${taxaComparecimento(l)} de comparecimento` : "nenhuma consulta com desfecho"}
              />
              <Destaque rotulo="Ligações feitas" valor={fmtInt(feitas)} apoio={feitas > 0 ? `${fmtPct(atendidas, feitas)} atendidas pelo lead` : "nenhuma no período"} />
            </section>

            <div className="grid gap-4 md:grid-cols-2">
              <Painel titulo="Atendimento">
                <Linha rotulo="Respondidos" valor={fmtInt(l.leads_respondidos)} apoio={l.leads_recebidos > 0 ? `${fmtPct(l.leads_respondidos, l.leads_recebidos)} dos recebidos` : undefined} />
                <Linha rotulo="1ª resposta (mediana)" valor={fmtSegundos(l.resp_mediana_seg)} apoio={l.resp_amostra > 0 ? `${fmtInt(l.resp_amostra)} na amostra` : "sem amostra"} />
                <Linha rotulo="1ª resposta (média)" valor={fmtSegundos(l.resp_media_seg)} />
                <Linha rotulo="Conversas fechadas" valor={fmtInt(l.conversas_fechadas)} />
              </Painel>

              <Painel titulo="Consultas no seu crédito">
                <Linha rotulo="Agendamentos" valor={fmtInt(l.agendamentos)} apoio="por data agendada" />
                <Linha rotulo="Compareceram" valor={fmtInt(l.compareceram)} apoio={l.compareceram + l.faltas > 0 ? taxaComparecimento(l) : undefined} />
                <Linha rotulo="Faltas" valor={fmtInt(l.faltas)} />
                <Linha rotulo="Cancelados" valor={fmtInt(l.agend_cancelados)} apoio="fora da conta" />
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
          </>
        )}

        <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
          <Info size={14} className="mt-0.5 shrink-0" />
          <p>
            Os números contam o que aconteceu enquanto o lead era seu. Agendamentos e comparecimentos
            ficam no seu crédito quando você era a dona do lead na hora de marcar, por data agendada —
            e continuam seus mesmo depois de o lead passar para o administrador. O relógio da 1ª resposta
            é corrido, sem descontar noite e fim de semana.
          </p>
        </div>
      </div>
    </div>
  );
}

function Destaque({ rotulo, valor, apoio, realce }: { rotulo: string; valor: string; apoio: string; realce?: boolean }) {
  return (
    <div className="flex flex-col gap-1 px-5 py-4">
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{rotulo}</span>
      <span className={`font-mono text-3xl font-semibold tabular-nums ${realce ? "text-primary" : "text-foreground"}`}>{valor}</span>
      <span className="text-xs text-muted-foreground">{apoio}</span>
    </div>
  );
}

function Painel({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{titulo}</h2>
      <div className="divide-y divide-border">{children}</div>
    </section>
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
