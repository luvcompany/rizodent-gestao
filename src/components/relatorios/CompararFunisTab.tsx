import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateRangeFilter, getDateRangeFromFilter, type DateRangeFilterValue } from "@/components/ui/date-range-filter";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { asDateParam } from "@/lib/reportKit";
import { useVocab } from "@/hooks/useVocab";
import { fmtInt, fmtPct, mensagemDeErroRpc } from "@/lib/relatorioSdr";
import { AlertTriangle, Loader2, RefreshCw, Trophy, Wallet } from "lucide-react";

/**
 * Comparar funis — base e conversão de cada funil lado a lado (RPC relatorio_funis).
 * Decisão do dono (09/09/2026): funis por procedimento (Prótese, Implante, …)
 * para saber qual procedimento converte mais. Só gestão (a RPC recusa o resto).
 *
 * Leitura dos números: "novos" = leads criados no período que estão no funil
 * hoje; agendamentos/compareceram/contratados = consultas por data agendada no
 * período, de leads que estão no funil hoje; receita = pagamentos no período de
 * pacientes ligados a leads do funil (mesma régua do Dontus: sem orto
 * recorrente, sem "não marketing"). Lead que trocou de funil conta no funil
 * atual — é a leitura "onde está agora", a mesma do Kanban.
 *
 * DUAS taxas, porque elas respondem coisas diferentes:
 * - "Contratos ÷ novos" mistura safras de propósito (numerador = consultas do
 *   período, de leads de qualquer época; denominador = só leads criados no
 *   período). Serve de leitura de volume, pode passar de 100% e por isso vem
 *   marcada quando passa — nunca é ela que elege o destaque.
 * - "Fechamento" = contratados ÷ compareceram, os dois lados da MESMA safra de
 *   consultas do período. É a taxa que responde "qual procedimento fecha mais",
 *   e é ela (com amostra mínima) que decide o cartão de destaque.
 */

type LinhaFunil = {
  pipeline_id: string; nome: string; posicao: number | null;
  leads_total: number; leads_novos: number;
  agendamentos: number; compareceram: number; faltas: number; contratados: number;
  contratados_etapa: number; receita: number; pagantes: number;
};

type Ordem = "posicao" | "conversao" | "fechamento" | "receita" | "novos" | "agendamentos";

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const razao = (n: number, d: number): number | null => (d > 0 ? n / d : null);

/**
 * Amostra mínima do cartão de destaque: com 1 ou 2 comparecimentos, 1 contrato
 * vira 50%/100% e o cartão elegeria o funil de menos movimento da clínica.
 */
const MIN_COMPARECIMENTOS_DESTAQUE = 5;

function Barra({ valor, max, cor }: { valor: number; max: number; cor: string }) {
  const w = max > 0 ? Math.max(2, Math.round((valor / max) * 100)) : 0;
  return (
    <div className="mt-1.5 ml-auto h-1.5 w-full max-w-[80px] overflow-hidden rounded-full bg-surface-sunken">
      <div className={`h-1.5 rounded-full ${cor}`} style={{ width: `${valor > 0 ? w : 0}%` }} />
    </div>
  );
}

