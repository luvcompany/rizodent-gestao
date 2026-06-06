import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  AlertTriangle, UserX, Crown, Sparkles, RefreshCw, ArrowRight, Phone
} from "lucide-react";
import LeadScoreBadge from "@/components/chat/LeadScoreBadge";
import { toast } from "sonner";

type LeadRow = {
  id: string;
  name: string;
  phone: string | null;
  score: number;
  last_inbound_at?: string | null;
  ultima_visita?: string | null;
};

type Metrics = {
  em_risco_count: number;
  sumidos_count: number;
  vips_count: number;
  recem_contratados_count: number;
  em_risco_top: LeadRow[];
  sumidos_top: LeadRow[];
  vips_top: LeadRow[];
  recem_contratados_top: LeadRow[];
  leads_total: number;
  leads_score_medio: number;
};

const ALLOWED_ROLES = ["posvenda", "crc", "gerente", "superadmin"];

// ── Cache ──────────────────────────────────────────────────────────────────
// v2: inclui user.id para isolar caches entre usuários no mesmo navegador
const _pvCache: { userId: string | null; data: Metrics | null; ts: number } = {
  userId: null, data: null, ts: 0,
};
const PV_MODULE_TTL = 2 * 60_000;
const PV_LS_KEY = "crm:posvenda_cache_v2";
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
  try { localStorage.setItem(`${PV_LS_KEY}:${userId}`, JSON.stringify({ data, ts: _pvCache.ts })); } catch {}
}
// ──────────────────────────────────────────────────────────────────────────

/** Pré-carrega métricas do painel Pós-Venda (idempotente: pula se cache fresco). */
export const prefetchPosVendaData = async (
  userId: string | null | undefined,
  userRole: string | null | undefined,
): Promise<void> => {
  if (!userId || !userRole || !ALLOWED_ROLES.includes(userRole)) return;
  if (_pvCache.userId === userId && _pvCache.data && Date.now() - _pvCache.ts < PV_MODULE_TTL) return;
  try {
    const { data, error } = await supabase.rpc("posvenda_dashboard_metrics");
    if (error || !data) return;
    writePvCache(userId, data as unknown as Metrics);
  } catch (e) {
    console.warn("[prefetchPosVendaData] falhou:", e);
  }
};

export default function CrmPosVendaDashboard() {
  const navigate = useNavigate();
  const { user, userRole } = useAuth();
  const [metrics, setMetrics] = useState<Metrics | null>(() => readPvCache(user?.id));
  const [loading, setLoading] = useState(!readPvCache(user?.id));
  const [recalculating, setRecalculating] = useState(false);

  const canAccess = userRole && ALLOWED_ROLES.includes(userRole);

  const fetchMetrics = useCallback(async () => {
    const { data, error } = await supabase.rpc("posvenda_dashboard_metrics");
    if (error) {
      console.error("[Pós-Venda] erro:", error);
      toast.error("Erro ao carregar métricas: " + error.message);
    } else {
      const m = data as unknown as Metrics;
      writePvCache(user?.id, m);
      setMetrics(m);
    }
    setLoading(false);
  }, [user?.id]);

  const recalculateScores = async () => {
    setRecalculating(true);
    const { error } = await supabase.rpc("recalculate_all_lead_scores", { p_batch_size: 500 });
    setRecalculating(false);
    if (error) toast.error("Erro: " + error.message);
    else {
      toast.success("Scores recalculados");
      fetchMetrics();
    }
  };

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
      count: metrics.em_risco_count,
      icon: AlertTriangle,
      color: "text-destructive",
      bg: "bg-destructive/10",
      leads: metrics.em_risco_top,
      hint: "Sem resposta 30+ dias, cancelaram ou score < 30",
    },
    {
      key: "sumidos",
      label: "Sumidos",
      count: metrics.sumidos_count,
      icon: UserX,
      color: "text-amber-600",
      bg: "bg-amber-500/10",
      leads: metrics.sumidos_top,
      hint: "Sem voltar à clínica há 180+ dias",
    },
    {
      key: "vips",
      label: "VIPs",
      count: metrics.vips_count,
      icon: Crown,
      color: "text-emerald-600",
      bg: "bg-emerald-500/10",
      leads: metrics.vips_top,
      hint: "Health Score ≥ 80",
    },
    {
      key: "recem",
      label: "Recém-contratados",
      count: metrics.recem_contratados_count,
      icon: Sparkles,
      color: "text-primary",
      bg: "bg-primary/10",
      leads: metrics.recem_contratados_top,
      hint: "Contrataram nos últimos 30 dias",
    },
  ] : [];

  return (
    <div className="h-full overflow-y-auto pr-1">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Pós-Venda</h1>
          <p className="text-sm text-muted-foreground">
            Painel de risco, retenção e oportunidades
            {metrics && ` · ${metrics.leads_total} pacientes ativos · Score médio ${metrics.leads_score_medio}`}
          </p>
        </div>
        <Button
          onClick={recalculateScores}
          disabled={recalculating}
          variant="outline"
          size="sm"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${recalculating ? "animate-spin" : ""}`} />
          Recalcular scores
        </Button>
      </div>

      {loading && !metrics ? (
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
                      <span className="text-xs text-muted-foreground font-normal">
                        (top {card.leads.length})
                      </span>
                    </h3>
                  </div>

                  {card.leads.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-6 text-center">
                      Nenhum lead nesta categoria
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {card.leads.map(lead => (
                        <button
                          key={lead.id}
                          onClick={() => navigate(`/crm/conversa/${lead.id}`)}
                          className="w-full flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent text-left transition-colors group"
                        >
                          <LeadScoreBadge score={lead.score} compact />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{lead.name}</div>
                            <div className="text-xs text-muted-foreground flex items-center gap-1">
                              {lead.phone && (
                                <>
                                  <Phone className="h-3 w-3" />
                                  {lead.phone}
                                </>
                              )}
                              {lead.ultima_visita && (
                                <span>· última visita {new Date(lead.ultima_visita).toLocaleDateString("pt-BR")}</span>
                              )}
                              {lead.last_inbound_at && !lead.ultima_visita && (
                                <span>· última msg {new Date(lead.last_inbound_at).toLocaleDateString("pt-BR")}</span>
                              )}
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
