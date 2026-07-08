import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  AlertTriangle, UserX, Crown, Sparkles, RefreshCw, ArrowRight, Phone, Info
} from "lucide-react";
import { toast } from "sonner";
import { todayBahia, fetchAllPaged, rptContratados } from "@/lib/reportKit";

// ── Regras do painel (base = PACIENTES com pagamento, não leads de marketing) ─
// Em risco: 1º pagamento há mais de DIAS_RISCO dias E sem nenhum pagamento nos
//   últimos DIAS_RISCO dias (recorte validado em produção: ~38% da base, ao
//   contrário do antigo score<30 que capturava 99,8% dos leads).
// Sumido: sem pagamento há mais de DIAS_SUMIDO dias — só exibido quando o
//   histórico de pagamentos já cobre essa janela.
// VIP: valor pago acumulado >= VIP_VALOR_MIN (valor de cliente, não volume de
//   mensagens no WhatsApp).
// Recém-contratado: 1º pagamento (fonte da verdade: tabela pagamentos, via
//   rpt_contratados) nos últimos JANELA_RECEM_DIAS dias.
const DIAS_RISCO = 60;
const DIAS_SUMIDO = 180;
const VIP_VALOR_MIN = 5000;
const JANELA_RECEM_DIAS = 30;

type PacienteItem = {
  paciente_id: string;
  nome: string;
  telefone: string | null;
  lead_id: string | null;
  detalhe: string;
};

type Metrics = {
  pacientes_total: number;
  historico_inicio: string | null; // 1º pagamento da base (YYYY-MM-DD)
  em_risco_count: number;
  em_risco_top: PacienteItem[];
  sumidos_disponivel: boolean;
  sumidos_disponivel_em: string | null; // quando o indicador passa a existir
  sumidos_count: number;
  sumidos_top: PacienteItem[];
  vips_count: number;
  vips_top: PacienteItem[];
  recem_count: number | null; // null quando rpt_contratados falhou
  recem_top: PacienteItem[];
  recem_erro: string | null;
};

const ALLOWED_ROLES = ["posvenda", "crc", "gerente", "superadmin"];

