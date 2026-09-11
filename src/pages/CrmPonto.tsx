import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useGestorEquipe } from "@/hooks/useGestorEquipe";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateRangeFilter, getDateRangeFromFilter, type DateRangeFilterValue } from "@/components/ui/date-range-filter";
import { asDateParam, BAHIA_TZ } from "@/lib/reportKit";
import { mensagemDeErroRpc, type EstadoRpc } from "@/lib/relatorioSdr";
import { AlertTriangle, Clock, Coffee, Info, Loader2, Pause, RefreshCw, Timer, Users } from "lucide-react";

/**
 * Ponto da equipe — a tela que faltava.
 *
 * ORIGEM (11/09/2026, palavras do dono): "a sdr fabiola fez varias pausas no
 * expediente hoje, pra fazer ligacoes, e o sistema ta dizendo que tem 2 horas
 * ativo, sendo que ela abriu o expediente as 7:30 e agora sao 11:32. Preciso
 * saber se esta realmente certo. Alem disso preciso de um relatorio que mostre
 * essas pausas e o tempo de atendimento no dia/mes".
 * O cálculo estava certo (ela abriu 07:47, pausou 09:21–10:14, pausou 10:58 e
 * encerrou 11:30 ainda em pausa: 2h17 trabalhados, 1h25 de pausa). O que não
 * existia era a TELA: public.ponto_relatorio está no banco desde a Fase 2 do
 * rodízio e nenhuma parte do front a chamava. Esta página existe para que essa
 * conferência não dependa mais de ninguém abrir o banco.
 *
 * Fontes (migration 20260911060000_relatorio_de_ponto.sql):
 *   ponto_resumo(p_de, p_ate) → uma linha por pessoa: dias, minutos
 *     trabalhados/pausados, nº de pausas, média diária, motivo mais frequente e
 *     o estado AGORA (aberto/pausado/fechado), este último resolvido FORA do
 *     período filtrado — por isso o painel "no expediente agora" continua certo
 *     mesmo com o filtro em "mês passado".
 *   ponto_pausas(p_de, p_ate) → uma linha por pausa, com início, fim, duração,
 *     motivo e como a pausa terminou (retomar / encerrar / novo abrir / ainda
 *     em curso).
 * As duas somam pelo MESMO motor do cartão da SDR (public.ponto_sessoes), para
 * gestor e SDR nunca verem horas diferentes do mesmo dia.
 *
 * Quem entra: só quem `is_gestor_equipe()` devolve true (superadmin ou o gestor
 * NOMEADO em crm_rodizio_config.gestor_user_id) — o mesmo gate das outras telas
 * de /crm/equipe. O papel sdr nem chega aqui: a rota não está na allowlist dele
 * no ProtectedRoute, o item não aparece no menu e a RPC repete a checagem no
 * banco. Três camadas, e a que vale é a do servidor.
 *
 * Número nunca vira zero silencioso: ou carrega, ou mostra o dado, ou mostra o
 * erro com "Tentar novamente" (mesmo princípio de CrmRelatorios).
 */

type EstadoPonto = "aberto" | "pausado" | "fechado";

type ResumoPonto = {
  user_id: string;
  nome: string;
  papel: string;
  dias: number;
  minutos_trabalhados: number;
  minutos_pausa: number;
  pausas: number;
  media_diaria_min: number;
  motivo_top: string | null;
  rotulo_top: string | null;
  motivo_top_qtd: number;
  estado_agora: EstadoPonto;
  aberto_desde: string | null;
  pausado_desde: string | null;
  motivo_pausa_atual: string | null;
  rotulo_pausa_atual: string | null;
  minutos_sessao_atual: number;
  minutos_pausa_atual: number;
};

type PausaPonto = {
  user_id: string;
  nome: string;
  papel: string;
  dia: string;
  inicio: string;
  fim: string | null;
  minutos: number;
  segundos: number;
  motivo: string | null;
  rotulo: string | null;
  detalhe: string | null;
  em_curso: boolean;
  fim_por: string;
};

const TEXTO_RPC_AUSENTE =
  "O relatório de ponto ainda não foi instalado no banco: publique as migrations e recarregue a página.";

