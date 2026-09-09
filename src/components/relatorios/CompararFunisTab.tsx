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
 */

type LinhaFunil = {
  pipeline_id: string; nome: string; posicao: number | null;
  leads_total: number; leads_novos: number;
  agendamentos: number; compareceram: number; faltas: number; contratados: number;
  contratados_etapa: number; receita: number; pagantes: number;
};

type Ordem = "posicao" | "conversao" | "receita" | "novos" | "agendamentos";

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const razao = (n: number, d: number): number | null => (d > 0 ? n / d : null);

function Barra({ valor, max, cor }: { valor: number; max: number; cor: string }) {
  const w = max > 0 ? Math.max(2, Math.round((valor / max) * 100)) : 0;
  return (
    <div className="mt-1 h-1.5 w-full rounded bg-muted">
      <div className={`h-1.5 rounded ${cor}`} style={{ width: `${valor > 0 ? w : 0}%` }} />
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
    if (ordem === "conversao") l = l.sort((a, b) => conv(b) - conv(a) || b.contratados - a.contratados);
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
  const maxReceita = Math.max(0, ...visiveis.map((x) => x.receita));
  const melhorConv = visiveis.filter((x) => x.leads_novos >= 5 && x.contratados > 0)
    .sort((a, b) => (razao(b.contratados, b.leads_novos) ?? 0) - (razao(a.contratados, a.leads_novos) ?? 0))[0];
  const maiorReceita = visiveis.filter((x) => x.receita > 0).sort((a, b) => b.receita - a.receita)[0];

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-4 p-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase text-muted-foreground">Período</span>
          <DateRangeFilter value={periodo} onChange={setPeriodo} excludePresets={["all", "multi"]} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase text-muted-foreground">Ordenar por</span>
          <Select value={ordem} onValueChange={(v) => setOrdem(v as Ordem)}>
            <SelectTrigger className="h-8 w-[190px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="posicao">Ordem dos funis</SelectItem>
              <SelectItem value="conversao">Conversão</SelectItem>
              <SelectItem value="receita">Receita</SelectItem>
              <SelectItem value="novos">Leads novos</SelectItem>
              <SelectItem value="agendamentos">Agendamentos</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={ocultarVazios} onCheckedChange={setOcultarVazios} /> Ocultar funis vazios
        </label>
        <div className="ml-auto flex items-center gap-2">
          {carregando && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <Button variant="outline" size="sm" onClick={carregar} disabled={carregando} title="Atualizar">
            <RefreshCw size={14} className={carregando ? "animate-spin" : ""} />
          </Button>
        </div>
      </Card>

      {erro ? (
        <Card className="flex flex-wrap items-center gap-3 border-destructive/50 bg-destructive/5 px-5 py-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
          <div className="min-w-[200px] flex-1">
            <p className="text-sm font-medium text-destructive">Não foi possível carregar</p>
            <p className="mt-0.5 break-words text-xs text-muted-foreground">{erro}</p>
          </div>
          <Button variant="outline" size="sm" onClick={carregar}>Tentar novamente</Button>
        </Card>
      ) : !linhas ? (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-[92px] rounded-xl" />
            <Skeleton className="h-[92px] rounded-xl" />
          </div>
          <Skeleton className="h-[320px] rounded-xl" />
        </>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="flex items-center gap-4 p-4">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                <Trophy size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Melhor conversão no período</p>
                {melhorConv ? (
                  <>
                    <p className="truncate text-lg font-semibold text-foreground">{melhorConv.nome}</p>
                    <p className="text-xs text-muted-foreground">
                      {fmtPct(melhorConv.contratados, melhorConv.leads_novos)} · {fmtInt(melhorConv.contratados)} contrato{melhorConv.contratados === 1 ? "" : "s"} de {fmtInt(melhorConv.leads_novos)} leads novos
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Nenhum funil com pelo menos 5 leads novos e um contrato no período.</p>
                )}
              </div>
            </Card>
            <Card className="flex items-center gap-4 p-4">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                <Wallet size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Maior receita no período</p>
                {maiorReceita ? (
                  <>
                    <p className="truncate text-lg font-semibold text-foreground">{maiorReceita.nome}</p>
                    <p className="text-xs text-muted-foreground">
                      {brl.format(maiorReceita.receita)} · {fmtInt(maiorReceita.pagantes)} paciente{maiorReceita.pagantes === 1 ? "" : "s"} pagante{maiorReceita.pagantes === 1 ? "" : "s"}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Nenhum pagamento no período ligado a leads dos funis.</p>
                )}
              </div>
            </Card>
          </div>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 z-10 bg-card">Funil</TableHead>
                    <TableHead className="text-right" title="Leads que estão no funil hoje">Leads no funil</TableHead>
                    <TableHead className="text-right" title="Leads criados no período que estão no funil hoje">Novos</TableHead>
                    <TableHead className="text-right" title="Consultas por data agendada no período (sem canceladas)">Agendamentos</TableHead>
                    <TableHead className="text-right" title="Contratou ou não contratou = compareceu">Compareceram</TableHead>
                    <TableHead className="text-right">Faltas</TableHead>
                    <TableHead className="text-right" title="Consultas com contrato no período">Contratados</TableHead>
                    <TableHead className="min-w-[150px] text-right" title="Contratados ÷ leads novos no período">Conversão</TableHead>
                    <TableHead className="min-w-[150px] text-right" title="Pagamentos no período de pacientes ligados a leads do funil">Receita</TableHead>
                    <TableHead className="text-right" title="Receita ÷ pacientes pagantes">Ticket</TableHead>
                    <TableHead className="text-right" title="Leads hoje na etapa Contratado do funil (base histórica)">Na etapa Contratado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visiveis.length === 0 && (
                    <TableRow><TableCell colSpan={11} className="py-10 text-center text-sm text-muted-foreground">Nenhum funil com dados no período.</TableCell></TableRow>
                  )}
                  {visiveis.map((x) => {
                    const conv = razao(x.contratados, x.leads_novos);
                    return (
                      <TableRow key={x.pipeline_id}>
                        <TableCell className="sticky left-0 z-10 bg-card font-medium text-foreground">{x.nome}</TableCell>
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
                        <TableCell className="text-right tabular-nums">
                          {fmtInt(x.contratados)}
                          <div className="text-[11px] text-muted-foreground">{fmtPct(x.contratados, x.compareceram)} dos que compareceram</div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <span className="font-semibold text-foreground">{conv === null ? "—" : fmtPct(x.contratados, x.leads_novos)}</span>
                          <Barra valor={conv ?? 0} max={maxConv} cor="bg-emerald-500" />
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
                    <TableRow className="bg-muted/40 font-semibold">
                      <TableCell className="sticky left-0 z-10 bg-muted/40">Todos</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(totais.leads_total)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(totais.leads_novos)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(totais.agendamentos)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(totais.compareceram)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(totais.faltas)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(totais.contratados)}</TableCell>
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

          <p className="text-[11px] text-muted-foreground">
            Cada lead conta no funil em que está hoje. "Novos" são leads criados no período; agendamentos e contratos são
            consultas por data agendada no período; receita são pagamentos no período de pacientes ligados a leads do funil,
            sem recorrência de ortodontia e sem lançamentos marcados como "não marketing". Conversão = contratados ÷ novos.
          </p>
        </>
      )}
    </div>
  );
}