// ── Datas/formatação (data_pagamento é DATE 'YYYY-MM-DD'; nunca usar
// new Date('YYYY-MM-DD'), que parseia como UTC e mostra o dia anterior) ──────
function addDiasDia(dia: string, n: number): string {
  const [y, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function fmtDia(dia: string): string {
  const [y, m, d] = dia.split("-");
  return `${d}/${m}/${y}`;
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** numeric pode chegar como string do PostgREST. */
function num(v: unknown): number {
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ── Cache ──────────────────────────────────────────────────────────────────
// v3: métricas por paciente (pagamentos), não mais posvenda_dashboard_metrics
const _pvCache: { userId: string | null; data: Metrics | null; ts: number } = {
  userId: null, data: null, ts: 0,
};
const PV_MODULE_TTL = 2 * 60_000;
const PV_LS_KEY = "crm:posvenda_cache_v3";
const PV_LS_TTL = 15 * 60_000;

export const invalidatePosVendaCache = () => {
  _pvCache.userId = null; _pvCache.data = null; _pvCache.ts = 0;
};

function readPvCache(userId: string | null | undefined): Metrics | null {
  if (!userId) return null;
  if (_pvCache.userId === userId && _pvCache.data && Date.now() - _pvCache.ts < PV_MODULE_TTL) {
    return _pvCache.data;
  }
  try {
    const raw = localStorage.getItem(`${PV_LS_KEY}:${userId}`);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw) as { data: Metrics; ts: number };
    if (Date.now() - ts > PV_LS_TTL) return null;
    _pvCache.userId = userId; _pvCache.data = data; _pvCache.ts = ts;
    return data;
  } catch { return null; }
}

function writePvCache(userId: string | null | undefined, data: Metrics) {
  if (!userId) return;
  _pvCache.userId = userId; _pvCache.data = data; _pvCache.ts = Date.now();
  try { localStorage.setItem(`${PV_LS_KEY}:${userId}`, JSON.stringify({ data, ts: _pvCache.ts })); } catch { /* localStorage indisponível */ }
}
// ──────────────────────────────────────────────────────────────────────────

type PagamentoRow = { id: string; paciente_id: string; data_pagamento: string; valor: number | string };
type AggPaciente = { paciente_id: string; primeiro: string; ultimo: string; total: number };

/**
 * Carrega as métricas do painel a partir da fonte da verdade (pagamentos).
 * Lança erro em falha — nunca devolve zero silencioso. A única degradação
 * tolerada é rpt_contratados indisponível (recem_erro preenchido).
 */
async function loadPosVendaMetrics(userId: string): Promise<Metrics> {
  const hoje = todayBahia();
  const corteRisco = addDiasDia(hoje, -DIAS_RISCO);
  const corteSumido = addDiasDia(hoje, -DIAS_SUMIDO);
  const inicioRecem = addDiasDia(hoje, -(JANELA_RECEM_DIAS - 1)); // período inclusivo

  // Tenant do usuário (pagamentos não tem tenant_id; o recorte é via clínicas)
  const { data: prof, error: profErr } = await supabase
    .from("profiles").select("tenant_id").eq("id", userId).maybeSingle();
  if (profErr) throw new Error(`perfil: ${profErr.message}`);
  if (!prof?.tenant_id) throw new Error("Tenant do usuário não encontrado");

  const { data: clin, error: clinErr } = await supabase
    .from("clinicas").select("id").eq("tenant_id", prof.tenant_id);
  if (clinErr) throw new Error(`clínicas: ${clinErr.message}`);
  const clinicaIds = (clin ?? []).map((c) => c.id);

  // Pagamentos (todas as linhas, paginado) + recém-contratados (RPC canônica),
  // em paralelo. A RPC pode ainda não existir no banco: degrada com aviso.
  const [pagamentosRes, recemRes] = await Promise.allSettled([
    clinicaIds.length === 0
      ? Promise.resolve([] as PagamentoRow[])
      : fetchAllPaged<PagamentoRow>(
          () => supabase
            .from("pagamentos")
            .select("id, paciente_id, data_pagamento, valor")
            .in("clinica_id", clinicaIds),
          "id",
        ),
    rptContratados(inicioRecem, hoje),
  ]);
  if (pagamentosRes.status === "rejected") {
    throw new Error(`pagamentos: ${pagamentosRes.reason?.message ?? pagamentosRes.reason}`);
  }
  const pagamentos = pagamentosRes.value;

  // Agrega por paciente: 1º pagamento, último pagamento e total pago
  const porPaciente = new Map<string, AggPaciente>();
  for (const p of pagamentos) {
    if (!p.paciente_id || !p.data_pagamento) continue;
    const atual = porPaciente.get(p.paciente_id);
    if (!atual) {
      porPaciente.set(p.paciente_id, {
        paciente_id: p.paciente_id,
        primeiro: p.data_pagamento,
        ultimo: p.data_pagamento,
        total: num(p.valor),
      });
    } else {
      if (p.data_pagamento < atual.primeiro) atual.primeiro = p.data_pagamento;
      if (p.data_pagamento > atual.ultimo) atual.ultimo = p.data_pagamento;
      atual.total += num(p.valor);
    }
  }
  const base = Array.from(porPaciente.values());
  const historicoInicio = base.length
    ? base.reduce((min, a) => (a.primeiro < min ? a.primeiro : min), base[0].primeiro)
    : null;

  // Recortes (comparação lexicográfica funciona em YYYY-MM-DD)
  const emRisco = base.filter((a) => a.primeiro < corteRisco && a.ultimo < corteRisco);
  const vips = base.filter((a) => a.total >= VIP_VALOR_MIN);
  const sumidosDisponivel = historicoInicio !== null && historicoInicio < corteSumido;
  const sumidos = sumidosDisponivel ? base.filter((a) => a.ultimo < corteSumido) : [];

  // Ordenação explícita em todo top-N
  const emRiscoTop = [...emRisco]
    .sort((a, b) => a.ultimo.localeCompare(b.ultimo) || b.total - a.total || a.paciente_id.localeCompare(b.paciente_id))
    .slice(0, 10);
  const vipsTop = [...vips]
    .sort((a, b) => b.total - a.total || a.paciente_id.localeCompare(b.paciente_id))
    .slice(0, 10);
  const sumidosTop = [...sumidos]
    .sort((a, b) => a.ultimo.localeCompare(b.ultimo) || a.paciente_id.localeCompare(b.paciente_id))
    .slice(0, 10);

  let recemErro: string | null = null;
  let recemRows: Awaited<ReturnType<typeof rptContratados>> = [];
  if (recemRes.status === "fulfilled") {
    recemRows = recemRes.value;
  } else {
    recemErro = recemRes.reason?.message ?? String(recemRes.reason);
  }
  const recemTopRows = [...recemRows]
    .sort((a, b) => b.primeiro_pagamento.localeCompare(a.primeiro_pagamento) || a.nome.localeCompare(b.nome))
    .slice(0, 10);

  // Enriquecimento dos top-N: nome/telefone (pacientes) e lead vinculado
  const topIds = Array.from(new Set([
    ...emRiscoTop.map((a) => a.paciente_id),
    ...vipsTop.map((a) => a.paciente_id),
    ...sumidosTop.map((a) => a.paciente_id),
    ...recemTopRows.map((r) => r.paciente_id),
  ]));

  const pacInfo = new Map<string, { nome: string; telefone: string | null }>();
  const leadByPaciente = new Map<string, string>();
  if (topIds.length > 0) {
    const { data: pacs, error: pacErr } = await supabase
      .from("pacientes").select("id, nome, telefone").in("id", topIds);
    if (pacErr) throw new Error(`pacientes: ${pacErr.message}`);
    for (const p of pacs ?? []) pacInfo.set(p.id, { nome: p.nome, telefone: p.telefone ?? null });

    // Vínculo lead↔paciente: campo direto E tabela de vínculo (crm_lead_pacientes).
    // Falha aqui não derruba o painel: só perde o atalho para a conversa.
    const [leadsDiretos, leadsVinculo] = await Promise.all([
      supabase.from("crm_leads").select("id, paciente_id").in("paciente_id", topIds),
      supabase.from("crm_lead_pacientes").select("lead_id, paciente_id").in("paciente_id", topIds),
    ]);
    for (const v of leadsVinculo.data ?? []) leadByPaciente.set(v.paciente_id, v.lead_id);
    for (const l of leadsDiretos.data ?? []) {
      if (l.paciente_id) leadByPaciente.set(l.paciente_id, l.id); // campo direto prevalece
    }
  }

  const toItem = (a: AggPaciente, detalhe: string): PacienteItem => ({
    paciente_id: a.paciente_id,
    nome: pacInfo.get(a.paciente_id)?.nome ?? "(paciente sem cadastro)",
    telefone: pacInfo.get(a.paciente_id)?.telefone ?? null,
    lead_id: leadByPaciente.get(a.paciente_id) ?? null,
    detalhe,
  });

  return {
    pacientes_total: base.length,
    historico_inicio: historicoInicio,
    em_risco_count: emRisco.length,
    em_risco_top: emRiscoTop.map((a) =>
      toItem(a, `sem pagamento desde ${fmtDia(a.ultimo)} · ${brl.format(a.total)} pagos`)),
    sumidos_disponivel: sumidosDisponivel,
    sumidos_disponivel_em: historicoInicio ? addDiasDia(historicoInicio, DIAS_SUMIDO + 1) : null,
    sumidos_count: sumidos.length,
    sumidos_top: sumidosTop.map((a) => toItem(a, `último pagamento ${fmtDia(a.ultimo)}`)),
    vips_count: vips.length,
    vips_top: vipsTop.map((a) =>
      toItem(a, `${brl.format(a.total)} pagos · último em ${fmtDia(a.ultimo)}`)),
    recem_count: recemErro ? null : recemRows.length,
    recem_top: recemTopRows.map((r) => ({
      paciente_id: r.paciente_id,
      nome: r.nome,
      telefone: pacInfo.get(r.paciente_id)?.telefone ?? null,
      lead_id: leadByPaciente.get(r.paciente_id) ?? null,
      detalhe: `1º pagamento ${fmtDia(r.primeiro_pagamento)} · ${brl.format(r.valor_total_periodo)} no período · ${r.clinica}`,
    })),
    recem_erro: recemErro,
  };
}

/** Pré-carrega métricas do painel Pós-Venda (idempotente: pula se cache fresco). */
export const prefetchPosVendaData = async (
  userId: string | null | undefined,
  userRole: string | null | undefined,
): Promise<void> => {
  if (!userId || !userRole || !ALLOWED_ROLES.includes(userRole)) return;
  if (_pvCache.userId === userId && _pvCache.data && Date.now() - _pvCache.ts < PV_MODULE_TTL) return;
  try {
    const data = await loadPosVendaMetrics(userId);
    // Só cacheia resultado completo (sem degradação da RPC de contratados)
    if (!data.recem_erro) writePvCache(userId, data);
  } catch (e) {
    console.warn("[prefetchPosVendaData] falhou:", e);
  }
};

export default function CrmPosVendaDashboard() {
  const navigate = useNavigate();
  const { user, userRole } = useAuth();
  const [metrics, setMetrics] = useState<Metrics | null>(() => readPvCache(user?.id));
  const [loading, setLoading] = useState(!readPvCache(user?.id));
  const [erro, setErro] = useState<string | null>(null);

  const canAccess = userRole && ALLOWED_ROLES.includes(userRole);

  const fetchMetrics = useCallback(async (forcar = false) => {
    if (!user?.id) return;
    if (forcar) invalidatePosVendaCache();
    setErro(null);
    if (forcar) setLoading(true);
    try {
      const m = await loadPosVendaMetrics(user.id);
      if (!m.recem_erro) writePvCache(user.id, m);
      setMetrics(m);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[Pós-Venda] erro:", e);
      setErro(msg);
      toast.error("Erro ao carregar métricas: " + msg);
    }
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    if (canAccess) fetchMetrics();
  }, [canAccess, fetchMetrics]);

  if (!canAccess) {
    return (
      <div className="flex h-full items-center justify-center">
        <Card className="p-8 max-w-md text-center">
          <h2 className="text-lg font-semibold mb-2">Acesso restrito</h2>
          <p className="text-sm text-muted-foreground">
            Este painel é exclusivo para o Pós-Venda.
          </p>
        </Card>
      </div>
    );
  }

  const cards = metrics ? [
    {
      key: "em_risco",
      label: "Em risco",
      count: String(metrics.em_risco_count),
      icon: AlertTriangle,
      color: "text-destructive",
      bg: "bg-destructive/10",
      leads: metrics.em_risco_top,
      hint: `1º pagamento há ${DIAS_RISCO}+ dias e sem pagamento há ${DIAS_RISCO}+ dias`,
      vazio: "Nenhum paciente nesta categoria",
    },
    {
      key: "sumidos",
      label: "Sumidos",
      count: metrics.sumidos_disponivel ? String(metrics.sumidos_count) : "—",
      icon: UserX,
      color: "text-amber-600",
      bg: "bg-amber-500/10",
      leads: metrics.sumidos_top,
      hint: metrics.sumidos_disponivel
        ? `Sem pagamento há ${DIAS_SUMIDO}+ dias`
        : "Histórico ainda insuficiente para medir",
      vazio: metrics.sumidos_disponivel
        ? "Nenhum paciente nesta categoria"
        : `O histórico de pagamentos começa em ${metrics.historico_inicio ? fmtDia(metrics.historico_inicio) : "—"}; ` +
          `este indicador (${DIAS_SUMIDO}+ dias sem voltar) só passa a existir a partir de ` +
          `${metrics.sumidos_disponivel_em ? fmtDia(metrics.sumidos_disponivel_em) : "—"}.`,
    },
    {
      key: "vips",
      label: "VIPs",
      count: String(metrics.vips_count),
      icon: Crown,
      color: "text-emerald-600",
      bg: "bg-emerald-500/10",
      leads: metrics.vips_top,
      hint: `${brl.format(VIP_VALOR_MIN)}+ pagos (acumulado)`,
      vazio: "Nenhum paciente nesta categoria",
    },
    {
      key: "recem",
      label: "Recém-contratados",
      count: metrics.recem_erro ? "—" : String(metrics.recem_count ?? 0),
      icon: Sparkles,
      color: "text-primary",
      bg: "bg-primary/10",
      leads: metrics.recem_top,
      hint: metrics.recem_erro
        ? "Indisponível no momento"
        : `1º pagamento nos últimos ${JANELA_RECEM_DIAS} dias`,
      vazio: metrics.recem_erro
        ? `Não foi possível carregar (${metrics.recem_erro}). Clique em Atualizar para tentar de novo.`
        : "Nenhum paciente nesta categoria",
    },
  ] : [];

  return (
    <div className="h-full overflow-y-auto pr-1">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Pós-Venda</h1>
          <p className="text-sm text-muted-foreground">
            Retenção da base de pacientes (quem já pagou algum tratamento)
            {metrics && ` · ${metrics.pacientes_total} pacientes com pagamento registrado`}
          </p>
        </div>
        <Button
          onClick={() => fetchMetrics(true)}
          disabled={loading}
          variant="outline"
          size="sm"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {erro && !metrics ? (
        <Card className="p-8 max-w-lg mx-auto text-center">
          <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-3" />
          <h2 className="font-semibold mb-1">Não foi possível carregar o painel</h2>
          <p className="text-sm text-muted-foreground mb-4">{erro}</p>
          <Button onClick={() => fetchMetrics(true)} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Tentar novamente
          </Button>
        </Card>
      ) : loading && !metrics ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <Card key={i} className="p-6 animate-pulse h-32 bg-muted/30" />
          ))}
        </div>
      ) : (
        <>
          {/* 4 cards principais */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {cards.map(card => {
              const Icon = card.icon;
              return (
                <Card key={card.key} className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className={`h-10 w-10 rounded-lg ${card.bg} flex items-center justify-center`}>
                      <Icon className={`h-5 w-5 ${card.color}`} />
                    </div>
                    <span className="text-3xl font-bold">{card.count}</span>
                  </div>
                  <h3 className="font-semibold text-sm">{card.label}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">{card.hint}</p>
                </Card>
              );
            })}
          </div>

          {/* Listas top-10 por card */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {cards.map(card => {
              const Icon = card.icon;
              return (
                <Card key={card.key} className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold flex items-center gap-2 text-sm">
                      <Icon className={`h-4 w-4 ${card.color}`} />
                      {card.label}
                      {card.leads.length > 0 && (
                        <span className="text-xs text-muted-foreground font-normal">
                          (top {card.leads.length})
                        </span>
                      )}
                    </h3>
                  </div>

                  {card.leads.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-6 text-center flex items-center justify-center gap-2">
                      <Info className="h-3.5 w-3.5 shrink-0" />
                      <span>{card.vazio}</span>
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {card.leads.map(item => (
                        <button
                          key={item.paciente_id}
                          onClick={() =>
                            item.lead_id
                              ? navigate(`/crm/conversa/${item.lead_id}`)
                              : navigate(`/pacientes/${item.paciente_id}`)
                          }
                          className="w-full flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent text-left transition-colors group"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{item.nome}</div>
                            <div className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
                              {item.telefone && (
                                <>
                                  <Phone className="h-3 w-3" />
                                  {item.telefone}
                                  <span>·</span>
                                </>
                              )}
                              <span>{item.detalhe}</span>
                            </div>
                          </div>
                          <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </button>
                      ))}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