/** bigint/numeric do PostgREST podem chegar como string. */
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Minutos → "2h18" | "45min" | "0min" (nunca minutos crus na tela). */
const fmtDuracao = (min: number | null | undefined): string => {
  const m = Math.max(0, Math.round(min ?? 0));
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h${String(r).padStart(2, "0")}` : `${h}h`;
};

/** timestamptz ISO → "07:47" no fuso da clínica. */
const hora = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: BAHIA_TZ }) : "—";

/** DATE "2026-09-11" → "11/09" (sem passar por Date: não há fuso para errar). */
const diaCurto = (d: string): string => {
  const p = String(d).split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}` : String(d);
};

// O RÓTULO VEM DO BANCO. Havia aqui um mapa fixo { cafe, almoco, outro } — a
// quarta cópia da mesma lista espalhada pelo sistema. Desde 11/09 o CRC configura
// os motivos na aba Equipe, então "Ligação", "Banheiro" ou qualquer motivo novo
// apareceria como a chave crua ('ligacao'), e um motivo renomeado continuaria com
// o nome velho. Agora ponto_pausas devolve o rótulo já traduzido; a chave só
// aparece quando o motivo foi apagado depois de usado, para a pausa histórica não
// sumir do relatório.
const rotuloMotivo = (rotulo: string | null | undefined, chave?: string | null): string =>
  rotulo?.trim() || chave?.trim() || "sem motivo";

const rotuloPapel = (p: string): string =>
  p === "sdr" ? "SDR" : p === "crc" ? "Administrador" : "Outro";

/** Como a pausa terminou — o "encerrar" é o caso da Fabíola: encerrou o
 *  expediente sem retomar, e essa pausa precisa aparecer assim mesmo. */
const rotuloFim = (p: PausaPonto): string | null => {
  if (p.em_curso) return "em curso";
  if (p.fim_por === "encerrar") return "encerrou em pausa";
  if (p.fim_por === "abrir") return "abriu outro expediente";
  return null;
};

async function chamarRpc<T>(fn: string, de: string, ate: string, oQue: string): Promise<T[]> {
  // RPCs novas ainda não estão em types.ts (arquivo gerado pelo Lovable) —
  // mesmo padrão do resto do projeto para RPC não tipada.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc(fn, { p_de: de, p_ate: ate });
  if (error) throw new Error(mensagemDeErroRpc(error, `Não foi possível carregar ${oQue}.`, TEXTO_RPC_AUSENTE));
  return Array.isArray(data) ? (data as T[]) : [];
}

const normalizarResumo = (r: Record<string, unknown>): ResumoPonto => ({
  user_id: String(r.user_id ?? ""),
  nome: String(r.nome ?? "Sem nome"),
  papel: String(r.papel ?? "outro"),
  dias: num(r.dias),
  minutos_trabalhados: num(r.minutos_trabalhados),
  minutos_pausa: num(r.minutos_pausa),
  pausas: num(r.pausas),
  media_diaria_min: num(r.media_diaria_min),
  motivo_top: (r.motivo_top as string | null) ?? null,
  rotulo_top: (r.rotulo_top as string | null) ?? null,
  motivo_top_qtd: num(r.motivo_top_qtd),
  estado_agora: (r.estado_agora as EstadoPonto) ?? "fechado",
  aberto_desde: (r.aberto_desde as string | null) ?? null,
  pausado_desde: (r.pausado_desde as string | null) ?? null,
  motivo_pausa_atual: (r.motivo_pausa_atual as string | null) ?? null,
  rotulo_pausa_atual: (r.rotulo_pausa_atual as string | null) ?? null,
  minutos_sessao_atual: num(r.minutos_sessao_atual),
  minutos_pausa_atual: num(r.minutos_pausa_atual),
});

const normalizarPausa = (r: Record<string, unknown>): PausaPonto => ({
  user_id: String(r.user_id ?? ""),
  nome: String(r.nome ?? "Sem nome"),
  papel: String(r.papel ?? "outro"),
  dia: String(r.dia ?? ""),
  inicio: String(r.inicio ?? ""),
  fim: (r.fim as string | null) ?? null,
  minutos: num(r.minutos),
  segundos: num(r.segundos),
  motivo: (r.motivo as string | null) ?? null,
  rotulo: (r.rotulo as string | null) ?? null,
  detalhe: (r.detalhe as string | null) ?? null,
  em_curso: r.em_curso === true,
  fim_por: String(r.fim_por ?? ""),
});

