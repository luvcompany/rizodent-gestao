import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateRangeFilter, getDateRangeFromFilter, type DateRangeFilterValue } from "@/components/ui/date-range-filter";
import { Loader2, TrendingUp, TrendingDown, Award, Clock, MessageSquare, BarChart3 } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { fetchAllPaged, rangeBahia, dayKeyBahia, asDateParam, classifyOrigemCanonica, normalizeCidade, ORIGENS_CANONICAS } from "@/lib/reportKit";

type Pipeline = { id: string; name: string };
type Lead = {
  id: string; name: string; pipeline_id: string; cidade: string | null;
  source: string | null; nome_anuncio: string | null; ad_id: string | null;
  created_at: string; first_inbound_at: string | null;
  paciente_id: string | null;
};
type Appointment = { id: string; lead_id: string; scheduled_date: string; status: string; created_at: string };
type Msg = { lead_id: string; direction: string; created_at: string };
type Pagamento = { paciente_id: string; tipo: string; data_pagamento: string; valor: number | string | null };

// Linha agregada da RPC rpt_origem_conversao (migração 20260708020000):
// APENAS agregados por origem canônica — nenhum dado individual de lead.
type OrigemAggRow = {
  origem: string;
  leads: number;
  atendidos: number;
  agendados: number;
  compareceram: number;
  contratados: number;
  faturamento: number;
};

const CITIES = ["Vitória da Conquista", "Guanambi", "Itabuna", "Ipiaú"];

function pct(num: number, den: number): string {
  if (!den) return "—";
  return `${((num / den) * 100).toFixed(1)}%`;
}

/** Coerção defensiva (numeric/bigint podem chegar como string do PostgREST). */
function asNum(v: unknown): number {
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

// Tolerância para defasagem de cadastro: 1º pagamento até 30 dias ANTES da
// criação do lead ainda conta como contratação da coorte (na prática o
// pagamento fica 1–7 dias antes quando o lead é cadastrado com atraso).
// Pagamento mais antigo que isso é contrato antigo de um paciente que voltou
// a escrever — não pode inflar a conversão da coorte.
const TOLERANCIA_CONTRATO_DIAS = 30;

/** Menor dia (YYYY-MM-DD, America/Bahia) de 1º pagamento aceito como contratação do lead. */
function diaMinimoContrato(leadCreatedAt: string): string {
  const [y, m, d] = dayKeyBahia(leadCreatedAt).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - TOLERANCIA_CONTRATO_DIAS)).toISOString().slice(0, 10);
}

interface Props {
  pipelineId: string;
  pipelines: Pipeline[];
  setPipelineId: (id: string) => void;
}