export default function CompararFunisTab() {
  const [periodo, setPeriodo] = useState<DateRangeFilterValue>({ preset: "this_month" });
  const [ordem, setOrdem] = useState<Ordem>("posicao");
  const [ocultarVazios, setOcultarVazios] = useState(true);
  const [linhas, setLinhas] = useState<LinhaFunil[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  // Crítica 28: a ressalva da receita recorrente só aparece para o segmento que
  // a tem (odontologia: "Recorrência de ortodontia"); nos demais, some.
  const { receitaRecorrenteLabel } = useVocab();
  const ressalvaRecorrente = receitaRecorrenteLabel
    ? `sem ${receitaRecorrenteLabel.charAt(0).toLocaleLowerCase("pt-BR")}${receitaRecorrenteLabel.slice(1)} e `
    : "";

  const intervalo = useMemo(() => getDateRangeFromFilter(periodo), [periodo]);
  const de = intervalo ? asDateParam(intervalo.start) : null;
  const ate = intervalo ? asDateParam(intervalo.end) : null;

  const carregar = useCallback(async () => {
    if (!de || !ate) return;
    setCarregando(true);
    setErro(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("relatorio_funis", { p_de: de, p_ate: ate });
    setCarregando(false);
    if (error) {
      setErro(mensagemDeErroRpc(error, "Não foi possível carregar a comparação dos funis.", "O relatório por funil ainda não foi instalado no banco."));
      return;
    }
    const lista = (Array.isArray(data) ? data : []).map((r: Record<string, unknown>): LinhaFunil => ({
      pipeline_id: String(r.pipeline_id),
      nome: String(r.nome ?? ""),
      posicao: r.posicao === null || r.posicao === undefined ? null : num(r.posicao),
      leads_total: num(r.leads_total), leads_novos: num(r.leads_novos),
      agendamentos: num(r.agendamentos), compareceram: num(r.compareceram), faltas: num(r.faltas), contratados: num(r.contratados),
      contratados_etapa: num(r.contratados_etapa), receita: num(r.receita), pagantes: num(r.pagantes),
    }));
    setLinhas(lista);
  }, [de, ate]);

  useEffect(() => { void carregar(); }, [carregar]);

  const visiveis = useMemo(() => {
    if (!linhas) return [];
    let l = ocultarVazios
      ? linhas.filter((x) => x.leads_total > 0 || x.agendamentos > 0 || x.receita > 0)
      : [...linhas];
    const conv = (x: LinhaFunil) => razao(x.contratados, x.leads_novos) ?? -1;
    const fech = (x: LinhaFunil) => razao(x.contratados, x.compareceram) ?? -1;
    if (ordem === "conversao") l = l.sort((a, b) => conv(b) - conv(a) || b.contratados - a.contratados);
    else if (ordem === "fechamento") l = l.sort((a, b) => fech(b) - fech(a) || b.compareceram - a.compareceram);
    else if (ordem === "receita") l = l.sort((a, b) => b.receita - a.receita);
    else if (ordem === "novos") l = l.sort((a, b) => b.leads_novos - a.leads_novos);
    else if (ordem === "agendamentos") l = l.sort((a, b) => b.agendamentos - a.agendamentos);
    else l = l.sort((a, b) => (a.posicao ?? 9999) - (b.posicao ?? 9999));
    return l;
  }, [linhas, ordem, ocultarVazios]);

  const totais = useMemo(() => {
    const t = { leads_total: 0, leads_novos: 0, agendamentos: 0, compareceram: 0, faltas: 0, contratados: 0, contratados_etapa: 0, receita: 0, pagantes: 0 };
    for (const x of visiveis) {
      t.leads_total += x.leads_total; t.leads_novos += x.leads_novos; t.agendamentos += x.agendamentos;
      t.compareceram += x.compareceram; t.faltas += x.faltas; t.contratados += x.contratados;
      t.contratados_etapa += x.contratados_etapa; t.receita += x.receita; t.pagantes += x.pagantes;
    }
    return t;
  }, [visiveis]);

  const maxConv = Math.max(0, ...visiveis.map((x) => razao(x.contratados, x.leads_novos) ?? 0));
  const maxFech = Math.max(0, ...visiveis.map((x) => razao(x.contratados, x.compareceram) ?? 0));
  const maxReceita = Math.max(0, ...visiveis.map((x) => x.receita));
  // O destaque saiu de "contratados ÷ leads novos" (safras diferentes: premiava
  // o funil que fechava lead antigo e recebia pouco lead novo, às vezes com
  // mais de 100%) para o fechamento da MESMA safra, com amostra mínima.
  const melhorFechamento = visiveis.filter((x) => x.compareceram >= MIN_COMPARECIMENTOS_DESTAQUE && x.contratados > 0)
    .sort((a, b) => (razao(b.contratados, b.compareceram) ?? 0) - (razao(a.contratados, a.compareceram) ?? 0))[0];
  const maiorReceita = visiveis.filter((x) => x.receita > 0).sort((a, b) => b.receita - a.receita)[0];

  return (
    <div className="space-y-5 lg:space-y-6">
      <Card className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-card border-border/60 bg-card px-4 py-3 shadow-card">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-tertiary">Período</span>
          <DateRangeFilter value={periodo} onChange={setPeriodo} excludePresets={["all", "multi"]} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-tertiary">Ordenar por</span>
          <Select value={ordem} onValueChange={(v) => setOrdem(v as Ordem)}>
            <SelectTrigger className="h-9 w-[190px] rounded-xl"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="posicao">Ordem dos funis</SelectItem>
              <SelectItem value="conversao">Contratos ÷ novos</SelectItem>
              <SelectItem value="fechamento">Fechamento</SelectItem>
              <SelectItem value="receita">Receita</SelectItem>
              <SelectItem value="novos">Leads novos</SelectItem>
              <SelectItem value="agendamentos">Agendamentos</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-2.5 rounded-full bg-surface-sunken py-1.5 pl-2 pr-3.5 text-[13px] font-medium text-muted-foreground">
          <Switch checked={ocultarVazios} onCheckedChange={setOcultarVazios} /> Ocultar funis vazios
        </label>
        <div className="ml-auto flex items-center gap-2">
          {carregando && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
          <Button variant="outline" size="sm" className="h-9 w-9 rounded-xl p-0" onClick={carregar} disabled={carregando} title="Atualizar">
            <RefreshCw size={14} className={carregando ? "animate-spin" : ""} />
          </Button>
        </div>
      </Card>

      {erro ? (
        <Card className="flex flex-wrap items-center gap-3 rounded-card border-destructive/20 bg-destructive-soft px-5 py-4 shadow-none">
          <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
          <div className="min-w-[200px] flex-1">
            <p className="text-sm font-semibold text-destructive-soft-foreground">Não foi possível carregar</p>
            <p className="mt-0.5 break-words text-xs text-destructive-soft-foreground/80">{erro}</p>
          </div>
          <Button variant="outline" size="sm" className="h-8 rounded-lg border-destructive/30 bg-card text-[13px] font-semibold text-destructive-soft-foreground hover:bg-destructive-soft" onClick={carregar}>Tentar novamente</Button>
        </Card>
      ) : !linhas ? (
        <>
          <div className="grid gap-4 lg:gap-5 md:grid-cols-2">
            <Skeleton className="h-[132px] rounded-card" />
            <Skeleton className="h-[132px] rounded-card" />
          </div>
          <Skeleton className="h-[320px] rounded-card" />
        </>
      ) : (
        <>
          <div className="grid gap-4 lg:gap-5 md:grid-cols-2">
            <Card className="flex items-start gap-4 rounded-card border-border/60 p-5 sm:p-6 shadow-card">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-success-soft text-success">
                <Trophy size={22} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-muted-foreground">Melhor fechamento no período</p>
                {melhorFechamento ? (
                  <>
                    <p className="mt-1 break-words text-[22px] sm:text-2xl font-bold leading-tight tracking-tight text-foreground">{melhorFechamento.nome}</p>
                    <p className="mt-1 text-[13px] font-medium tabular-nums text-success-soft-foreground">
                      {fmtPct(melhorFechamento.contratados, melhorFechamento.compareceram)} · {fmtInt(melhorFechamento.contratados)} contrato{melhorFechamento.contratados === 1 ? "" : "s"} em {fmtInt(melhorFechamento.compareceram)} comparecimentos
                    </p>
                    <p className="mt-2 text-xs leading-snug text-tertiary">
                      Critério: contratados ÷ compareceram (mesma safra), com no mínimo {MIN_COMPARECIMENTOS_DESTAQUE} comparecimentos no período.
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-sm leading-snug text-muted-foreground">
                    Nenhum funil com pelo menos {MIN_COMPARECIMENTOS_DESTAQUE} comparecimentos e um contrato no período — abaixo disso a taxa é ruído.
                  </p>
                )}
              </div>
            </Card>
            <Card className="flex items-start gap-4 rounded-card border-border/60 p-5 sm:p-6 shadow-card">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary-soft text-primary">
                <Wallet size={22} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-muted-foreground">Maior receita no período</p>
                {maiorReceita ? (
                  <>
                    <p className="mt-1 break-words text-[22px] sm:text-2xl font-bold leading-tight tracking-tight text-foreground">{maiorReceita.nome}</p>
                    <p className="mt-1 text-[13px] font-medium tabular-nums text-primary-soft-fg">
                      {brl.format(maiorReceita.receita)} · {fmtInt(maiorReceita.pagantes)} paciente{maiorReceita.pagantes === 1 ? "" : "s"} pagante{maiorReceita.pagantes === 1 ? "" : "s"}
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-sm leading-snug text-muted-foreground">Nenhum pagamento no período ligado a leads dos funis.</p>
                )}
              </div>
            </Card>
          </div>

          <Card className="overflow-hidden rounded-card border-border/60 shadow-card">
            <div className="overflow-x-auto [&_th]:h-12 [&_th]:bg-surface-sunken [&_th]:text-xs [&_th]:font-semibold [&_th]:leading-tight max-lg:[&_th]:whitespace-nowrap [&_tr]:border-border/60 [&_td]:py-3.5 max-lg:[&_td_div]:whitespace-nowrap lg:[&_td_div]:[text-wrap:balance] [&_td_div]:leading-snug [&_td]:whitespace-nowrap lg:[&_td_div]:whitespace-normal lg:[&_th]:px-2 lg:[&_td]:px-2 lg:[&_th]:py-2 lg:[&_th]:[text-wrap:balance] lg:[&_td]:text-[13px] lg:max-2xl:[&_td]:text-xs lg:max-2xl:[&_th]:text-[11px] lg:max-2xl:[&_td_div]:text-[10.5px] [&>div]:[background:linear-gradient(to_right,hsl(var(--card))_30%,hsl(var(--card)/0))_left_center/40px_100%_no-repeat_local,linear-gradient(to_left,hsl(var(--card))_30%,hsl(var(--card)/0))_right_center/40px_100%_no-repeat_local,radial-gradient(farthest-side_at_0_50%,hsl(var(--foreground)/0.2),transparent)_left_center/18px_100%_no-repeat_scroll,radial-gradient(farthest-side_at_100%_50%,hsl(var(--foreground)/0.2),transparent)_right_center/18px_100%_no-repeat_scroll]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 z-10 !bg-surface-sunken min-w-[112px] 2xl:min-w-[124px]">Funil</TableHead>
                    <TableHead className="min-w-[64px] text-right" title="Leads que estão no funil hoje">Leads no funil</TableHead>
                    <TableHead className="text-right" title="Leads criados no período que estão no funil hoje">Novos</TableHead>
                    <TableHead className="text-right" title="Consultas por data agendada no período (sem canceladas)">Agendamentos</TableHead>
                    <TableHead className="text-right" title="Contratou ou não contratou = compareceu">Compareceram</TableHead>
                    <TableHead className="text-right">Faltas</TableHead>
                    <TableHead className="text-right" title="Consultas com contrato no período">Contratados</TableHead>
                    <TableHead className="min-w-[76px] 2xl:min-w-[92px] text-right" title="Contratados ÷ compareceram, os dois do mesmo período: é a taxa que responde qual procedimento fecha mais">Fechamento</TableHead>
                    <TableHead className="min-w-[76px] 2xl:min-w-[92px] text-right" title="Contratados (consultas do período, de leads de qualquer época) ÷ leads criados no período. Safras diferentes: leitura de volume, pode passar de 100%">Contratos ÷ novos</TableHead>
                    <TableHead className="min-w-[76px] 2xl:min-w-[92px] text-right" title="Pagamentos no período de pacientes ligados a leads do funil">Receita</TableHead>
                    <TableHead className="text-right" title="Receita ÷ pacientes pagantes">Ticket</TableHead>
                    <TableHead className="text-right" title="Leads hoje na etapa Contratado do funil (base histórica)">Na etapa Contratado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visiveis.length === 0 && (
                    <TableRow><TableCell colSpan={12} className="py-12 text-center text-sm text-muted-foreground">Nenhum funil com dados no período.</TableCell></TableRow>
                  )}
                  {visiveis.map((x) => {
                    const conv = razao(x.contratados, x.leads_novos);
                    const fech = razao(x.contratados, x.compareceram);
                    // Acima de 100% não é erro de conta: é a mistura de safras
                    // (contrato de lead antigo dividido por lead novo do mês).
                    // Marcamos em âmbar com explicação em vez de esconder.
                    const acimaDeCem = conv !== null && conv > 1;
                    return (
                      <TableRow key={x.pipeline_id} className="hover:bg-transparent">
                        <TableCell className="sticky left-0 z-10 bg-card font-semibold text-foreground">{x.nome}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtInt(x.leads_total)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtInt(x.leads_novos)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtInt(x.agendamentos)}
                          <div className="text-[11px] text-muted-foreground">{fmtPct(x.agendamentos, x.leads_novos)} dos novos</div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtInt(x.compareceram)}
                          <div className="text-[11px] text-muted-foreground">{fmtPct(x.compareceram, x.compareceram + x.faltas)} de comparecimento</div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtInt(x.faltas)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtInt(x.contratados)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          <span className="font-semibold text-foreground">{fech === null ? "—" : fmtPct(x.contratados, x.compareceram)}</span>
                          <Barra valor={fech ?? 0} max={maxFech} cor="bg-success" />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <span
                            className={acimaDeCem ? "font-semibold text-warning" : "font-semibold text-foreground"}
                            title={acimaDeCem ? "Passou de 100% porque os dois lados são safras diferentes: em cima, consultas do período de leads de qualquer época; embaixo, só os leads criados no período. Para comparar procedimentos, use Fechamento." : undefined}
                          >
                            {conv === null ? "—" : fmtPct(x.contratados, x.leads_novos)}
                            {acimaDeCem && <span className="ml-0.5">*</span>}
                          </span>
                          <Barra valor={conv ?? 0} max={maxConv} cor="bg-info" />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <span className="font-semibold text-foreground">{x.receita > 0 ? brl.format(x.receita) : "—"}</span>
                          <Barra valor={x.receita} max={maxReceita} cor="bg-primary" />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{x.pagantes > 0 ? brl.format(x.receita / x.pagantes) : "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtInt(x.contratados_etapa)}</TableCell>
                      </TableRow>
                    );
                  })}
                  {visiveis.length > 1 && (
                    <TableRow className="bg-surface-sunken font-bold text-foreground hover:bg-surface-sunken">
                      <TableCell className="sticky left-0 z-10 bg-surface-sunken">Todos</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(totais.leads_total)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(totais.leads_novos)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(totais.agendamentos)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(totais.compareceram)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(totais.faltas)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(totais.contratados)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtPct(totais.contratados, totais.compareceram)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtPct(totais.contratados, totais.leads_novos)}</TableCell>
                      <TableCell className="text-right tabular-nums">{totais.receita > 0 ? brl.format(totais.receita) : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{totais.pagantes > 0 ? brl.format(totais.receita / totais.pagantes) : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(totais.contratados_etapa)}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>

          <p className="rounded-xl bg-muted px-4 py-3 text-[13px] leading-relaxed text-muted-foreground [&_strong]:font-semibold [&_strong]:text-foreground">
            Cada lead conta no funil em que está hoje. "Novos" são leads criados no período; agendamentos e contratos são
            consultas por data agendada no período; receita são pagamentos no período de pacientes ligados a leads do funil,{" "}
            {ressalvaRecorrente}sem lançamentos marcados como "não marketing".
            {" "}
            <strong className="font-medium">Fechamento</strong> = contratados ÷ compareceram, os dois lados da mesma safra
            de consultas do período: é a taxa que compara procedimento com procedimento, e a que elege o destaque.
            {" "}
            <strong className="font-medium">Contratos ÷ novos</strong> divide as consultas com contrato do período (de leads
            de qualquer época) pelos leads criados no período, então mistura safras, serve só de leitura de volume e pode
            passar de 100% — quando passa, vem marcada com *.
          </p>
        </>
      )}
    </div>
  );
}