type Dados = { resumo: ResumoPonto[]; pausas: PausaPonto[] };

export default function CrmPonto() {
  const { isGestor, resolved, erro: erroGestor, tentarDeNovo } = useGestorEquipe();

  // Começa em "Hoje": a pergunta que abriu esta tela era sobre o dia corrente.
  const [periodo, setPeriodo] = useState<DateRangeFilterValue>({ preset: "today" });
  const [estado, setEstado] = useState<EstadoRpc<Dados>>({ status: "loading" });
  const [recarga, setRecarga] = useState(0);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);

  const intervalo = useMemo(() => getDateRangeFromFilter(periodo), [periodo]);
  const de = intervalo ? asDateParam(intervalo.start) : null;
  const ate = intervalo ? asDateParam(intervalo.end) : null;

  const carregar = useCallback(async () => {
    if (!de || !ate) return;
    setEstado((s) => (s.status === "ok" ? s : { status: "loading" }));
    try {
      const [resumo, pausas] = await Promise.all([
        chamarRpc<Record<string, unknown>>("ponto_resumo", de, ate, "o resumo do ponto"),
        chamarRpc<Record<string, unknown>>("ponto_pausas", de, ate, "as pausas"),
      ]);
      setEstado({ status: "ok", data: { resumo: resumo.map(normalizarResumo), pausas: pausas.map(normalizarPausa) } });
      setAtualizadoEm(new Date());
    } catch (e) {
      setEstado({ status: "error", message: e instanceof Error ? e.message : "Não foi possível carregar o ponto." });
    }
  }, [de, ate]);

  useEffect(() => {
    if (resolved && isGestor) void carregar();
  }, [resolved, isGestor, carregar, recarga]);

  // "Há quanto tempo" envelhece sozinho: sem esta recarga o painel de quem está
  // no expediente agora congelaria no minuto em que a página abriu.
  useEffect(() => {
    if (!resolved || !isGestor) return;
    const t = window.setInterval(() => setRecarga((n) => n + 1), 60_000);
    return () => window.clearInterval(t);
  }, [resolved, isGestor]);

  // --------------------------------------------------------------- gate
  // Só `false` vindo do banco fecha a rota. Erro de rede/5xx na RPC NÃO é
  // "não é gestor": fica em carregando com "Tentar de novo" (nunca expulsar
  // por uma decisão tomada por negação sobre um estado de erro).
  if (!resolved) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        {erroGestor ? (
          <>
            <p className="text-sm">Não foi possível confirmar sua permissão para ver o ponto da equipe.</p>
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

  const dados = estado.status === "ok" ? estado.data : null;
  const carregando = estado.status === "loading";
  const pessoas = dados?.resumo ?? [];
  const pausas = dados?.pausas ?? [];
  const abertos = pessoas.filter((p) => p.estado_agora !== "fechado");
  const comExpediente = pessoas.filter((p) => p.dias > 0);
  const semExpediente = pessoas.filter((p) => p.dias === 0);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-5 pb-10">
        <header className="flex flex-wrap items-center gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
              <Clock size={22} className="text-primary" /> Ponto da equipe
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Tempo de atendimento e pausas de cada pessoa no período.{" "}
              <Link to="/crm/equipe" className="underline underline-offset-2 hover:text-foreground">Ver a equipe</Link>
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {atualizadoEm && (
              <span className="hidden text-xs text-muted-foreground sm:inline">
                atualizado {atualizadoEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: BAHIA_TZ })}
              </span>
            )}
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
          <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="flex flex-wrap items-center gap-3 px-6 py-10">
              <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
              <div className="min-w-[200px] flex-1">
                <p className="text-sm font-medium text-destructive">Não foi possível carregar o ponto</p>
                <p className="mt-0.5 break-words text-xs text-muted-foreground">{estado.message}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setRecarga((n) => n + 1)}>Tentar novamente</Button>
            </div>
          </section>
        ) : carregando && !dados ? (
          <section className="space-y-3 rounded-2xl border border-border bg-card p-6 shadow-sm">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </section>
        ) : (
          <>
            {/* ------------------------------------------------ no expediente agora */}
            <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              <div className="flex items-center gap-2 border-b border-border px-5 py-3">
                <Timer size={16} className="text-primary" />
                <h2 className="text-sm font-semibold text-foreground">No expediente agora</h2>
                <span className="text-xs text-muted-foreground">
                  independe do período escolhido
                </span>
              </div>
              {abertos.length === 0 ? (
                <p className="px-5 py-6 text-sm text-muted-foreground">
                  Ninguém com o expediente aberto neste momento.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {abertos.map((p) => (
                    <li key={p.user_id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                      <span className="flex items-center gap-2 font-medium text-foreground">
                        <span className={`h-[7px] w-[7px] rounded-full ${p.estado_agora === "aberto" ? "bg-emerald-500" : "bg-amber-500"}`} />
                        {p.nome}
                      </span>
                      <Badge
                        variant="outline"
                        className={p.estado_agora === "aberto"
                          ? "h-5 border-emerald-500/30 px-1.5 text-[10px] text-emerald-600 dark:text-emerald-400"
                          : "h-5 border-amber-500/30 px-1.5 text-[10px] text-amber-600 dark:text-amber-400"}
                      >
                        {p.estado_agora === "aberto" ? "Em expediente" : `Em pausa · ${rotuloMotivo(p.rotulo_pausa_atual, p.motivo_pausa_atual)}`}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        abriu às {hora(p.aberto_desde)} · {fmtDuracao(p.minutos_sessao_atual)} trabalhados
                        {p.minutos_pausa_atual > 0 ? ` · ${fmtDuracao(p.minutos_pausa_atual)} de pausa` : ""}
                      </span>
                      {p.estado_agora === "pausado" && p.pausado_desde && (
                        <span className="text-sm text-amber-600 dark:text-amber-400">
                          em pausa desde {hora(p.pausado_desde)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* ------------------------------------------------------ cartão por pessoa */}
            {pessoas.length === 0 ? (
              <section className="rounded-2xl border border-border bg-card px-6 py-16 text-center shadow-sm">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary/10">
                  <Users className="text-primary" size={22} />
                </div>
                <p className="mt-3 font-semibold text-foreground">Ninguém para mostrar</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                  O ponto aparece assim que a primeira pessoa da equipe abrir o expediente.
                </p>
              </section>
            ) : (
              <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {[...comExpediente, ...semExpediente].map((p) => (
                  <article key={p.user_id} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-foreground">{p.nome}</p>
                        <p className="text-xs text-muted-foreground">{rotuloPapel(p.papel)}</p>
                      </div>
                      {p.estado_agora !== "fechado" && (
                        <Badge
                          variant="outline"
                          className={p.estado_agora === "aberto"
                            ? "h-5 border-emerald-500/30 px-1.5 text-[10px] text-emerald-600 dark:text-emerald-400"
                            : "h-5 border-amber-500/30 px-1.5 text-[10px] text-amber-600 dark:text-amber-400"}
                        >
                          {p.estado_agora === "aberto" ? "Agora em expediente" : "Agora em pausa"}
                        </Badge>
                      )}
                    </div>

                    {p.dias === 0 ? (
                      <p className="mt-4 text-sm text-muted-foreground">Sem expediente registrado no período.</p>
                    ) : (
                      <dl className="mt-4 grid grid-cols-2 gap-3">
                        <div>
                          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Trabalhado</dt>
                          <dd className="font-mono text-xl tabular-nums text-foreground">{fmtDuracao(p.minutos_trabalhados)}</dd>
                        </div>
                        <div>
                          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Em pausa</dt>
                          <dd className="font-mono text-xl tabular-nums text-foreground">{fmtDuracao(p.minutos_pausa)}</dd>
                        </div>
                        <div>
                          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Pausas</dt>
                          <dd className="font-mono text-base tabular-nums text-foreground">
                            {p.pausas}
                            {p.motivo_top && p.pausas > 0 ? (
                              <span className="ml-1 font-sans text-xs text-muted-foreground">
                                · mais: {rotuloMotivo(p.rotulo_top, p.motivo_top)} ({p.motivo_top_qtd})
                              </span>
                            ) : null}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Dias</dt>
                          <dd className="font-mono text-base tabular-nums text-foreground">
                            {p.dias}
                            <span className="ml-1 font-sans text-xs text-muted-foreground">
                              · {fmtDuracao(p.media_diaria_min)}/dia
                            </span>
                          </dd>
                        </div>
                      </dl>
                    )}
                  </article>
                ))}
              </section>
            )}

            {/* --------------------------------------------------------- lista de pausas */}
            <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              <div className="flex items-center gap-2 border-b border-border px-5 py-3">
                <Pause size={16} className="text-primary" />
                <h2 className="text-sm font-semibold text-foreground">Pausas do período</h2>
                <span className="text-xs text-muted-foreground">
                  {pausas.length} {pausas.length === 1 ? "pausa" : "pausas"}
                </span>
              </div>
              {pausas.length === 0 ? (
                <p className="flex items-center gap-2 px-5 py-6 text-sm text-muted-foreground">
                  <Coffee size={14} /> Nenhuma pausa registrada no período.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table className="min-w-[720px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Pessoa</TableHead>
                        <TableHead className="whitespace-nowrap">Dia</TableHead>
                        <TableHead className="whitespace-nowrap">Início</TableHead>
                        <TableHead className="whitespace-nowrap">Fim</TableHead>
                        <TableHead className="whitespace-nowrap text-right">Duração</TableHead>
                        <TableHead>Motivo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pausas.map((p, i) => {
                        const aviso = rotuloFim(p);
                        return (
                          <TableRow key={`${p.user_id}-${p.inicio}-${i}`}>
                            <TableCell className="font-medium text-foreground">{p.nome}</TableCell>
                            <TableCell className="whitespace-nowrap text-muted-foreground">{diaCurto(p.dia)}</TableCell>
                            <TableCell className="whitespace-nowrap font-mono tabular-nums">{hora(p.inicio)}</TableCell>
                            <TableCell className="whitespace-nowrap font-mono tabular-nums">
                              {p.em_curso ? <span className="text-amber-600 dark:text-amber-400">em curso</span> : hora(p.fim)}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">{fmtDuracao(p.minutos)}</TableCell>
                            <TableCell>
                              <span className="flex flex-wrap items-center gap-1.5">
                                <span>
                                  {rotuloMotivo(p.rotulo, p.motivo)}
                                  {p.detalhe ? <span className="text-muted-foreground">: {p.detalhe}</span> : null}
                                </span>
                                {aviso && (
                                  <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-muted-foreground">{aviso}</Badge>
                                )}
                              </span>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>

            {/* ------------------------------------------------------------- como se lê */}
            <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
              <Info size={14} className="mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p>
                  <strong className="font-medium text-foreground">Como estes números são contados.</strong>{" "}
                  "Trabalhado" é o tempo com o expediente aberto já SEM as pausas — a mesma conta do cartão da
                  própria SDR, para gestor e SDR nunca verem horas diferentes do mesmo dia. Um expediente que
                  atravessa a meia-noite conta inteiro no dia em que foi ABERTO (não é partido nem contado duas
                  vezes). Pausa que ainda corre conta até agora e vem marcada; quem encerra o expediente sem
                  retomar tem a pausa fechada na hora do encerramento — ela aparece na lista com "encerrou em
                  pausa". Cada pausa da lista é truncada em minutos inteiros, então somar a lista pode dar um
                  minuto a menos que o total do cartão; o total do cartão é o oficial.
                </p>
                <p>
                  <strong className="font-medium text-foreground">Quem aparece.</strong>{" "}
                  As SDRs e o administrador principal do cliente, mesmo sem expediente no período. Hoje só o
                  perfil SDR consegue bater ponto no sistema — por isso o administrador aparece com "sem
                  expediente registrado". Quem esquece de encerrar continua somando até o encerramento
                  automático: o painel de cima mostra quem está aberto agora e desde quando.
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