export default function OrigemConversaoTab({ pipelineId, pipelines, setPipelineId }: Props) {
  const [period, setPeriod] = useState<DateRangeFilterValue>({ preset: "this_month" });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [pagamentos, setPagamentos] = useState<Pagamento[]>([]);
  // Agregados por origem vindos da RPC canônica (SECURITY DEFINER) — mesmos
  // números para todos os usuários do tenant. null = RPC indisponível, o
  // ranking cai no cálculo do navegador (client + RLS) e rpcAviso explica.
  const [rpcRows, setRpcRows] = useState<OrigemAggRow[] | null>(null);
  const [rpcAviso, setRpcAviso] = useState<string | null>(null);
  const [tz, setTz] = useState<string>("America/Sao_Paulo");

  // "todos" (ou vazio, enquanto a página carrega os funis) = sem filtro de funil.
  const pipelineFiltro = pipelineId && pipelineId !== "todos" ? pipelineId : null;

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("tenants").select("timezone").limit(1).maybeSingle();
      if (data?.timezone) setTz(data.timezone);
    })();
  }, []);

  useEffect(() => {
    const range = getDateRangeFromFilter(period);
    if (!range) return;
    // Fronteiras do período em America/Bahia, com dias INTEIROS nas duas pontas —
    // corrige o preset "Últimos 7 dias", que vinha sem startOfDay/endOfDay.
    const { gteIso, lteIso } = rangeBahia(range.start, range.end);
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        // RPC canônica (SECURITY DEFINER, tenant resolvido no servidor): agregados
        // por origem IGUAIS para qualquer usuário do tenant. A classificação de
        // origem da RPC espelha classifyOrigemCanonica (src/lib/reportKit.ts) —
        // SINCRONIA com a migração 20260708020000_rpt_origem_conversao.sql.
        // Se a função ainda não existir no banco (PGRST202), o ranking cai no
        // cálculo do navegador (client + RLS) com aviso discreto — nunca quebra.
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- types.ts gerado ainda não conhece a RPC
          const { data, error } = await (supabase.rpc as any)("rpt_origem_conversao", {
            p_from: asDateParam(range.start),
            p_to: asDateParam(range.end),
            p_pipeline_id: pipelineFiltro,
          });
          if (error) throw error;
          if (!cancelled) {
            setRpcRows(((data ?? []) as Record<string, unknown>[]).map(r => ({
              origem: String(r.origem ?? "Outros"),
              leads: asNum(r.leads),
              atendidos: asNum(r.atendidos),
              agendados: asNum(r.agendados),
              compareceram: asNum(r.compareceram),
              contratados: asNum(r.contratados),
              faturamento: asNum(r.faturamento),
            })));
            setRpcAviso(null);
          }
        } catch (rpcErrRaw) {
          if (!cancelled) {
            const rpcErr = rpcErrRaw as { code?: string; message?: string } | null;
            const msg = rpcErr?.message || "erro desconhecido";
            const naoInstalada = rpcErr?.code === "PGRST202" || /schema cache|does not exist/i.test(msg);
            setRpcRows(null);
            setRpcAviso(naoInstalada
              ? "Ranking calculado no navegador conforme as suas permissões (função rpt_origem_conversao ainda não instalada no banco) — os números podem variar entre usuários."
              : `Ranking calculado no navegador conforme as suas permissões — falha na função do servidor: ${msg}`);
          }
        }

        // COORTE FECHADA: a população é sempre a mesma — leads CRIADOS no período
        // (no funil selecionado, quando houver). Agendamentos, mensagens e
        // pagamentos são buscados PARA ESSES leads, em qualquer data, para que
        // todos os degraus descrevam a mesma coorte.
        // fetchAllPaged pagina com ORDER BY estável (PostgREST corta em 1000).
        const allLeads = await fetchAllPaged<Lead>(() => {
          let q = supabase
            .from("crm_leads")
            .select("id,name,pipeline_id,cidade,source,nome_anuncio,ad_id,created_at,first_inbound_at,paciente_id")
            .gte("created_at", gteIso)
            .lte("created_at", lteIso);
          if (pipelineFiltro) q = q.eq("pipeline_id", pipelineFiltro);
          return q;
        }, "id");

        const leadIds = allLeads.map(l => l.id);
        const pacIds = allLeads.map(l => l.paciente_id).filter(Boolean) as string[];

        // Buscar em chunks de 200 para evitar URL longa demais
        const CHUNK = 200;
        let allAppts: Appointment[] = [];
        let allMsgs: Msg[] = [];
        let allPagamentos: Pagamento[] = [];

        for (let i = 0; i < leadIds.length; i += CHUNK) {
          const chunk = leadIds.slice(i, i + CHUNK);
          const aps = await fetchAllPaged<Appointment>(() => supabase
            .from("crm_appointments")
            .select("id,lead_id,scheduled_date,status,created_at")
            .in("lead_id", chunk), "id");
          allAppts = allAppts.concat(aps);

          const ms = await fetchAllPaged<Msg>(() => supabase
            .from("messages")
            .select("lead_id,direction,created_at")
            .in("lead_id", chunk), "id");
          allMsgs = allMsgs.concat(ms);
        }

        // Pagamentos (TODOS, sem recorte de período): fonte da verdade de contratação —
        // o menor data_pagamento do paciente é o primeiro pagamento global.
        for (let i = 0; i < pacIds.length; i += CHUNK) {
          const chunk = pacIds.slice(i, i + CHUNK);
          const pgs = await fetchAllPaged<Pagamento>(() => supabase
            .from("pagamentos")
            .select("paciente_id,tipo,data_pagamento,valor")
            .in("paciente_id", chunk), "id");
          allPagamentos = allPagamentos.concat(pgs);
        }

        if (cancelled) return;
        setLeads(allLeads);
        setAppts(allAppts);
        setMsgs(allMsgs);
        setPagamentos(allPagamentos);
      } catch (e: any) {
        if (cancelled) return;
        setLeads([]); setAppts([]); setMsgs([]); setPagamentos([]);
        setLoadError(e?.message || "Erro desconhecido ao carregar os dados");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [period, pipelineFiltro]);

  // City × Origin matrix (cidade normalizada + origem canônica)
  const cityOrigin = useMemo(() => {
    const m: Record<string, Record<string, number>> = {};
    [...CITIES, "Outras"].forEach(c => { m[c] = {}; ORIGENS_CANONICAS.forEach(o => m[c][o] = 0); });
    leads.forEach(l => {
      const cidade = normalizeCidade(l.cidade);
      const city = CITIES.includes(cidade) ? cidade : "Outras";
      const origem = classifyOrigemCanonica(l);
      m[city][origem]++;
    });
    return m;
  }, [leads]);

  // Response rates: primeiro outbound APÓS o primeiro inbound (não o primeiro outbound absoluto,
  // que costuma ser o template inicial enviado antes do lead responder).
  const responseStats = useMemo(() => {
    const firstInboundByLead = new Map<string, Date>();
    const outboundsByLead = new Map<string, Date[]>();
    msgs.forEach(m => {
      const t = new Date(m.created_at);
      if (m.direction === "inbound") {
        const cur = firstInboundByLead.get(m.lead_id);
        if (!cur || t < cur) firstInboundByLead.set(m.lead_id, t);
      } else if (m.direction === "outbound") {
        if (!outboundsByLead.has(m.lead_id)) outboundsByLead.set(m.lead_id, []);
        outboundsByLead.get(m.lead_id)!.push(t);
      }
    });
    // "Nunca escreveu" (sem nenhum inbound) é separado de "não respondido"
    // (escreveu e a equipe não respondeu) — antes os dois caíam no mesmo balde.
    let in1h = 0, sameDay = 0, in24h = 0, notAnswered = 0, neverWrote = 0, totalAnswered = 0;
    const answeredIds = new Set<string>();
    leads.forEach(l => {
      const ib = firstInboundByLead.get(l.id) || (l.first_inbound_at ? new Date(l.first_inbound_at) : null);
      if (!ib) { neverWrote++; return; }
      const obs = outboundsByLead.get(l.id) || [];
      // primeiro outbound APÓS o primeiro inbound
      let after: Date | null = null;
      for (const t of obs) {
        if (t > ib && (!after || t < after)) after = t;
      }
      if (!after) { notAnswered++; return; }
      totalAnswered++;
      answeredIds.add(l.id);
      const diff = after.getTime() - ib.getTime();
      if (diff <= 3600_000) in1h++;
      if (after.toDateString() === ib.toDateString()) sameDay++;
      if (diff <= 86400_000) in24h++;
    });
    return { total: leads.length, totalAnswered, answeredIds, in1h, sameDay, in24h, notAnswered, neverWrote };
  }, [leads, msgs]);

  // ---- NOVOS INDICADORES (topo) ----

  // Tempo médio até 1ª resposta: média de (1º outbound após 1º inbound) - (1º inbound)
  const avgFirstResponseSec = useMemo(() => {
    const firstInboundByLead = new Map<string, Date>();
    const outboundsByLead = new Map<string, Date[]>();
    msgs.forEach(m => {
      const t = new Date(m.created_at);
      if (m.direction === "inbound") {
        const cur = firstInboundByLead.get(m.lead_id);
        if (!cur || t < cur) firstInboundByLead.set(m.lead_id, t);
      } else if (m.direction === "outbound") {
        if (!outboundsByLead.has(m.lead_id)) outboundsByLead.set(m.lead_id, []);
        outboundsByLead.get(m.lead_id)!.push(t);
      }
    });
    let sum = 0, n = 0;
    leads.forEach(l => {
      const ib = firstInboundByLead.get(l.id) || (l.first_inbound_at ? new Date(l.first_inbound_at) : null);
      if (!ib) return;
      const obs = outboundsByLead.get(l.id) || [];
      let after: Date | null = null;
      for (const t of obs) if (t > ib && (!after || t < after)) after = t;
      if (!after) return;
      sum += (after.getTime() - ib.getTime()) / 1000;
      n++;
    });
    return n ? Math.round(sum / n) : 0;
  }, [leads, msgs]);

  // Primeiro inbound por lead (base para as duas métricas abaixo)
  const firstInboundByLeadAll = useMemo(() => {
    const map = new Map<string, Date>();
    msgs.forEach(m => {
      if (m.direction !== "inbound") return;
      const t = new Date(m.created_at);
      const cur = map.get(m.lead_id);
      if (!cur || t < cur) map.set(m.lead_id, t);
    });
    return map;
  }, [msgs]);

  // Tempo médio até agendamento: 1º inbound → primeiro appointment criado (qualquer status).
  // Considera SOMENTE leads que efetivamente foram agendados.
  const avgTimeToScheduleSec = useMemo(() => {
    const firstApptByLead = new Map<string, Date>();
    appts.forEach(a => {
      if (!a.created_at) return;
      const t = new Date(a.created_at);
      const cur = firstApptByLead.get(a.lead_id);
      if (!cur || t < cur) firstApptByLead.set(a.lead_id, t);
    });
    let sum = 0, n = 0;
    firstApptByLead.forEach((end, leadId) => {
      const ib = firstInboundByLeadAll.get(leadId);
      if (!ib) return;
      const diff = (end.getTime() - ib.getTime()) / 1000;
      if (diff <= 0) return;
      sum += diff; n++;
    });
    return n ? Math.round(sum / n) : 0;
  }, [appts, firstInboundByLeadAll]);

  // Primeiro pagamento GLOBAL por paciente (menor data_pagamento — fonte da verdade
  // de contratação; os pagamentos são buscados sem recorte de período).
  const primeiroPagamentoByPaciente = useMemo(() => {
    const m = new Map<string, string>();
    pagamentos.forEach(p => {
      if (!p.paciente_id || !p.data_pagamento) return;
      const cur = m.get(p.paciente_id);
      if (!cur || p.data_pagamento < cur) m.set(p.paciente_id, p.data_pagamento);
    });
    return m;
  }, [pagamentos]);

  // Tempo médio até contratação: 1º inbound → data do 1º pagamento do paciente
  // vinculado (fonte da verdade). Fallback: scheduled_date do 1º appointment
  // 'contracted'. NUNCA usa updated_at (muda em qualquer edição e inflava a média).
  const avgTimeToContractSec = useMemo(() => {
    const firstContractedApptByLead = new Map<string, string>();
    appts.forEach(a => {
      if (a.status !== "contracted" || !a.scheduled_date) return;
      const day = String(a.scheduled_date).slice(0, 10);
      const cur = firstContractedApptByLead.get(a.lead_id);
      if (!cur || day < cur) firstContractedApptByLead.set(a.lead_id, day);
    });
    let sum = 0, n = 0;
    leads.forEach(l => {
      const pagto = l.paciente_id ? primeiroPagamentoByPaciente.get(l.paciente_id) : undefined;
      const endDay = pagto || firstContractedApptByLead.get(l.id);
      if (!endDay) return;
      const ib = firstInboundByLeadAll.get(l.id) || (l.first_inbound_at ? new Date(l.first_inbound_at) : null);
      if (!ib) return;
      // data (DATE) → meio-dia em America/Bahia para comparar com timestamps
      const end = new Date(`${endDay}T12:00:00-03:00`);
      const diff = (end.getTime() - ib.getTime()) / 1000;
      if (diff <= 0) return;
      sum += diff; n++;
    });
    return n ? Math.round(sum / n) : 0;
  }, [leads, appts, primeiroPagamentoByPaciente, firstInboundByLeadAll]);

  // Volume de conversas por hora (hora local do fuso da clínica) — conta leads
  // distintos que iniciaram conversa (1º inbound) naquela hora.
  const hourlyVolume = useMemo(() => {
    const firstInboundByLead = new Map<string, Date>();
    msgs.forEach(m => {
      if (m.direction !== "inbound") return;
      const t = new Date(m.created_at);
      const cur = firstInboundByLead.get(m.lead_id);
      if (!cur || t < cur) firstInboundByLead.set(m.lead_id, t);
    });
    const buckets = Array.from({ length: 24 }, (_, h) => ({ hora: `${String(h).padStart(2, "0")}h`, total: 0 }));
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hour12: false });
    firstInboundByLead.forEach(d => {
      let h = parseInt(fmt.format(d), 10);
      if (!Number.isFinite(h)) return;
      if (h === 24) h = 0;
      buckets[h].total++;
    });
    return buckets;
  }, [msgs, tz]);

  const totalHourly = useMemo(() => hourlyVolume.reduce((s, b) => s + b.total, 0), [hourlyVolume]);

  const fmtDuration = (sec: number) => {
    const total = Math.max(0, Math.floor(sec || 0));
    const d = Math.floor(total / 86400);
    const remaining = total % 86400;
    const h = Math.floor(remaining / 3600);
    const m = Math.floor((remaining % 3600) / 60);
    const s = remaining % 60;
    return { d, h, m, s, hasDays: d > 0, hasHours: h > 0 || d > 0 };
  };

  // Contratado (fonte da verdade = pagamentos): lead da coorte cujo paciente
  // vinculado tem pagamento registrado. O status 'contracted' de appointment
  // subcontava ~54% dos contratos reais.
  // Guarda de coorte: só conta se o 1º pagamento for >= criação do lead menos
  // TOLERANCIA_CONTRATO_DIAS — paciente antigo revinculado não vira "contratado".
  const contractedLeadIds = useMemo(() => {
    const ids = new Set<string>();
    leads.forEach(l => {
      if (!l.paciente_id) return;
      const primeiro = primeiroPagamentoByPaciente.get(l.paciente_id);
      if (primeiro && primeiro >= diaMinimoContrato(l.created_at)) ids.add(l.id);
    });
    return ids;
  }, [leads, primeiroPagamentoByPaciente]);

  // Funnel em COORTE FECHADA: todos os degraus contam LEADS criados no período
  // (agendamentos/contratos desses leads em qualquer data) — nunca mistura
  // populações nem passa de 100%.
  const funnel = useMemo(() => {
    const totalLeads = leads.length;
    const answered = responseStats.totalAnswered;
    const scheduledLeads = new Set<string>();
    const showedLeads = new Set<string>();
    const noShowLeads = new Set<string>();
    appts.forEach(a => {
      scheduledLeads.add(a.lead_id);
      if (a.status === "contracted" || a.status === "not_contracted") showedLeads.add(a.lead_id);
      if (a.status === "no_show") noShowLeads.add(a.lead_id);
    });
    // lead que compareceu em algum agendamento não conta como falta
    const noShowOnly = [...noShowLeads].filter(id => !showedLeads.has(id));
    const scheduled = scheduledLeads.size;
    const showed = showedLeads.size;
    const noShow = noShowOnly.length;
    const contracted = contractedLeadIds.size;
    const contractedShowed = [...showedLeads].filter(id => contractedLeadIds.has(id)).length;
    // Atendido → Agendado usa a interseção (atendido E agendado): agendamento
    // criado sem nenhuma conversa não entra no degrau (senão passaria de 100%).
    const scheduledAnswered = [...scheduledLeads].filter(id => responseStats.answeredIds.has(id)).length;
    return {
      totalLeads, answered, scheduled, showed, noShow, contracted,
      attendanceRate: pct(showed, showed + noShow),
      leadToAnswered: pct(answered, totalLeads),
      answeredToScheduled: pct(scheduledAnswered, answered),
      scheduledToShowed: pct(showed, scheduled),
      showedToContracted: pct(contractedShowed, showed),
      leadToContracted: pct(contracted, totalLeads),
    };
  }, [leads, appts, responseStats, contractedLeadIds]);

  // Ranking por origem — TODAS as origens aparecem (nada de descarte silencioso
  // de origens com poucos leads; amostras pequenas são sinalizadas na tabela).
  // Fonte preferida: RPC rpt_origem_conversao (servidor, mesmos números para
  // todo usuário do tenant). Fallback: cálculo no navegador (client + RLS),
  // com a MESMA classificação canônica e contratado por pagamento.
  const ranking = useMemo(() => {
    if (rpcRows) {
      return rpcRows
        .map(r => ({
          origem: r.origem,
          leads: r.leads,
          contracted: r.contratados,
          faturamento: r.faturamento,
          rate: r.leads ? r.contratados / r.leads : 0,
        }))
        .sort((a, b) => b.rate - a.rate || b.leads - a.leads);
    }
    // Fallback (client + RLS)
    const totalByPaciente = new Map<string, number>();
    pagamentos.forEach(p => {
      if (!p.paciente_id) return;
      totalByPaciente.set(p.paciente_id, (totalByPaciente.get(p.paciente_id) || 0) + asNum(p.valor));
    });
    const byOrigem: Record<string, { leads: number; contracted: number; pacientes: Set<string> }> = {};
    leads.forEach(l => {
      const o = classifyOrigemCanonica(l);
      if (!byOrigem[o]) byOrigem[o] = { leads: 0, contracted: 0, pacientes: new Set() };
      byOrigem[o].leads++;
      if (contractedLeadIds.has(l.id)) {
        byOrigem[o].contracted++;
        // paciente distinto por origem: dois leads do mesmo paciente não somam 2×
        if (l.paciente_id) byOrigem[o].pacientes.add(l.paciente_id);
      }
    });
    return Object.entries(byOrigem)
      .map(([k, v]) => ({
        origem: k,
        leads: v.leads,
        contracted: v.contracted,
        faturamento: [...v.pacientes].reduce((s, pid) => s + (totalByPaciente.get(pid) || 0), 0),
        rate: v.leads ? v.contracted / v.leads : 0,
      }))
      .sort((a, b) => b.rate - a.rate || b.leads - a.leads);
  }, [rpcRows, leads, contractedLeadIds, pagamentos]);


  return (
    <div className="space-y-6">
      <Card className="p-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground uppercase">Funil</span>
          {/* Seletor de funil da página, agora efetivo: filtra a coorte inteira
              da aba (todas as tabelas/indicadores) e a RPC do ranking. */}
          <Select value={pipelineId || "todos"} onValueChange={setPipelineId}>
            <SelectTrigger className="w-[220px] h-9">
              <SelectValue placeholder="Todos os funis" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os funis</SelectItem>
              {pipelines.map(p => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground uppercase">Período</span>
          {/* "multi" bloqueado: getDateRangeFromFilter colapsa períodos disjuntos
              no envelope [min,max] e somaria os dias intermediários. */}
          <DateRangeFilter value={period} onChange={setPeriod} excludePresets={["all", "multi"]} />
        </div>
        {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      </Card>

      <p className="text-[11px] text-muted-foreground">
        Coorte fechada: todos os números referem-se aos leads criados no período{pipelineFiltro ? " no funil selecionado" : ""} (agendamentos e contratações desses leads em qualquer data).
        Contratado = paciente vinculado com pagamento registrado. Fora o Ranking por Origem (calculado no servidor quando disponível), os dados refletem os funis visíveis ao seu usuário — perfis com permissões diferentes podem ver totais diferentes.
      </p>

      {loadError ? (
        <Card className="p-4 border-destructive/50 bg-destructive/10">
          <p className="text-sm font-medium text-destructive">Erro ao carregar os dados do relatório</p>
          <p className="text-xs text-muted-foreground mt-1">{loadError}</p>
        </Card>
      ) : (
      <>
      {/* Indicadores de atendimento */}
      <div className="grid gap-4 md:grid-cols-3">
        {[
          {
            title: "Tempo médio até agendamento",
            icon: <Clock className="w-4 h-4 text-muted-foreground" />,
            sec: avgTimeToScheduleSec,
            hint: "Do 1º contato do lead até o momento em que ele foi agendado (só leads agendados).",
          },
          {
            title: "Tempo médio até contratação",
            icon: <Award className="w-4 h-4 text-muted-foreground" />,
            sec: avgTimeToContractSec,
            hint: "Do 1º contato do lead até a data do 1º pagamento (ou do agendamento contratado, se não houver pagamento vinculado).",
          },
          {
            title: "Tempo médio até primeira resposta",
            icon: <MessageSquare className="w-4 h-4 text-muted-foreground" />,
            sec: avgFirstResponseSec,
            hint: "Do 1º inbound do lead até a 1ª resposta da equipe.",
          },
        ].map((card) => {
          const d = fmtDuration(card.sec);
          return (
            <Card key={card.title} className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-sm">{card.title}</h3>
                {card.icon}
              </div>
              <div className="flex items-baseline justify-center gap-3">
                {d.hasDays && (
                  <>
                    <div className="text-5xl font-bold tracking-tight">{d.d}</div>
                    <div className="text-3xl text-muted-foreground">d</div>
                  </>
                )}
                {d.hasHours && (
                  <>
                    <div className="text-5xl font-bold tracking-tight">{d.hasDays ? String(d.h).padStart(2, "0") : d.h}</div>
                    <div className="text-3xl text-muted-foreground">:</div>
                  </>
                )}
                <div className="text-5xl font-bold tracking-tight">{d.hasHours ? String(d.m).padStart(2, "0") : d.m}</div>
                <div className="text-3xl text-muted-foreground">:</div>
                <div className="text-5xl font-bold tracking-tight">{String(d.s).padStart(2, "0")}</div>
              </div>
              <div className="flex justify-center gap-8 mt-2 text-xs text-muted-foreground">
                {d.hasDays && <span>dias</span>}
                {d.hasHours && <span>horas</span>}
                <span>minutos</span>
                <span>segundos</span>
              </div>
              <p className="text-[11px] text-muted-foreground text-center mt-3">{card.hint}</p>
            </Card>
          );
        })}
      </div>

      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-muted-foreground" />
            Volume de conversas por hora
          </h3>
          <div className="text-2xl font-bold">{totalHourly}</div>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={hourlyVolume} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted" />
              <XAxis dataKey="hora" tick={{ fontSize: 11 }} interval={0} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6 }}
                labelStyle={{ color: "hsl(var(--foreground))" }}
              />
              <Line type="monotone" dataKey="total" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          Novas conversas iniciadas por hora, no fuso horário da clínica ({tz}).
        </p>
      </Card>



      {/* Cidade × Origem */}
      <Card className="p-4">
        <h3 className="font-semibold mb-3">Leads por Cidade × Origem</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Origem</TableHead>
              {CITIES.map(c => <TableHead key={c} className="text-right">{c}</TableHead>)}
              <TableHead className="text-right">Outras</TableHead>
              <TableHead className="text-right font-bold">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ORIGENS_CANONICAS.map(o => {
              const total = [...CITIES, "Outras"].reduce((s, c) => s + (cityOrigin[c]?.[o] || 0), 0);
              return (
                <TableRow key={o}>
                  <TableCell className="font-medium">{o}</TableCell>
                  {CITIES.map(c => <TableCell key={c} className="text-right">{cityOrigin[c]?.[o] || 0}</TableCell>)}
                  <TableCell className="text-right">{cityOrigin["Outras"]?.[o] || 0}</TableCell>
                  <TableCell className="text-right font-bold">{total}</TableCell>
                </TableRow>
              );
            })}
            <TableRow className="border-t-2">
              <TableCell className="font-bold">Total</TableCell>
              {CITIES.map(c => {
                const t = ORIGENS_CANONICAS.reduce((s, o) => s + (cityOrigin[c]?.[o] || 0), 0);
                return <TableCell key={c} className="text-right font-bold">{t}</TableCell>;
              })}
              <TableCell className="text-right font-bold">
                {ORIGENS_CANONICAS.reduce((s, o) => s + (cityOrigin["Outras"]?.[o] || 0), 0)}
              </TableCell>
              <TableCell className="text-right font-bold">{leads.length}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Card>

      {/* Tempo de Resposta */}
      <Card className="p-4">
        <h3 className="font-semibold mb-3">Leads Atendidos (Tempo de Resposta)</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="p-3 rounded border bg-card">
            <div className="text-xs text-muted-foreground">Total leads</div>
            <div className="text-2xl font-bold">{responseStats.total}</div>
          </div>
          <div className="p-3 rounded border bg-card">
            <div className="text-xs text-muted-foreground">Respondidos em ≤1h</div>
            <div className="text-2xl font-bold text-emerald-600">{responseStats.in1h}</div>
            <div className="text-xs text-muted-foreground">{pct(responseStats.in1h, responseStats.total)}</div>
          </div>
          <div className="p-3 rounded border bg-card">
            <div className="text-xs text-muted-foreground">Mesmo dia</div>
            <div className="text-2xl font-bold text-blue-600">{responseStats.sameDay}</div>
            <div className="text-xs text-muted-foreground">{pct(responseStats.sameDay, responseStats.total)}</div>
          </div>
          <div className="p-3 rounded border bg-card">
            <div className="text-xs text-muted-foreground">Em 24h</div>
            <div className="text-2xl font-bold">{responseStats.in24h}</div>
            <div className="text-xs text-muted-foreground">{pct(responseStats.in24h, responseStats.total)}</div>
          </div>
          <div className="p-3 rounded border bg-card">
            <div className="text-xs text-muted-foreground">Não respondidos</div>
            <div className="text-2xl font-bold text-rose-600">{responseStats.notAnswered}</div>
            <div className="text-xs text-muted-foreground">{pct(responseStats.notAnswered, responseStats.total - responseStats.neverWrote)} dos que escreveram</div>
          </div>
          <div className="p-3 rounded border bg-card">
            <div className="text-xs text-muted-foreground">Nunca escreveram</div>
            <div className="text-2xl font-bold text-muted-foreground">{responseStats.neverWrote}</div>
            <div className="text-xs text-muted-foreground">{pct(responseStats.neverWrote, responseStats.total)} do total</div>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          "Não respondidos" = leads que escreveram e não receberam resposta da equipe. "Nunca escreveram" = leads sem nenhuma mensagem recebida (não é falha de atendimento).
        </p>
      </Card>

      {/* Funil */}
      <Card className="p-4">
        <h3 className="font-semibold mb-3">Funil de Conversão</h3>
        <div className="space-y-2">
          {[
            { label: "Lead → Atendido", value: funnel.leadToAnswered },
            { label: "Atendido → Agendado", value: funnel.answeredToScheduled },
            { label: "Agendado → Compareceu", value: funnel.scheduledToShowed },
            { label: "Compareceu → Contratado", value: funnel.showedToContracted },
            { label: "Lead → Contratado (geral)", value: funnel.leadToContracted, highlight: true },
          ].map(r => (
            <div key={r.label} className={`flex justify-between p-2 rounded ${r.highlight ? "bg-primary/10 font-bold" : "bg-muted/30"}`}>
              <span>{r.label}</span>
              <span>{r.value}</span>
            </div>
          ))}
          <div className="flex justify-between p-2 rounded bg-emerald-500/10">
            <span>Taxa de Comparecimento</span>
            <span className="font-bold">{funnel.attendanceRate}</span>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          Todos os degraus contam leads criados no período ({funnel.totalLeads} leads): {funnel.answered} atendidos, {funnel.scheduled} agendados, {funnel.showed} compareceram e {funnel.contracted} contrataram (pagamento registrado).
        </p>
      </Card>

      {/* Ranking */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card className="p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><Award className="w-4 h-4" /> Ranking por Origem</h3>
          {ranking.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem leads no período.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Origem</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">Contratados</TableHead>
                  <TableHead className="text-right">Faturamento</TableHead>
                  <TableHead className="text-right">Conversão</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Todas as origens aparecem — nada é descartado. Amostras com
                    menos de 5 leads são marcadas com * (taxa pouco confiável). */}
                {ranking.map((r, i) => (
                  <TableRow key={r.origem} className={r.leads < 5 ? "text-muted-foreground" : undefined}>
                    <TableCell className="font-medium">
                      {i === 0 && <TrendingUp className="inline w-3 h-3 text-emerald-600 mr-1" />}
                      {i === ranking.length - 1 && ranking.length > 1 && <TrendingDown className="inline w-3 h-3 text-rose-600 mr-1" />}
                      {r.origem}{r.leads < 5 ? " *" : ""}
                    </TableCell>
                    <TableCell className="text-right">{r.leads}</TableCell>
                    <TableCell className="text-right">{r.contracted}</TableCell>
                    <TableCell className="text-right">{brl.format(r.faturamento)}</TableCell>
                    <TableCell className="text-right font-bold">{(r.rate * 100).toFixed(1)}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="text-[11px] text-muted-foreground mt-2">
            Leads e conversão = leads criados no período. Faturamento = caixa recebido no período por origem do paciente (bate com o total do dashboard).
            {ranking.some(r => r.leads < 5) && " * Origem com menos de 5 leads: taxa de conversão pouco confiável (amostra pequena)."}
          </p>
          {rpcRows ? (
            <p className="text-[11px] text-muted-foreground mt-1">
              Calculado no servidor — mesmos números para todos os usuários da clínica.
            </p>
          ) : rpcAviso ? (
            <p className="text-[11px] text-amber-600 dark:text-amber-500 mt-1">{rpcAviso}</p>
          ) : null}
        </Card>

      </div>
      </>
      )}
    </div>
  );
}
